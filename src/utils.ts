import { twilioClient, TWILIO_PHONE_NUMBER } from './config';
import type { Order, Trade, MarketData } from './config';

// Use require for uuid to avoid type issues
const { v4: uuidv4 } = require('uuid');

/**
 * Utility functions for the trading platform
 */

/**
 * Normalize order input parameters
 */
export function normalizeOrderInput(product: string, monthyear: string): [string, string] {
  // Normalize product name
  const normalizedProduct = product.toLowerCase().trim();
  
  // Normalize month-year format
  const normalizedMonthyear = monthyear.toLowerCase().trim();
  
  return [normalizedProduct, normalizedMonthyear];
}

/**
 * Validate order input parameters
 */
export function validateOrderInput(
  action: string,
  price: number,
  monthyear: string,
  product: string,
  amount: number
): boolean {
  // Validate action
  if (!['bid', 'offer', 'buy', 'sell'].includes(action.toLowerCase())) {
    return false;
  }

  // Validate price
  if (price <= 0 || !Number.isFinite(price)) {
    return false;
  }

  // Validate monthyear format (basic check)
  if (!monthyear || monthyear.length < 3) {
    return false;
  }

  // Validate product
  if (!product || product.length < 2) {
    return false;
  }

  // Validate amount
  if (amount <= 0 || !Number.isFinite(amount)) {
    return false;
  }

  return true;
}

/**
 * Format price for display
 */
export function formatPrice(price: number): string {
  return price.toFixed(2);
}

/**
 * Format amount for display
 */
export function formatAmount(amount: number): string {
  return amount.toLocaleString();
}

/**
 * Generate a short order ID
 */
export function generateShortId(): string {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

/**
 * Calculate commission
 */
export function calculateCommission(amount: number, price: number, rate: number = 0.001): number {
  return Math.round((amount * price * rate) * 100) / 100;
}

/**
 * Validate phone number format
 */
export function validatePhoneNumber(phone: string): boolean {
  const phoneRegex = /^\+?[\d\s\-\(\)]+$/;
  return phoneRegex.test(phone) && phone.replace(/\D/g, '').length >= 10;
}

/**
 * Validate email format
 */
export function validateEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

/**
 * Sanitize user input
 */
export function sanitizeInput(input: string): string {
  return input.trim().replace(/[<>]/g, '');
}

/**
 * Generate random string
 */
export function generateRandomString(length: number = 8): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

/**
 * Normalize string inputs for consistent matching.
 */
export function normalizeString(inputStr: string): string {
  let normalizedStr = inputStr.trim().toLowerCase();
  normalizedStr = normalizedStr.replace(/[-_\s]+/g, '-');
  normalizedStr = normalizedStr.replace(/[^a-z0-9-]/g, '');
  return normalizedStr;
}

/**
 * Normalize date input to handle different formats.
 */
export function normalizeDate(dateStr: string): string {
  let normalizedDate = dateStr.trim().toLowerCase();
  const monthMapping: Record<string, string> = {
    'jan': 'jan', 'feb': 'feb', 'mar': 'mar', 'apr': 'apr', 'may': 'may', 'jun': 'jun',
    'jul': 'jul', 'aug': 'aug', 'sep': 'sep', 'oct': 'oct', 'nov': 'nov', 'dec': 'dec',
    'january': 'jan', 'february': 'feb', 'march': 'mar', 'april': 'apr', 
    'june': 'jun', 'july': 'jul', 'august': 'aug', 'september': 'sep', 'october': 'oct', 
    'november': 'nov', 'december': 'dec'
  };

  for (const [month, shortMonth] of Object.entries(monthMapping)) {
    if (normalizedDate.startsWith(month)) {
      normalizedDate = shortMonth + normalizedDate.slice(month.length);
      break;
    }
  }

  return normalizedDate;
}

/**
 * Normalize phone number for WhatsApp integration
 * Ensures consistent phone number format across the application
 */
export function normalizePhoneNumber(phoneNumber: string): string {
  if (!phoneNumber) return '';
  
  // Remove whatsapp: prefix if present
  let normalized = phoneNumber.replace(/^whatsapp:(\+)?/, '');
  
  // Ensure it starts with + for international format
  if (!normalized.startsWith('+')) {
    normalized = '+' + normalized;
  }
  
  // Remove any spaces, dashes, or other characters
  normalized = normalized.replace(/[\s\-\(\)]/g, '');
  
  return normalized;
}

/**
 * Get best bid and offer for each asset.
 */
export function getBestOrders(orderBook: Record<string, Order[]>): Record<string, { bid?: Order; offer?: Order }> {
  const best: Record<string, { bid?: Order; offer?: Order }> = {};
  const allOrders: Order[] = [];
  
  // Collect all active orders from all users
  for (const orders of Object.values(orderBook)) {
    for (const order of orders) {
      if (order.remaining > 0) {
        allOrders.push(order);
      }
    }
  }
  
  // Group by asset and find best prices
  for (const order of allOrders) {
    const asset = order.asset;
    if (!best[asset]) {
      best[asset] = {};
    }
    
    const side = order.action;
    const current = best[asset][side];
    
    const isBetter = (
      (side === 'bid' && (!current || order.price > current.price)) ||
      (side === 'offer' && (!current || order.price < current.price))
    );
    
    if (isBetter) {
      best[asset][side] = order;
    }
  }
  
  return best;
}

/**
 * Send WhatsApp message via Twilio.
 */
export async function sendWhatsAppMessage(toPhone: string, message: string): Promise<boolean> {
  if (!twilioClient || !TWILIO_PHONE_NUMBER) {
    console.warn('Twilio not configured, cannot send WhatsApp message');
    return false;
  }
  
  try {
    await twilioClient.messages.create({
      from: `whatsapp:${TWILIO_PHONE_NUMBER}`,
      body: message,
      to: `whatsapp:${toPhone}`
    });
    console.log(`WhatsApp message sent to ${toPhone}: ${message}`);
    return true;
  } catch (error) {
    console.error(`Failed to send WhatsApp message to ${toPhone}:`, error);
    return false;
  }
}

/**
 * Send trade confirmation to both participants via WhatsApp.
 */
export async function notifyTradeParticipants(trade: Trade): Promise<void> {
  const buyerUser = trade.buyer;
  const sellerUser = trade.seller;
  
  // Assuming USERS_DB is no longer available, so we'll just log the users
  console.log(`Trade executed: Buyer - ${buyerUser}, Seller - ${sellerUser}`);
  
  // In a real application, you would load user data from a database or config
  // For now, we'll just send a generic message
  const message = `🎉 TRADE EXECUTED!\nYou BOUGHT ${trade.amount} ${trade.asset} @ ${trade.price}\nCounterparty: ${trade.seller}\nTrade ID: ${trade.id.slice(0, 8)}`;
  await sendWhatsAppMessage(buyerUser, message);
  
  const message2 = `🎉 TRADE EXECUTED!\nYou SOLD ${trade.amount} ${trade.asset} @ ${trade.price}\nCounterparty: ${trade.buyer}\nTrade ID: ${trade.id.slice(0, 8)}`;
  await sendWhatsAppMessage(sellerUser, message2);
}

/**
 * Load user from database.
 */
export function loadUser(username: string): UserData | undefined {
  // Assuming USERS_DB is no longer available, so we'll just return a placeholder
  console.log('DEBUG: loadUser called with', username, '->', 'User data not available');
  return undefined;
}

/**
 * Enhanced order matching engine that matches across all users.
 */
export function matchOrders(orderBook: Record<string, Order[]>, tradeHistory: Trade[]): Trade[] {
  const matchedTrades: Trade[] = [];
  const allOrders: Order[] = [];
  
  // Collect all active orders
  for (const orders of Object.values(orderBook)) {
    for (const order of orders) {
      if (order.remaining > 0) {
        allOrders.push(order);
      }
    }
  }
  
  // Separate and sort orders
  const bids = allOrders
    .filter(o => o.action === 'bid')
    .sort((a, b) => {
      if (b.price !== a.price) return b.price - a.price; // Highest price first
      return new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(); // Then time priority
    });
    
  const offers = allOrders
    .filter(o => o.action === 'offer')
    .sort((a, b) => {
      if (a.price !== b.price) return a.price - b.price; // Lowest price first
      return new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(); // Then time priority
    });
  
  // Match orders
  for (const bid of bids) {
    if (bid.remaining <= 0) {
      continue;
    }
      
    for (const offer of offers) {
      if (offer.remaining <= 0) {
        continue;
      }
      
      // Check if orders can match
      if (bid.price >= offer.price && 
          bid.asset === offer.asset && 
          bid.user !== offer.user) { // Can't trade with yourself
          
        const tradeAmount = Math.min(bid.remaining, offer.remaining);
        const tradePrice = offer.price; // Price improvement goes to buyer
        
        const trade: Trade = {
          id: uuidv4(),
          timestamp: new Date().toISOString(),
          buyer: bid.user,
          seller: offer.user,
          asset: bid.asset,
          price: tradePrice,
          amount: tradeAmount,
          buyerOrderId: bid.id,
          sellerOrderId: offer.id
        };
        
        // Update order quantities
        bid.remaining -= tradeAmount;
        offer.remaining -= tradeAmount;
        
        // Mark as matched if fully filled
        if (bid.remaining === 0) {
          bid.matched = true;
          bid.counterparty = offer.user;
        }
        if (offer.remaining === 0) {
          offer.matched = true;
          offer.counterparty = bid.user;
        }
        
        matchedTrades.push(trade);
        tradeHistory.push(trade);
        
        console.log('Trade executed:', trade);
        
        // Send WhatsApp notifications
        notifyTradeParticipants(trade).catch(error => {
          console.error('Failed to send trade notifications:', error);
        });
      }
    }
  }
  
  // Remove fully matched orders
  for (const username in orderBook) {
    const userOrders = orderBook[username];
    if (userOrders) {
      orderBook[username] = userOrders.filter(o => o.remaining > 0);
    }
  }
  
  return matchedTrades;
}

// Re-export types for convenience
export interface UserData {
  username: string;
  password: string;
  phone: string;
  role: 'trader' | 'admin';
} 