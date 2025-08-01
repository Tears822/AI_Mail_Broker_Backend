import { v4 as uuidv4 } from 'uuid';
import { prisma } from '../database/prisma-client';
import { normalizeOrderInput } from '../utils';
import { redisUtils } from '../config/redis';
import { WebSocketService } from './websocket';
import { sendWhatsAppMessage } from './whatsapp';

/**
 * Enhanced Order Book System
 * Manages order matching, validation, and market data
 */
export class OrderBookService {
  private wsService?: WebSocketService;
  private matchingEngine?: any; // Reference to matching engine for immediate triggers

  constructor(wsService?: WebSocketService) {
    this.wsService = wsService;
  }

  // Method to set matching engine reference for immediate triggers
  public setMatchingEngine(matchingEngine: any) {
    this.matchingEngine = matchingEngine;
  }

  // Method to set WebSocket service (for external injection)
  public setWebSocketService(wsService: WebSocketService) {
    this.wsService = wsService;
  }

  /**
   * Create a new order
   */
  async createOrder(
    userId: string,
    action: 'BID' | 'OFFER',
    price: number,
    monthyear: string,
    product: string,
    amount: number,
    expiresAt?: Date
  ): Promise<{ order: any; errors: string[] }> {
    const errors: string[] = [];

    // Validate input
    if (amount <= 0) errors.push('Amount must be positive');
    if (price <= 0) errors.push('Price must be positive');
    if (!product || product.length < 2) errors.push('Invalid product');
    if (!monthyear || monthyear.length < 4) errors.push('Invalid contract');

    // Check user order limits
    const userOrdersCount = await prisma.order.count({
      where: {
        userId,
        status: 'ACTIVE'
      }
    });

    if (userOrdersCount >= 50) {
      errors.push('Maximum 50 orders per user');
    }

    if (errors.length > 0) {
      return { order: null, errors };
    }

    // Normalize input
    const [normalizedProduct, normalizedMonthyear] = normalizeOrderInput(product, monthyear);
    const asset = `${normalizedMonthyear}-${normalizedProduct}`;

    // Set expiration
    const orderExpiresAt = expiresAt || this.calculateExpiration();

    try {
      // Create order
      const order = await prisma.order.create({
        data: {
          action,
          price,
          asset,
          amount,
          remaining: amount,
          matched: false,
          counterparty: null,
          status: 'ACTIVE',
          expiresAt: orderExpiresAt,
          metadata: {
            originalProduct: product,
            originalMonthYear: monthyear
          },
          userId
        }
      });

      // Publish to Redis for real-time updates
      await redisUtils.publish('order:created', {
        orderId: order.id,
        userId: order.userId,
        asset: order.asset,
        action: order.action,
        price: order.price,
        amount: order.amount,
        timestamp: order.createdAt
      });

      // 📱 WhatsApp notification for order creation
      const user = await prisma.user.findUnique({
        where: { id: order.userId },
        select: { phone: true, username: true }
      });
      
      if (user?.phone) {
        const orderMessage = `✅ ORDER CREATED!

      ${order.asset.toUpperCase()} ${order.action}
      Amount: ${order.amount} lots
      Price: $${order.price} per lot
      Total Value: $${(Number(order.amount) * Number(order.price)).toFixed(2)}
      Order ID: ${order.id.slice(0, 8)}

      Your order is now active in the market.`;
        
        await sendWhatsAppMessage(user.phone, orderMessage);
        console.log(`📱 Order creation notification sent to ${user.username}`);
      }

      // Send market status update to other users
      // const marketStatusMessage = `New ${order.action.toLowerCase()} order: ${order.amount} lots @ $${order.price}`;
      // await this.broadcastMarketStatusToWhatsApp(order.asset, marketStatusMessage, order.userId);

      // Subscribe user to market room for this asset
      if (this.wsService) {
        this.wsService.subscribeUserToAsset(order.userId, order.asset);
      }

      // Update order book in Redis
      await this.updateOrderBookInRedis(asset);

      // 🔥 NEW: Send competitive bidding alerts after order creation
      await this.checkAndSendCompetitiveBiddingAlerts(asset, order);

      // Trigger matching engine for immediate processing
      if (this.matchingEngine) {
        this.matchingEngine.processAsset(asset);
        console.log(`[MATCHING_ENGINE] Triggered matching engine for asset: ${asset}`);
      } else {
        console.warn(`[MATCHING_ENGINE] Matching engine not initialized. Cannot trigger immediate matching for asset: ${asset}`);
      }

      return { order, errors: [] };
    } catch (error) {
      console.error('Error creating order:', error);
      return { order: null, errors: ['Failed to create order'] };
    }
  }

  // 🔥 NEW: Check for competitive bidding opportunities and send alerts
  private async checkAndSendCompetitiveBiddingAlerts(asset: string, newOrder: any): Promise<void> {
    try {
      // Get all active orders for this asset
      const orders = await prisma.order.findMany({
        where: {
          asset,
          status: 'ACTIVE',
          remaining: { gt: 0 }
        },
        orderBy: [
          { price: 'desc' },
          { createdAt: 'asc' }
        ]
      });

      const bids = orders.filter(o => o.action === 'BID');
      const offers = orders.filter(o => o.action === 'OFFER');

      if (bids.length === 0 || offers.length === 0) {
        return; // Need both bids and offers for competition
      }

      // Find best bid and best offer
      const bestBid = bids.reduce((a, b) => Number(a.price) > Number(b.price) ? a : b);
      const bestOffer = offers.reduce((a, b) => Number(a.price) < Number(b.price) ? a : b);

      const bidPrice = Number(bestBid.price);
      const offerPrice = Number(bestOffer.price);

      // Only send alerts if prices don't match but are close
      if (bidPrice >= offerPrice) {
        return; // Prices match or cross - will be handled by matching engine
      }

      const spread = offerPrice - bidPrice;
      const spreadPercentage = (spread / bidPrice) * 100;

      // Only send alerts if spread is reasonable (less than 20%)
      if (spreadPercentage > 20) {
        return;
      }

      console.log(`[COMPETITIVE] New order placed for ${asset}: checking competitive alerts`);

      // If the new order is a bid, alert about available offers
      if (newOrder.action === 'BID' && newOrder.id === bestBid.id) {
        const message = `💰 COMPETITIVE OPPORTUNITY!

${asset.toUpperCase()}
Your NEW BID: ${newOrder.remaining} lots @ $${newOrder.price}
Available OFFER: ${bestOffer.remaining} lots @ $${offerPrice}
Spread: $${spread.toFixed(2)} (${spreadPercentage.toFixed(1)}%)

💡 You could trade immediately by improving your bid to $${offerPrice}!
Your Order ID: ${newOrder.id.slice(0, 8)}

Use: "Edit ${newOrder.id.slice(0, 8)} price ${offerPrice}" to match the offer.`;

        await this.sendWhatsAppToUser(newOrder.userId, message);

        // Also notify the offer holder about the new competing bid
        const offerHolderMessage = `💰 COMPETITIVE OPPORTUNITY!

        ${asset.toUpperCase()}
        Your OFFER: ${bestOffer.remaining} lots @ $${offerPrice}
        Available NEW BID: ${newOrder.remaining} lots @ $${newOrder.price}
        Spread: $${spread.toFixed(2)} (${spreadPercentage.toFixed(1)}%)

        💡 You could trade immediately by lowering your offer to $${newOrder.price}!
        Your Order ID: ${bestOffer.id.slice(0, 8)}

        Use: "Edit ${bestOffer.id.slice(0, 8)} price ${newOrder.price}" to match the bid.`;

        await this.sendWhatsAppToUser(bestOffer.userId, offerHolderMessage);
      }

      // If the new order is an offer, alert about available bids
      if (newOrder.action === 'OFFER' && newOrder.id === bestOffer.id) {
        const message = `💰 COMPETITIVE OPPORTUNITY!

${asset.toUpperCase()}
Your NEW OFFER: ${newOrder.remaining} lots @ $${newOrder.price}
Available BID: ${bestBid.remaining} lots @ $${bidPrice}
Spread: $${spread.toFixed(2)} (${spreadPercentage.toFixed(1)}%)

💡 You could trade immediately by lowering your offer to $${bidPrice}!
Your Order ID: ${newOrder.id.slice(0, 8)}

Use: "Edit ${newOrder.id.slice(0, 8)} price ${bidPrice}" to match the bid.`;

        await this.sendWhatsAppToUser(newOrder.userId, message);

        // Also notify the bid holder about the new competing offer
        const bidHolderMessage = `💰 COMPETITIVE OPPORTUNITY!

${asset.toUpperCase()}
Your BID: ${bestBid.remaining} lots @ $${bidPrice}
Available NEW OFFER: ${newOrder.remaining} lots @ $${newOrder.price}
Spread: $${spread.toFixed(2)} (${spreadPercentage.toFixed(1)}%)

💡 You could trade immediately by improving your bid to $${newOrder.price}!
Your Order ID: ${bestBid.id.slice(0, 8)}

Use: "Edit ${bestBid.id.slice(0, 8)} price ${newOrder.price}" to match the offer.`;

        await this.sendWhatsAppToUser(bestBid.userId, bidHolderMessage);
      }

    } catch (error) {
      console.error('[COMPETITIVE] Error checking competitive bidding alerts:', error);
    }
  }

  // Helper method to send WhatsApp message to a specific user
  private async sendWhatsAppToUser(userId: string, message: string): Promise<void> {
    try {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { phone: true, username: true }
      });
      
      if (user?.phone) {
        await sendWhatsAppMessage(user.phone, message);
        console.log(`📱 Competitive bidding alert sent to ${user.username}`);
      }
    } catch (error) {
      console.error('Error sending WhatsApp to user:', error);
    }
  }

  /**
   * Cancel an order
   */
  async cancelOrder(userId: string, orderId: string): Promise<{ success: boolean; message: string }> {
    try {
      const order = await prisma.order.findFirst({
        where: {
          id: orderId,
          userId
        }
      });

      if (!order) {
        return { success: false, message: 'Order not found' };
      }

      if (order.status !== 'ACTIVE') {
        return { success: false, message: 'Order cannot be cancelled' };
      }

      await prisma.order.update({
        where: { id: orderId },
        data: { status: 'CANCELLED' }
      });

      // 📱 WhatsApp notification for order cancellation - enhanced to match web format
      const cancelUser = await prisma.user.findUnique({
        where: { id: userId },
        select: { phone: true, username: true }
      });

      if (cancelUser?.phone) {
        const cancelMessage = `❌ ORDER CANCELLED!

${order.asset.toUpperCase()} ${order.action}
Amount: ${order.remaining}/${order.amount} lots
Price: $${order.price} per lot
Order ID: ${order.id.slice(0, 8)}

Your order has been successfully cancelled and removed from the market.`;
        
        await sendWhatsAppMessage(cancelUser.phone, cancelMessage);
        console.log(`📱 Order cancellation notification sent to ${cancelUser.username}`);
      }

      // Publish to Redis for real-time updates
      await redisUtils.publish('order:cancelled', {
        orderId: order.id,
        userId: order.userId,
        asset: order.asset,
        timestamp: new Date().toISOString()
      });

      // Check if user has other active orders for this asset
      const otherActiveOrders = await prisma.order.findMany({
        where: {
          userId: order.userId,
          asset: order.asset,
          status: 'ACTIVE',
          remaining: { gt: 0 }
        }
      });

      // Unsubscribe user from market room if no other active orders for this asset
      if (otherActiveOrders.length === 0 && this.wsService) {
        this.wsService.unsubscribeUserFromAsset(order.userId, order.asset);
      }

      // Update order book in Redis
      await this.updateOrderBookInRedis(order.asset);

      return { success: true, message: `Order ${orderId} cancelled successfully` };
    } catch (error) {
      console.error('Error cancelling order:', error);
      return { success: false, message: 'Failed to cancel order' };
    }
  }

  /**
   * Update an order (price, amount, expiresAt) if still ACTIVE
   */
  async updateOrder(userId: string, orderId: string, updates: { price?: number; amount?: number; expiresAt?: Date }): Promise<{ success: boolean; message: string; order?: any }> {
    try {
      const order = await prisma.order.findFirst({
        where: {
          id: orderId,
          userId
        }
      });

      if (!order) {
        return { success: false, message: 'Order not found' };
      }

      if (order.status !== 'ACTIVE') {
        return { success: false, message: 'Order cannot be updated' };
      }

      // Only allow updates to price, amount, expiresAt
      const data: any = {};
      if (updates.price !== undefined) {
        if (updates.price <= 0) return { success: false, message: 'Price must be positive' };
        data.price = updates.price;
      }
      if (updates.amount !== undefined) {
        if (updates.amount <= 0) return { success: false, message: 'Amount must be positive' };
        data.amount = updates.amount;
        // If amount is reduced below remaining, also reduce remaining
        if (updates.amount < order.remaining) {
          data.remaining = updates.amount;
        }
      }
      if (updates.expiresAt !== undefined) {
        data.expiresAt = updates.expiresAt;
      }

      const updatedOrder = await prisma.order.update({
        where: { id: orderId },
        data
      });

      // Publish to Redis for real-time updates
      await redisUtils.publish('order:updated', {
        orderId: updatedOrder.id,
        userId: updatedOrder.userId,
        asset: updatedOrder.asset,
        action: updatedOrder.action,
        price: updatedOrder.price,
        amount: updatedOrder.amount,
        remaining: updatedOrder.remaining,
        timestamp: updatedOrder.updatedAt
      });

      // Update order book in Redis
      await this.updateOrderBookInRedis(updatedOrder.asset);

      // --- Broadcast best order update if needed ---
      // Fetch all active orders for this asset
      const orders = await prisma.order.findMany({
        where: { asset: updatedOrder.asset, status: 'ACTIVE', remaining: { gt: 0 } }
      });
      const bids = orders.filter(o => o.action === 'BID');
      const offers = orders.filter(o => o.action === 'OFFER');
      const bestBid = bids.length ? bids.reduce((a, b) => a.price > b.price ? a : b) : null;
      const bestOffer = offers.length ? offers.reduce((a, b) => a.price < b.price ? a : b) : null;
      // If the updated order is now the best bid/offer, or the best changed
      if (
        (bestBid && bestBid.id === updatedOrder.id) ||
        (bestOffer && bestOffer.id === updatedOrder.id)
      ) {
        // Get all userIds with active orders for this asset
        const userIds = [...new Set(orders.map(o => o.userId))];
        for (const userId of userIds) {
          this.wsService?.notifyUser(userId, 'market:bestOrderUpdated', {
            asset: updatedOrder.asset,
            bestBid,
            bestOffer,
            updatedOrder,
          });
        }
      }
      // --- End broadcast logic ---

      // Trigger immediate matching after order update
      if (this.matchingEngine) {
        this.matchingEngine.processAsset(updatedOrder.asset);
        console.log(`[MATCHING_ENGINE] Triggered matching engine after order update for asset: ${updatedOrder.asset}`);
      }

      // 📱 WhatsApp notification for order update
      const updateUser = await prisma.user.findUnique({
        where: { id: updatedOrder.userId },
        select: { phone: true, username: true }
      });

      if (updateUser?.phone) {
        const updateMessage = `📝 ORDER UPDATED!

${updatedOrder.asset.toUpperCase()} ${updatedOrder.action}
New Amount: ${updatedOrder.amount} lots
New Price: $${updatedOrder.price} per lot
New Total Value: $${(Number(updatedOrder.amount) * Number(updatedOrder.price)).toFixed(2)}
Order ID: ${updatedOrder.id.slice(0, 8)}

Your updated order is now active in the market.`;
        
        await sendWhatsAppMessage(updateUser.phone, updateMessage);
        console.log(`📱 Order update notification sent to ${updateUser.username}`);
      }

      return { success: true, message: 'Order updated successfully', order: updatedOrder };
    } catch (error) {
      console.error('Error updating order:', error);
      return { success: false, message: 'Failed to update order' };
    }
  }

  /**
   * Get user orders
   */
  async getUserOrders(userId: string): Promise<any[]> {
    try {
      return await prisma.order.findMany({
        where: { userId, status: 'ACTIVE' },
        orderBy: { createdAt: 'desc' }
      });
    } catch (error) {
      console.error('Error fetching user orders:', error);
      return [];
    }
  }

  /**
   * Get matched (fully traded) orders for a user
   */
  async getMatchedOrders(userId: string): Promise<any[]> {
    try {
      return await prisma.order.findMany({
        where: { userId, status: 'MATCHED' },
        orderBy: { createdAt: 'desc' }
      });
    } catch (error) {
      console.error('Error fetching matched orders:', error);
      return [];
    }
  }

  /**
   * Get market data for all assets (return all bids and offers, not just best price/total)
   * Ensures matched orders are properly excluded from marketplace display
   */
  async getMarketData(): Promise<any[]> {
    try {
      // Only get ACTIVE orders with remaining quantity > 0
      // This ensures matched orders (status = 'MATCHED') are excluded
      const orders = await prisma.order.findMany({
        where: {
          status: 'ACTIVE',
          remaining: { gt: 0 }
        },
        orderBy: [
          { price: 'desc' },
          { createdAt: 'asc' }
        ]
      });

      console.log(`[ORDER_BOOK] Found ${orders.length} active orders for market data`);

      // Group by asset
      const marketData: Record<string, any> = {};
      orders.forEach(order => {
        if (!marketData[order.asset]) {
          marketData[order.asset] = {
            asset: order.asset,
            bids: [],
            offers: []
          };
        }
        if (order.action === 'BID') {
          marketData[order.asset].bids.push({
            id: order.id,
            price: order.price,
            remaining: order.remaining,
            userId: order.userId,
            createdAt: order.createdAt
          });
        } else {
          marketData[order.asset].offers.push({
            id: order.id,
            price: order.price,
            remaining: order.remaining,
            userId: order.userId,
            createdAt: order.createdAt
          });
        }
      });

      // Sort bids (highest price first) and offers (lowest price first)
      Object.values(marketData).forEach((data: any) => {
        data.bids.sort((a: any, b: any) => Number(b.price) - Number(a.price) || new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
        data.offers.sort((a: any, b: any) => Number(a.price) - Number(b.price) || new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
      });

      const result = Object.values(marketData);
      console.log(`[ORDER_BOOK] Returning market data for ${result.length} assets`);
      
      return result;
    } catch (error) {
      console.error('Error fetching market data:', error);
      return [];
    }
  }

  /**
   * Get user-specific trades (both as buyer and seller)
   */
  async getUserTrades(userId: string, limit: number = 50): Promise<any[]> {
    try {
      return await prisma.trade.findMany({
        where: {
          OR: [
            { buyerId: userId },
            { sellerId: userId }
          ]
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
        include: {
          buyer: { select: { username: true } },
          seller: { select: { username: true } }
        }
      });
    } catch (error) {
      console.error('Error fetching user trades:', error);
      return [];
    }
  }

  /**
   * Get recent trades
   */
  async getRecentTrades(limit: number = 50): Promise<any[]> {
    try {
      return await prisma.trade.findMany({
        orderBy: { createdAt: 'desc' },
        take: limit,
        include: {
          buyer: { select: { username: true } },
          seller: { select: { username: true } }
        }
      });
    } catch (error) {
      console.error('Error fetching recent trades:', error);
      return [];
    }
  }

  /**
   * Get account summary
   */
  async getAccountSummary(userId: string): Promise<any> {
    const orders = await prisma.order.findMany({
      where: { userId }
    });

    const trades = await prisma.trade.findMany({
      where: {
        OR: [
          { buyerId: userId },
          { sellerId: userId }
        ]
      }
    });

    const totalOrders = orders.length;
    const activeOrders = orders.filter(order => order.status === 'ACTIVE').length;
    const totalTrades = trades.length;
    const totalVolume = trades.reduce((sum, trade) => sum + Number(trade.amount), 0);

    return {
      total_orders: totalOrders,
      active_orders: activeOrders,
      total_trades: totalTrades,
      total_volume: totalVolume,
      pnl_24h: 0 // TODO: Calculate P&L
    };
  }

  /**
   * Update order book in Redis cache
   */
  public async updateOrderBookInRedis(asset: string): Promise<void> {
    try {
      const orders = await prisma.order.findMany({
        where: {
          asset,
          status: 'ACTIVE',
          remaining: { gt: 0 }
        },
        orderBy: [
          { price: 'desc' },
          { createdAt: 'asc' }
        ]
      });

      await redisUtils.updateOrderBook(asset, orders);

      // Calculate current best prices
      const bids = orders.filter(o => o.action === 'BID');
      const offers = orders.filter(o => o.action === 'OFFER');
      const currentBestBid = bids.length > 0 ? Math.max(...bids.map(o => Number(o.price))) : null;
      const currentBestOffer = offers.length > 0 ? Math.min(...offers.map(o => Number(o.price))) : null;

      // Get previous best prices from Redis
      const previousBestBid = await redisUtils.get(`market:${asset}:bestBid`);
      const previousBestOffer = await redisUtils.get(`market:${asset}:bestOffer`);

      // Check if best prices have changed
      const bestBidChanged = currentBestBid !== (previousBestBid ? parseFloat(previousBestBid) : null);
      const bestOfferChanged = currentBestOffer !== (previousBestOffer ? parseFloat(previousBestOffer) : null);

      // Only broadcast if highest bid or lowest offer prices have changed
      if (bestBidChanged || bestOfferChanged) {
        console.log(`[MARKET] Best prices changed for ${asset}: Bid ${previousBestBid} -> ${currentBestBid}, Offer ${previousBestOffer} -> ${currentBestOffer}`);
        
        // Update stored best prices in Redis
        if (currentBestBid !== null) {
          await redisUtils.set(`market:${asset}:bestBid`, currentBestBid.toString(), 3600);
        } else {
          await redisUtils.del(`market:${asset}:bestBid`);
        }
        
        if (currentBestOffer !== null) {
          await redisUtils.set(`market:${asset}:bestOffer`, currentBestOffer.toString(), 3600);
        } else {
          await redisUtils.del(`market:${asset}:bestOffer`);
        }

        // Publish market update with price change information
        // This will be handled by WebSocketService.broadcastMarketUpdate() which targets relevant users
        await redisUtils.publish('market:update', {
          asset,
          bestBid: currentBestBid,
          bestOffer: currentBestOffer,
          previousBestBid: previousBestBid ? parseFloat(previousBestBid) : null,
          previousBestOffer: previousBestOffer ? parseFloat(previousBestOffer) : null,
          orders: orders.length,
          timestamp: new Date().toISOString(),
          priceChanged: true,
          changeType: {
            bidChanged: bestBidChanged,
            offerChanged: bestOfferChanged
          }
        });

        // Broadcast price change to relevant users only
        if (this.wsService) {
          this.wsService.broadcastMarketPriceChange({
            asset,
            bestBid: currentBestBid,
            bestOffer: currentBestOffer,
            previousBestBid: previousBestBid ? parseFloat(previousBestBid) : null,
            previousBestOffer: previousBestOffer ? parseFloat(previousBestOffer) : null,
            changeType: {
              bidChanged: bestBidChanged,
              offerChanged: bestOfferChanged
            },
            timestamp: new Date().toISOString()
          });
        }
      } else {
        console.log(`[MARKET] No price change for ${asset}: Bid ${currentBestBid}, Offer ${currentBestOffer}`);
      }
    } catch (error) {
      console.error('Error updating order book in Redis:', error);
    }
  }

  /**
   * Calculate order expiration time
   */
  private calculateExpiration(): Date {
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 24);
    return expiresAt;
  }

  /**
   * Calculate commission
   */
  private calculateCommission(amount: number, price: number): number {
    return Math.round((amount * price * 0.001) * 100) / 100;
  }

  /**
   * Get order book statistics
   */
  async getOrderBookStats(): Promise<any> {
    const orders = await prisma.order.findMany();
    const trades = await prisma.trade.findMany();

    const totalOrders = orders.length;
    const totalTrades = trades.length;
    const activeAssets = new Set(orders.map(o => o.asset)).size;
    const totalVolume = trades.reduce((sum, trade) => sum + Number(trade.amount), 0);

    return {
      totalOrders,
      totalTrades,
      activeAssets,
      totalVolume
    };
  }

  /**
   * Broadcast market status updates to WhatsApp for all users with active orders in the asset.
   */
  private async broadcastMarketStatusToWhatsApp(asset: string, message: string, excludeUserId?: string): Promise<void> {
    try {
      // Get all users with active orders for this asset
      const activeOrders = await prisma.order.findMany({
        where: {
          asset,
          status: 'ACTIVE',
          remaining: { gt: 0 },
          userId: excludeUserId ? { not: excludeUserId } : undefined
        },
        include: {
          user: {
            select: { phone: true, username: true }
          }
        }
      });

      // Get unique users and send notifications
      const uniqueUsers = new Map();
      activeOrders.forEach(order => {
        if (order.user?.phone && !uniqueUsers.has(order.user.phone)) {
          uniqueUsers.set(order.user.phone, order.user.username);
        }
      });

      const marketMessage = `📊 ${asset.toUpperCase()} MARKET: ${message}`;
      
      for (const [phone, username] of uniqueUsers) {
        await sendWhatsAppMessage(phone, marketMessage);
        console.log(`📱 Market status sent to ${username}`);
      }
      
      console.log(`[WHATSAPP] Market status sent to ${uniqueUsers.size} users for ${asset}`);
    } catch (error) {
      console.error('[WHATSAPP] Error broadcasting market status:', error);
    }
  }
}

export const orderBookService = new OrderBookService(); 