import { ParsedOrder } from '../config';
import { orderBookService } from './order-book';
import { prisma } from '../database/prisma-client';
import { WebSocketService } from './websocket';
import { wsService } from '../ws-singleton';
import { whatsappAuthService } from './whatsapp-auth';
import { sendWhatsAppMessage } from './whatsapp';
import { normalizePhoneNumber } from '../utils';
import axios from 'axios';
import { config as dotenvConfig } from 'dotenv';
dotenvConfig();

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

/**
 * Advanced NLP Parser for Trading Orders
 * Handles natural language inputs like:
 * - "Buy 100 Dec25 Wheat at 150"
 * - "Sell 50 Jan26 Gold for 2000"
 * - "bid 75 Dec25 oil 10"
 * - "offer 1200 Dec25 silver 25"
 */
export class NLPParser {
  /**
   * Parse natural language order text
   * Tries regex first, then AI fallback
   */
  static async parseOrder(text: string): Promise<ParsedOrder | null> {
    console.log('[NLP] Attempting to parse:', text);
    
    // Try regex parsing first (faster and more reliable for structured commands)
    const regexResult = this.parseWithRegex(text);
    if (regexResult) {
      console.log('[NLP] ✅ Regex parsing successful:', regexResult);
      return regexResult;
    }
    
    // If regex fails, try AI parsing
    console.log('[NLP] Regex failed, trying AI parsing...');
    const aiResult = await this.parseWithAI(text);
    if (aiResult) {
      console.log('[NLP] ✅ AI parsing successful:', aiResult);
      return aiResult;
    }
    
    console.log('[NLP] ❌ Both regex and AI parsing failed');
    return null;
  }

  /**
   * Parse with regex patterns (fast and reliable for structured commands)
   */
  private static parseWithRegex(text: string): ParsedOrder | null {
    const cleanText = text.trim().toLowerCase();
    
    // Enhanced regex patterns for trading orders
    const patterns = [
      // "Buy 100 Dec25 Wheat at 150" or "Sell 50 Jan26 Gold for 2000"
      /^(buy|sell|bid|offer)\s+(\d+)\s+([a-z]{3}\d{2})\s+([a-z]+)\s+(?:at|for)\s+(\d+(?:\.\d+)?)$/i,
      
      // "buy 100 gas jan24 at 50" 
      /^(buy|sell|bid|offer)\s+(\d+)\s+([a-z]+)\s+([a-z]{3}\d{2})\s+(?:at|for)\s+(\d+(?:\.\d+)?)$/i,
      
      // "bid 100 wheat dec25 150" (more compact format)
      /^(bid|offer|buy|sell)\s+(\d+)\s+([a-z]+)\s+([a-z]{3}\d{2})\s+(\d+(?:\.\d+)?)$/i,
      
      // "100 wheat dec25 bid 150"
      /^(\d+)\s+([a-z]+)\s+([a-z]{3}\d{2})\s+(bid|offer|buy|sell)\s+(\d+(?:\.\d+)?)$/i,
      
      // NEW: Handle spaces in monthyear - "Buy 50 Jan 13 Gold at 500"
      /^(buy|sell|bid|offer)\s+(\d+)\s+([a-z]{3})\s+(\d{2})\s+([a-z]+)\s+(?:at|for)\s+(\d+(?:\.\d+)?)$/i,
      
      // NEW: Alternative order - "buy 100 gold jan 13 at 500"
      /^(buy|sell|bid|offer)\s+(\d+)\s+([a-z]+)\s+([a-z]{3})\s+(\d{2})\s+(?:at|for)\s+(\d+(?:\.\d+)?)$/i
    ];

    for (let i = 0; i < patterns.length; i++) {
      const match = cleanText.match(patterns[i]);
      if (match) {
        console.log(`[REGEX] Pattern ${i + 1} matched:`, match);
        
        let action, amount, product, monthyear, price;
        
        if (i === 3) { // Last pattern has different order
          [, amount, product, monthyear, action, price] = match;
        } else if (i === 1) { // Pattern with product before monthyear
          [, action, amount, product, monthyear, price] = match;
        } else if (i === 4) { // "Buy 50 Jan 13 Gold at 500" pattern
          const [, actionMatch, amountMatch, month, year, productMatch, priceMatch] = match;
          action = actionMatch;
          amount = amountMatch;
          product = productMatch;
          monthyear = month + year; // Combine "jan" + "13" = "jan13"
          price = priceMatch;
        } else if (i === 5) { // "buy 100 gold jan 13 at 500" pattern
          const [, actionMatch, amountMatch, productMatch, month, year, priceMatch] = match;
          action = actionMatch;
          amount = amountMatch;
          product = productMatch;
          monthyear = month + year; // Combine "jan" + "13" = "jan13"
          price = priceMatch;
        } else {
          [, action, amount, monthyear, product, price] = match;
        }

        // Normalize action
        const actionMap: Record<string, 'bid' | 'offer'> = {
          'buy': 'bid',
          'sell': 'offer',
          'bid': 'bid',
          'offer': 'offer'
        };
        
        const normalizedAction = actionMap[action.toLowerCase()];
        if (!normalizedAction) {
          console.log('[REGEX] Invalid action:', action);
          continue;
        }

        // Validate product (accept any reasonable product name)
        if (!product || product.length < 2 || !/^[a-z]+$/.test(product.toLowerCase())) {
          console.log('[REGEX] Invalid product format:', product);
          continue;
        }

        // Validate monthyear format (e.g., dec25, jan24)
        if (!/^[a-z]{3}\d{2}$/.test(monthyear.toLowerCase())) {
          console.log('[REGEX] Invalid monthyear format:', monthyear);
          continue;
        }

        const parsedAmount = parseInt(amount);
        const parsedPrice = parseFloat(price);

        if (isNaN(parsedAmount) || isNaN(parsedPrice) || parsedAmount <= 0 || parsedPrice <= 0) {
          console.log('[REGEX] Invalid amount or price:', { amount: parsedAmount, price: parsedPrice });
          continue;
        }

        console.log('[REGEX] ✅ Successfully parsed order');
        return {
          action: normalizedAction,
          price: parsedPrice,
          monthyear: monthyear.toLowerCase(),
          product: product.toLowerCase(),
          amount: parsedAmount,
          confidence: 0.95, // High confidence for regex matches
          rawText: text
        };
      }
    }

    console.log('[REGEX] No patterns matched');
    return null;
  }

  /**
   * Parse with AI (OpenAI) if available
   */
  private static async parseWithAI(text: string): Promise<ParsedOrder | null> {
    if (!OPENAI_API_KEY) return null;
    const maxRetries = 3;
    let attempt = 0;
    let lastError = null;
    while (attempt < maxRetries) {
      try {
        console.log('[NLP Input]', text);
        const prompt = `You are a trading order parser. Extract EXACTLY these fields as JSON:

REQUIRED FORMAT:
- action: must be "bid" (for buy/purchase) or "offer" (for sell)  
- product: any commodity or product name (examples: wheat, gold, oil, silver, coffee, copper, lumber, etc.)
- monthyear: must be 3-letter month + 2-digit year (examples: "jan25", "dec24", "feb26")
- price: number only, no currency symbols
- amount: number only, no commas

EXAMPLES:
"Buy 100 Dec25 Wheat at 150" → {"action":"bid","product":"wheat","monthyear":"dec25","price":150,"amount":100}
"Sell 50 gold jan26 for 2000" → {"action":"offer","product":"gold","monthyear":"jan26","price":2000,"amount":50}
"I want to buy Cup March 25th" → {"action":"bid","product":"cup","monthyear":"mar25","price":1300,"amount":1000}

MONTH CONVERSION:
january=jan, february=feb, march=mar, april=apr, may=may, june=jun,
july=jul, august=aug, september=sep, october=oct, november=nov, december=dec

Parse this message: "${text}"

Return ONLY the JSON, no explanation:`;

        const response = await axios.post(
          'https://api.openai.com/v1/chat/completions',
          {
            model: 'gpt-3.5-turbo',
            messages: [
              { role: 'system', content: 'You are a precise trading order parser. Always return valid JSON matching the exact format specified.' },
              { role: 'user', content: prompt }
            ],
            max_tokens: 150,
            temperature: 0.1 // Lower temperature for more consistent output
          },
          {
            headers: {
              'Authorization': `Bearer ${OPENAI_API_KEY}`,
              'Content-Type': 'application/json'
            }
          }
        );
        const content = response.data.choices[0].message.content;
        console.log('[OpenAI Response]', content);
        
        // Safer JSON extraction
        try {
          const jsonStart = content.indexOf('{');
          const jsonEnd = content.lastIndexOf('}') + 1;
          if (jsonStart === -1 || jsonEnd === -1) return null;
          const jsonString = content.slice(jsonStart, jsonEnd);
          const json = JSON.parse(jsonString);
          console.log('[Parsed JSON]', json);
          
          // Robust data extraction with type handling
          const action = String(json.action || '').toLowerCase();
          const product = String(json.product || '').toLowerCase();
          const monthyear = String(json.monthyear || '').toLowerCase();
          const amount = typeof json.amount === 'number' ? json.amount : parseInt(String(json.amount || '0').replace(/[^\d]/g, ''));
          const price = typeof json.price === 'number' ? json.price : parseFloat(String(json.price || '0').replace(/[^\d.]/g, ''));
          
          // Action mapping
          const actionMap: Record<string, string> = {
            'buy': 'bid', 'bids': 'bid', 'bidding': 'bid', 'bid': 'bid',
            'sell': 'offer', 'sells': 'offer', 'offering': 'offer', 'offer': 'offer'
          };
          const normalizedAction = actionMap[action] || action;
          
          // Enhanced monthyear normalization
          let normalizedMonthYear = monthyear;
          
          // Handle full month names to abbreviations
          const monthMap: Record<string, string> = {
            'january': 'jan', 'february': 'feb', 'march': 'mar', 'april': 'apr',
            'may': 'may', 'june': 'jun', 'july': 'jul', 'august': 'aug',
            'september': 'sep', 'october': 'oct', 'november': 'nov', 'december': 'dec'
          };
          
          // Convert "december 12th" or "december 12" to "dec12"
          for (const [fullMonth, abbrev] of Object.entries(monthMap)) {
            if (monthyear.includes(fullMonth)) {
              // Extract year from patterns like "december 12th" or "december 12"
              const yearMatch = monthyear.match(/(\d{1,2})/);
              if (yearMatch) {
                const year = yearMatch[1].padStart(2, '0'); // Ensure 2 digits
                normalizedMonthYear = abbrev + year;
                break;
              }
            }
          }
          
          // Validation helpers
          const isValidMonthYear = (str: string) => /^[a-z]{3}\d{2}$/.test(str);
          const isValidProduct = (product: string) => product && product.length >= 2 && /^[a-z]+$/.test(product);
          const validAction = ['bid', 'offer'].includes(normalizedAction);
          const validProduct = isValidProduct(product);
          const validMonthYear = isValidMonthYear(normalizedMonthYear);
          
          console.log('[Validation]', { 
            action: normalizedAction, 
            validAction, 
            product, 
            validProduct, 
            monthyear: normalizedMonthYear, 
            validMonthYear,
            amount,
            price
          });
          
          if (!validAction || !validProduct || !validMonthYear || isNaN(amount) || isNaN(price) || amount <= 0 || price <= 0) {
            console.log('[AI Parse] Validation failed');
            return null;
          }
          
          return {
            action: normalizedAction as 'bid' | 'offer',
            price,
            monthyear: normalizedMonthYear,
            product,
            amount,
            confidence: 0.99,
            rawText: text
          };
        } catch (e) {
          console.error('JSON parse error:', e);
          return null;
        }
      } catch (error: any) {
        if (error.response && error.response.status === 429) {
          attempt++;
          const wait = 1000 * Math.pow(2, attempt); // Exponential backoff: 2s, 4s, 8s
          console.warn(`[OpenAI] Rate limited, retrying in ${wait / 1000}s... (attempt ${attempt})`);
          await new Promise(res => setTimeout(res, wait));
          lastError = error;
          continue;
        }
        // Other errors: log and break
        console.error('OpenAI NLP error:', error);
        break;
      }
    }
    if (lastError) {
      console.error('OpenAI NLP error after retries:', lastError);
    }
    return null;
  }
}

/**
 * Process NLP command from WhatsApp
 * Uses phone-based authentication instead of JWT tokens
 */
export async function processNLPCommand(message: string, from: string): Promise<{ success: boolean; response: string; error?: string }> {
  try {
    const cleanMessage = message.trim().toLowerCase();
    const phoneNumber = normalizePhoneNumber(from);
    
    console.log('[NLP] Processing command from:', phoneNumber, '- Message:', message);
    
    // Authenticate WhatsApp user (find or create guest user)
    let session;
    try {
      session = await whatsappAuthService.authenticateUser(phoneNumber);
      console.log('[NLP] WhatsApp user authenticated:', session.username);
    } catch (error) {
      console.error('[NLP] WhatsApp authentication failed:', error);
      return {
        success: false,
        response: '',
        error: 'Authentication failed. Please try again later.'
      };
    }
    
    // Handle help command
    if (cleanMessage.includes('help') || cleanMessage.includes('commands')) {
      const helpText = session.isRegistered ? 
        `📋 Available Commands for ${session.username}:` :
        `📋 Available Commands (Guest User):`;
        
      return {
        success: true,
        response: `${helpText}

💼 TRADING:
• "Buy 100 Dec25 Wheat at 150" - Place buy order
• "Sell 50 Jan26 Gold for 2000" - Place sell order

📊 MARKET DATA:
• "Market" - View market data
• "Orders" - View your orders (with IDs)
• "Trades" - View recent market trades
• "My Trades" - View your trading history

🔧 ORDER MANAGEMENT:
• "Cancel 12345678" - Cancel order by ID
• "Edit 12345678 price 175" - Update order price
• "Update 12345678 amount 200" - Update order amount
• "Modify 12345678 price 180 amount 150" - Update both
• "Edit last order price 175" - Update your latest order
• "Status 12345678" - Check order details
• "Last order" - View your latest order

ℹ️ OTHER:
• "Help" - Show this message

${!session.isRegistered ? '\n💡 You are using a guest account. Register at our website for full features!' : ''}

💡 Tips:
• Use "Orders" to see your order IDs for editing/canceling
• "Last order" gives you quick access to your most recent order
• You can use partial order IDs (first 8 characters)`
      };
    }

    // Handle market data request
    if (cleanMessage.includes('market') || cleanMessage.includes('price')) {
      const marketData = await orderBookService.getMarketData();
      if (marketData.length === 0) {
        return {
          success: true,
          response: '📊 No market data available at the moment.'
        };
      }

      const marketText = marketData.slice(0, 5).map(item => {
        // Extract best bid (highest price) and best offer (lowest price)
        const bestBid = item.bids && item.bids.length > 0 ? item.bids[0].price : null;
        const bestOffer = item.offers && item.offers.length > 0 ? item.offers[0].price : null;
        const bidVolume = item.bids && item.bids.length > 0 ? item.bids[0].remaining : 0;
        const offerVolume = item.offers && item.offers.length > 0 ? item.offers[0].remaining : 0;
        
        return `${item.asset}: Bid ${bestBid ? `$${bestBid} (${bidVolume}x)` : 'N/A'} | Offer ${bestOffer ? `$${bestOffer} (${offerVolume}x)` : 'N/A'}`;
      }).join('\n');

      return {
        success: true,
        response: `📊 Market Data:\n${marketText}`
      };
    }

    // Handle orders request
    if (cleanMessage.includes('orders') || cleanMessage.includes('my orders')) {
      const orders = await orderBookService.getUserOrders(session.userId);
      if (orders.length === 0) {
        return {
          success: true,
          response: '📋 You have no active orders.'
        };
      }

      const ordersText = orders.slice(0, 8).map(order => {
        const shortId = order.id.slice(0, 8);
        const action = order.action.toLowerCase();
        const actionIcon = action === 'bid' ? '🟢' : '🟠';
        const actionText = action === 'bid' ? 'BUY' : 'SELL';
        
        return `${actionIcon} ID: ${shortId}
${actionText} ${order.remaining}/${order.amount} ${order.asset} @ $${order.price}
Status: ${order.status}`;
      }).join('\n\n');

      const managementTip = orders.length > 0 ? 
        `\n\n🔧 Management:\n• Cancel: "Cancel ${orders[0].id.slice(0, 8)}"\n• Edit: "Edit ${orders[0].id.slice(0, 8)} price 150"` : '';

      return {
        success: true,
        response: `📋 Your Active Orders:\n\n${ordersText}${managementTip}`
      };
    }

    // Handle trades request
    if (cleanMessage.includes('trades') || cleanMessage.includes('recent')) {
      // Check if user wants their own trades specifically
      if (cleanMessage.includes('my trades') || cleanMessage.includes('my recent')) {
        const userTrades = await orderBookService.getUserTrades(session.userId, 5);
        if (userTrades.length === 0) {
          return {
            success: true,
            response: '💱 You have no completed trades yet.'
          };
        }

        const tradesText = userTrades.map(trade => {
          const isUserBuyer = trade.buyerId === session.userId;
          const role = isUserBuyer ? 'BOUGHT' : 'SOLD';
          const counterparty = isUserBuyer ? 
            (trade.seller?.username || trade.sellerId) : 
            (trade.buyer?.username || trade.buyerId);
          
          return `${role}: ${trade.amount} ${trade.asset} @ $${trade.price} (${counterparty})`;
        }).join('\n');

        return {
          success: true,
          response: `💱 Your Recent Trades:\n${tradesText}`
        };
      } else {
        // Show general market trades
        const trades = await orderBookService.getRecentTrades(5);
        if (trades.length === 0) {
          return {
            success: true,
            response: '💱 No recent trades.'
          };
        }

        const tradesText = trades.map(trade => 
          `${trade.asset}: ${trade.amount} @ ${trade.price}`
        ).join('\n');

        return {
          success: true,
          response: `💱 Recent Market Trades:\n${tradesText}`
        };
      }
    }

    // Handle quantity confirmation responses from WhatsApp
    if (cleanMessage.includes('yes') || cleanMessage.includes('no')) {
      // Pattern: "YES 12345678" or "NO 12345678" where 12345678 is part of confirmation key
      const confirmationMatch = cleanMessage.match(/^(yes|no)\s+([a-f0-9]{8})/i);
      if (confirmationMatch) {
        const [, response, orderIdPart] = confirmationMatch;
        const accepted = response.toLowerCase() === 'yes';
        
        console.log(`[NLP] WhatsApp quantity confirmation: ${response} for order ${orderIdPart} from user ${session.userId}`);
        
        // Get the matching engine instance from wsService
        const matchingEngine = wsService.getMatchingEngine();
        if (!matchingEngine) {
          console.error('[NLP] Matching engine not available');
          return {
            success: false,
            response: '',
            error: 'Trading system temporarily unavailable. Please try again.'
          };
        }
        
        // Find the confirmation key by order ID part
        const confirmationKey = matchingEngine.getPendingConfirmationByOrderId(orderIdPart);
        if (!confirmationKey) {
          return {
            success: false,
            response: '',
            error: 'No pending confirmation found for that order. The confirmation may have expired.'
          };
        }
        
        // Get the confirmation object directly for robust state/party check
        const confirmation = matchingEngine['pendingConfirmations'].get(confirmationKey);
        if (!confirmation) {
          return {
            success: false,
            response: '',
            error: 'No pending confirmation found for that order. The confirmation may have expired.'
          };
        }
        // Determine if this user is the smaller or larger party and which step
        let isSmallerParty = false;
        let isLargerParty = false;
        if (confirmation.smallerParty === 'BUYER' && confirmation.bidOrder.userId === session.userId) {
          isSmallerParty = true;
        } else if (confirmation.smallerParty === 'SELLER' && confirmation.offerOrder.userId === session.userId) {
          isSmallerParty = true;
        } else if (confirmation.smallerParty === 'BUYER' && confirmation.offerOrder.userId === session.userId) {
          isLargerParty = true;
        } else if (confirmation.smallerParty === 'SELLER' && confirmation.bidOrder.userId === session.userId) {
          isLargerParty = true;
        }
        // Step 1: Smaller party approval
        if (confirmation.state === 'AWAITING_SMALLER' && isSmallerParty) {
        let newQuantity: number | undefined;
        if (accepted) {
            newQuantity = confirmation.largerQuantity;
        }
        await matchingEngine.handleQuantityConfirmationResponse(confirmationKey, accepted, newQuantity);
        if (accepted) {
          return {
            success: true,
              response: `✅ Confirmation ACCEPTED!\n\nYou've agreed to trade ${confirmation.largerQuantity} lots of ${confirmation.asset} instead of ${confirmation.smallerQuantity} lots.\n\nYour order is being updated and the trade will execute automatically.`
          };
        } else {
          return {
            success: true,
              response: `✅ Confirmation received: NO\n\nYou've chosen to proceed with your original ${confirmation.smallerQuantity} lots order. The counterparty will now be asked to approve a partial fill for ${confirmation.smallerQuantity} lots.`
            };
          }
        }
        // Legacy support for old state (should not happen with new logic)
        if (confirmation.state === 'AWAITING_LARGER' && isLargerParty) {
          console.log(`[NLP][DEBUG] Legacy AWAITING_LARGER state detected - this should not happen with new logic`);
          return {
            success: false,
            response: '',
            error: 'This confirmation request is in an invalid state. Please contact support.'
          };
        }
        // If user is not authorized to respond
        return {
          success: false,
          response: '',
          error: 'This confirmation request was not sent to you or is not in the correct state.'
          };
      }
    }

    // Handle order cancellation - Enhanced
    if (cleanMessage.includes('cancel') || cleanMessage.includes('delete')) {
      const orderIdMatch = cleanMessage.match(/(?:cancel|delete)\s+([a-f0-9-]{8,})/i);
      if (!orderIdMatch) {
        return {
          success: false,
          response: '',
          error: 'Please specify order ID. Example: "Cancel 12345678" or get your order IDs with "Orders"'
        };
      }

      const orderId = orderIdMatch[1];
      console.log(`[NLP] Attempting to cancel order: ${orderId} for user: ${session.userId}`);
      
      try {
        const result = await orderBookService.cancelOrder(session.userId, orderId);
        return {
          success: result.success,
          response: result.success ? `✅ ${result.message}` : '',
          error: result.success ? undefined : result.message
        };
      } catch (error) {
        console.error('[NLP] Error canceling order:', error);
        return {
          success: false,
          response: '',
          error: 'Failed to cancel order. Please try again.'
        };
      }
    }

    // Handle order editing - Enhanced with "last order" support
    if (cleanMessage.includes('edit') || cleanMessage.includes('update') || cleanMessage.includes('modify')) {
      let orderId = '';
      
      // Check if user wants to edit their last order
      if ((cleanMessage.includes('last') || cleanMessage.includes('latest')) && cleanMessage.includes('order')) {
        try {
          const orders = await orderBookService.getUserOrders(session.userId);
          if (orders.length === 0) {
            return {
              success: false,
              response: '',
              error: 'You have no active orders to edit.'
            };
          }
          orderId = orders[0].id; // Most recent order
          console.log(`[NLP] Using last order ID: ${orderId.slice(0, 8)}`);
        } catch (error) {
          return {
            success: false,
            response: '',
            error: 'Failed to retrieve your orders.'
          };
        }
      } else {
        // Standard order ID matching
        const orderIdMatch = cleanMessage.match(/(?:edit|update|modify)(?:\s+order)?\s+([a-f0-9-]{8,})/i);
        if (!orderIdMatch) {
          return {
            success: false,
            response: '',
            error: 'Please specify order ID or use "last order". Examples:\n• "Edit 12345678 price 150"\n• "Edit last order price 175"\n• "Update last order amount 100"'
          };
        }
        orderId = orderIdMatch[1];
      }
      
      // Extract price and/or amount updates
      const priceMatch = cleanMessage.match(/price\s+(\d+(?:\.\d+)?)/i);
      const amountMatch = cleanMessage.match(/(?:amount|quantity|qty)\s+(\d+)/i);
      
      if (!priceMatch && !amountMatch) {
        return {
          success: false,
          response: '',
          error: 'Please specify what to update. Examples:\n• "Edit 12345678 price 150"\n• "Update last order amount 100"\n• "Modify 12345678 price 150 amount 200"'
        };
      }

      const updates: any = {};
      if (priceMatch) {
        const newPrice = parseFloat(priceMatch[1]);
        if (newPrice <= 0) {
          return {
            success: false,
            response: '',
            error: 'Price must be greater than 0'
          };
        }
        updates.price = newPrice;
      }
      
      if (amountMatch) {
        const newAmount = parseInt(amountMatch[1]);
        if (newAmount <= 0) {
          return {
            success: false,
            response: '',
            error: 'Amount must be greater than 0'
          };
        }
        updates.amount = newAmount;
      }

      console.log(`[NLP] Attempting to update order: ${orderId.slice(0, 8)} with:`, updates);
      
      try {
        const result = await orderBookService.updateOrder(session.userId, orderId, updates);
        
        if (result.success) {
          const updateSummary = [];
          if (updates.price) updateSummary.push(`Price: $${updates.price}`);
          if (updates.amount) updateSummary.push(`Amount: ${updates.amount} lots`);
          
          return {
            success: true,
            response: `✅ Order Updated Successfully!

Order ID: ${orderId.slice(0, 8)}
Updated: ${updateSummary.join(', ')}
Asset: ${result.order.asset}

Your order is now active with the new values.`
          };
        } else {
          return {
            success: false,
            response: '',
            error: result.message
          };
        }
      } catch (error) {
        console.error('[NLP] Error updating order:', error);
        return {
          success: false,
          response: '',
          error: 'Failed to update order. Please check the order ID and try again.'
        };
      }
    }

    // Handle account/balance request
    if (cleanMessage.includes('account') || cleanMessage.includes('balance') || cleanMessage.includes('summary')) {
      const summary = await orderBookService.getAccountSummary(session.userId);
      return {
        success: true,
        response: `📈 Account Summary for ${session.username}:
Total Orders: ${summary.total_orders}
Active Orders: ${summary.active_orders}
Total Trades: ${summary.total_trades}
Total Volume: ${summary.total_volume}

${!session.isRegistered ? '💡 Guest account - Register for full features!' : ''}`
      };
    }

    // Handle order status check - NEW
    if (cleanMessage.includes('status') && (cleanMessage.includes('order') || /[a-f0-9-]{8,}/.test(cleanMessage))) {
      const orderIdMatch = cleanMessage.match(/(?:status|check)(?:\s+order)?\s+([a-f0-9-]{8,})/i) || 
                           cleanMessage.match(/([a-f0-9-]{8,})\s+status/i);
      
      if (!orderIdMatch) {
        return {
          success: false,
          response: '',
          error: 'Please specify order ID. Example: "Status 12345678" or "Check order 12345678"'
        };
      }

      const orderId = orderIdMatch[1];
      try {
        // Get user's orders and find the specified one
        const orders = await orderBookService.getUserOrders(session.userId);
        const order = orders.find(o => o.id.startsWith(orderId) || o.id === orderId);
        
        if (!order) {
          return {
            success: false,
            response: '',
            error: `Order ${orderId} not found in your active orders. Use "Orders" to see your current orders.`
          };
        }

        const actionIcon = order.action.toLowerCase() === 'bid' ? '🟢' : '🟠';
        const actionText = order.action.toLowerCase() === 'bid' ? 'BUY' : 'SELL';
        
        return {
          success: true,
          response: `📊 Order Status:

${actionIcon} ${actionText} Order
ID: ${order.id.slice(0, 8)}
Asset: ${order.asset}
Price: $${order.price}
Amount: ${order.amount} lots
Remaining: ${order.remaining} lots
Status: ${order.status}
Created: ${new Date(order.createdAt).toLocaleString()}

🔧 Quick Actions:
• Cancel: "Cancel ${order.id.slice(0, 8)}"
• Edit Price: "Edit ${order.id.slice(0, 8)} price [new_price]"
• Edit Amount: "Edit ${order.id.slice(0, 8)} amount [new_amount]"`
        };
      } catch (error) {
        console.error('[NLP] Error checking order status:', error);
        return {
          success: false,
          response: '',
          error: 'Failed to check order status. Please try again.'
        };
      }
    }

    // Handle "last order" or "latest order" shortcuts - NEW
    if ((cleanMessage.includes('last') || cleanMessage.includes('latest') || cleanMessage.includes('recent')) && 
        cleanMessage.includes('order') && !cleanMessage.includes('trades')) {
      try {
        const orders = await orderBookService.getUserOrders(session.userId);
        if (orders.length === 0) {
          return {
            success: true,
            response: '📋 You have no active orders.'
          };
        }

        // Get the most recent order (first in the list since they're sorted by createdAt desc)
        const lastOrder = orders[0];
        const actionIcon = lastOrder.action.toLowerCase() === 'bid' ? '🟢' : '🟠';
        const actionText = lastOrder.action.toLowerCase() === 'bid' ? 'BUY' : 'SELL';
        
        return {
          success: true,
          response: `📊 Your Latest Order:

${actionIcon} ${actionText} Order
ID: ${lastOrder.id.slice(0, 8)}
Asset: ${lastOrder.asset}
Price: $${lastOrder.price}
Amount: ${lastOrder.amount} lots
Remaining: ${lastOrder.remaining} lots
Status: ${lastOrder.status}

🔧 Quick Actions:
• Cancel: "Cancel ${lastOrder.id.slice(0, 8)}"
• Edit Price: "Edit ${lastOrder.id.slice(0, 8)} price [new_price]"`
        };
      } catch (error) {
        console.error('[NLP] Error getting last order:', error);
        return {
          success: false,
          response: '',
          error: 'Failed to retrieve your latest order.'
        };
      }
    }

    // Check if user can trade
    if (!whatsappAuthService.canTrade(session)) {
      return {
        success: false,
        response: '',
        error: 'Trading is not enabled for your account type.'
      };
    }

    // Handle order placement using our new regex + AI parsing
    console.log('[NLP] Attempting to parse order from message:', message);
    const parsedOrder = await NLPParser.parseOrder(message);
    if (parsedOrder) {
      console.log('[NLP] Order parsed successfully:', parsedOrder);
      
      try {
        // Verify user exists before creating order
        const userCheck = await prisma.user.findUnique({
          where: { id: session.userId },
          select: { id: true, username: true, isActive: true }
        });
        
        if (!userCheck) {
          console.error('[NLP] User not found in database:', session.userId);
          return {
            success: false,
            response: '',
            error: 'User authentication error. Please try again.'
          };
        }
        
        if (!userCheck.isActive) {
          console.error('[NLP] User is inactive:', session.userId);
          return {
            success: false,
            response: '',
            error: 'Your account is currently inactive.'
          };
        }
        
        console.log('[NLP] User verified in database:', userCheck.username);
        
        const result = await orderBookService.createOrder(
          session.userId,
          parsedOrder.action.toUpperCase() as 'BID' | 'OFFER',
          parsedOrder.price,
          parsedOrder.monthyear,
          parsedOrder.product,
          parsedOrder.amount
        );

        if (result.errors.length > 0) {
          console.error('[NLP] Order creation errors:', result.errors);
          return {
            success: false,
            response: '',
            error: result.errors.join(', ')
          };
        }

        const method = parsedOrder.confidence >= 0.9 ? 'Regex' : 'AI';
        const userType = session.isRegistered ? session.username : 'Guest';
        
        return {
          success: true,
          response: `✅ Order created (${method}) for ${userType}:
${parsedOrder.action.toUpperCase()} ${parsedOrder.amount} ${parsedOrder.product} ${parsedOrder.monthyear} @ $${parsedOrder.price}
Order ID: ${result.order.id.slice(0, 8)}

${!session.isRegistered ? '💡 Register at our website to upgrade from guest account!' : ''}`
        };
      } catch (error: any) {
        console.error('[NLP] Order creation failed:', error);
        
        // Specific error handling for database issues
        if (error.code === 'P2003') {
          return {
            success: false,
            response: '',
            error: 'Database error: User reference invalid. Please try logging out and back in.'
          };
        }
        
        return {
          success: false,
          response: '',
          error: 'Failed to create order. Please try again.'
        };
      }
    }

    // If both regex and AI parsing fail
    console.log('[NLP] ❌ All parsing methods failed for message:', message);
    return {
      success: false,
      response: '',
      error: 'Sorry, I could not understand your order. Please try a more direct format like "Buy 100 Dec25 Wheat at 150" or type "help" for examples.'
    };

  } catch (error) {
    console.error('[NLP] Error processing command:', error);
    return {
      success: false,
      response: '',
      error: 'Internal server error'
    };
  }
} 
