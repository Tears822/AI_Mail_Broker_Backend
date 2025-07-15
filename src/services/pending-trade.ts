import { prisma } from '../database/prisma-client';

export class PendingTradeService {
  /**
   * Create a new pending trade approval request
   */
  async createPendingTrade(
    bidId: string,
    offerId: string,
    asset: string,
    price: number,
    amount: number,
    product: string,
    monthyear: string,
    buyerId: string,
    sellerId: string,
    timeoutMinutes: number = 1
  ): Promise<any> {
    try {
      const expiresAt = new Date(Date.now() + timeoutMinutes * 60 * 1000);
      
      const pendingTrade = await prisma.pendingTrade.create({
        data: {
          bidId,
          offerId,
          asset,
          price,
          amount,
          product,
          monthyear,
          buyerId,
          sellerId,
          expiresAt
        },
        include: {
          bid: true,
          offer: true,
          buyer: true,
          seller: true
        }
      });

      console.log('[PENDING_TRADE] Created pending trade:', pendingTrade.id);
      return pendingTrade;
    } catch (error) {
      console.error('[PENDING_TRADE] Error creating pending trade:', error);
      throw error;
    }
  }

  /**
   * Get pending trades for a seller
   */
  async getPendingTradesForSeller(sellerId: string): Promise<any[]> {
    try {
      return await prisma.pendingTrade.findMany({
        where: {
          sellerId,
          status: 'PENDING',
          expiresAt: { gt: new Date() }
        },
        include: {
          bid: true,
          offer: true,
          buyer: true,
          seller: true
        },
        orderBy: { createdAt: 'desc' }
      });
    } catch (error) {
      console.error('[PENDING_TRADE] Error getting pending trades for seller:', error);
      return [];
    }
  }

  /**
   * Update pending trade status
   */
  async updatePendingTradeStatus(
    bidId: string,
    offerId: string,
    status: 'APPROVED' | 'REJECTED' | 'TIMEOUT'
  ): Promise<any> {
    try {
      const updatedTrade = await prisma.pendingTrade.updateMany({
        where: {
          bidId,
          offerId,
          status: 'PENDING'
        },
        data: {
          status,
          updatedAt: new Date()
        }
      });

      console.log(`[PENDING_TRADE] Updated pending trade status to ${status}:`, { bidId, offerId });
      return updatedTrade;
    } catch (error) {
      console.error('[PENDING_TRADE] Error updating pending trade status:', error);
      throw error;
    }
  }

  /**
   * Get pending trade by bid and offer IDs
   */
  async getPendingTrade(bidId: string, offerId: string): Promise<any | null> {
    try {
      return await prisma.pendingTrade.findFirst({
        where: {
          bidId,
          offerId,
          status: 'PENDING'
        },
        include: {
          bid: true,
          offer: true,
          buyer: true,
          seller: true
        }
      });
    } catch (error) {
      console.error('[PENDING_TRADE] Error getting pending trade:', error);
      return null;
    }
  }

  /**
   * Clean up expired pending trades
   */
  async cleanupExpiredPendingTrades(): Promise<void> {
    try {
      const result = await prisma.pendingTrade.updateMany({
        where: {
          status: 'PENDING',
          expiresAt: { lt: new Date() }
        },
        data: {
          status: 'TIMEOUT',
          updatedAt: new Date()
        }
      });

      if (result.count > 0) {
        console.log(`[PENDING_TRADE] Cleaned up ${result.count} expired pending trades`);
      }
    } catch (error) {
      console.error('[PENDING_TRADE] Error cleaning up expired pending trades:', error);
    }
  }

  /**
   * Get all pending trades (for admin purposes)
   */
  async getAllPendingTrades(): Promise<any[]> {
    try {
      return await prisma.pendingTrade.findMany({
        where: {
          status: 'PENDING'
        },
        include: {
          bid: true,
          offer: true,
          buyer: true,
          seller: true
        },
        orderBy: { createdAt: 'desc' }
      });
    } catch (error) {
      console.error('[PENDING_TRADE] Error getting all pending trades:', error);
      return [];
    }
  }
} 