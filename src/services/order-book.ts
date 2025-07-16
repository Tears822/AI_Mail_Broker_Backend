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
  constructor(wsService?: WebSocketService) {
    this.wsService = wsService;
  }
  setWebSocketService(wsService: WebSocketService) {
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

      // Subscribe user to market room for this asset
      if (this.wsService) {
        this.wsService.subscribeUserToAsset(order.userId, order.asset);
      }

      // Update order book in Redis
      await this.updateOrderBookInRedis(asset);

      return { order, errors: [] };
    } catch (error) {
      console.error('Error creating order:', error);
      errors.push('Failed to create order');
      return { order: null, errors };
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

      // WhatsApp notification
      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (user && user.phone) {
        await sendWhatsAppMessage(user.phone, `Your order ${orderId} for ${order.asset} has been cancelled.`);
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

      // WhatsApp notification
      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (user && user.phone) {
        await sendWhatsAppMessage(user.phone, `Your order ${orderId} for ${updatedOrder.asset} has been updated. New price: ${updatedOrder.price}, amount: ${updatedOrder.amount}.`);
      }

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

      return { success: true, message: `Order ${orderId} updated successfully`, order: updatedOrder };
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
}

export const orderBookService = new OrderBookService(); 