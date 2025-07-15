import { ParsedOrder } from '../config';
import { orderBookService } from './order-book';
import { prisma } from '../database/prisma-client';
import { WebSocketService } from './websocket';
import { wsService } from '../ws-singleton';
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
   */
  static async parseOrder(text: string): Promise<ParsedOrder | null> {
    return await this.parseWithAI(text);
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
        const prompt = `Extract ONLY the following fields as a single-line JSON: action (bid/offer), product, monthyear, price, amount. If the action is "buy", set action to "bid". If the action is "sell", set action to "offer". No explanation, no extra text, no markdown. Message: "${text}"`;
        const response = await axios.post(
          'https://api.openai.com/v1/chat/completions',
          {
            model: 'gpt-3.5-turbo',
            messages: [
              { role: 'system', content: 'You are a helpful trading assistant.' },
              { role: 'user', content: prompt }
            ],
            max_tokens: 150,
            temperature: 0.2
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
          // Action mapping
          const actionMap: Record<string, string> = {
            'buy': 'bid', 'bids': 'bid', 'bidding': 'bid', 'bid': 'bid',
            'sell': 'offer', 'sells': 'offer', 'offering': 'offer', 'offer': 'offer'
          };
          let action = actionMap[(json.action || '').toLowerCase()] || (json.action || '').toLowerCase();
          // Validation helpers
          const isValidMonthYear = (str: string) => /^[A-Za-z]{3}\d{2}$/.test(str);
          const isValidProduct = (product: string) => ['wheat', 'gold', 'oil', 'silver'].includes((product || '').toLowerCase());
          const amount = Number(json.amount);
          const price = Number(json.price);
          const validAction = ['bid', 'offer'].includes(action);
          const validProduct = isValidProduct(json.product);
          const validMonthYear = isValidMonthYear(json.monthyear);
          console.log('[Validation]', { validAction, validProduct, validMonthYear });
          if (!validAction || !validProduct || !validMonthYear || isNaN(amount) || isNaN(price)) return null;
          return {
            action,
            price,
            monthyear: json.monthyear.toLowerCase(),
            product: json.product.toLowerCase(),
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
 */
export async function processNLPCommand(message: string, from: string): Promise<{ success: boolean; response: string; error?: string }> {
  try {
    const cleanMessage = message.trim().toLowerCase();
    
    // Handle help command
    if (cleanMessage.includes('help') || cleanMessage.includes('commands')) {
      return {
        success: true,
        response: `📋 Available Commands:
• "Buy 100 Dec25 Wheat at 150" - Place buy order
• "Sell 50 Jan26 Gold for 2000" - Place sell order
• "Market" - View market data
• "Orders" - View your orders
• "Trades" - View recent trades
• "Cancel [order_id]" - Cancel order
• "Help" - Show this message`
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

      const marketText = marketData.slice(0, 5).map(item => 
        `${item.asset}: Bid ${item.bid_price || 'N/A'} | Offer ${item.offer_price || 'N/A'}`
      ).join('\n');

      return {
        success: true,
        response: `📊 Market Data:\n${marketText}`
      };
    }

    // Handle orders request
    if (cleanMessage.includes('orders') || cleanMessage.includes('my orders')) {
      // Find user by phone number
      const user = await prisma.user.findFirst({
        where: { phone: from.replace('whatsapp:', '') }
      });

      if (!user) {
        return {
          success: false,
          response: '',
          error: 'User not found. Please register first.'
        };
      }

      const orders = await orderBookService.getUserOrders(user.id);
      if (orders.length === 0) {
        return {
          success: true,
          response: '📋 You have no orders.'
        };
      }

      const ordersText = orders.slice(0, 5).map(order => 
        `${order.id}: ${order.action} ${order.amount} ${order.asset} @ ${order.price} (${order.status})`
      ).join('\n');

      return {
        success: true,
        response: `📋 Your Orders:\n${ordersText}`
      };
    }

    // Handle trades request
    if (cleanMessage.includes('trades') || cleanMessage.includes('recent')) {
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
        response: `💱 Recent Trades:\n${tradesText}`
      };
    }

    // Handle order cancellation
    if (cleanMessage.includes('cancel')) {
      const orderIdMatch = cleanMessage.match(/cancel\s+(\w+)/i);
      if (!orderIdMatch) {
        return {
          success: false,
          response: '',
          error: 'Please specify order ID: "Cancel [order_id]"'
        };
      }

      const orderId = orderIdMatch[1];
      const user = await prisma.user.findFirst({
        where: { phone: from.replace('whatsapp:', '') }
      });

      if (!user) {
        return {
          success: false,
          response: '',
          error: 'User not found.'
        };
      }

      const result = await orderBookService.cancelOrder(user.id, orderId);
      return {
        success: result.success,
        response: result.message
      };
    }

    // Handle order placement
    const parsedOrder = await NLPParser.parseOrder(message);
    if (parsedOrder) {
      const user = await prisma.user.findFirst({
        where: { phone: from.replace('whatsapp:', '') }
      });

      if (!user) {
        return {
          success: false,
          response: '',
          error: 'User not found. Please register first.'
        };
      }

      const result = await orderBookService.createOrder(
        user.id,
        parsedOrder.action.toUpperCase() as 'BID' | 'OFFER',
        parsedOrder.price,
        parsedOrder.monthyear,
        parsedOrder.product,
        parsedOrder.amount
      );

      if (result.errors.length > 0) {
        return {
          success: false,
          response: '',
          error: result.errors.join(', ')
        };
      }

      return {
        success: true,
        response: `✅ Order created: ${parsedOrder.action} ${parsedOrder.amount} ${parsedOrder.product} ${parsedOrder.monthyear} @ ${parsedOrder.price}`
      };
    }

    // If OpenAI extraction fails
    return {
      success: false,
      response: '',
      error: 'Sorry, I could not understand your order. Please try a more direct format like "Buy 100 Dec25 Wheat at 150".'
    };

  } catch (error) {
    console.error('Error processing NLP command:', error);
    return {
      success: false,
      response: '',
      error: 'Internal server error'
    };
  }
} 