import { prisma } from '../database/prisma-client';
import { redisUtils } from '../config/redis';
import { WebSocketService } from './websocket';

// Remove the PendingApproval interface, pendingSellerApprovals, handleSellerApprovalResponse, and cleanupExpiredPendingTrades
// Only keep the new negotiation logic and partial fill logic

export class MatchingEngine {
  private wsService: WebSocketService;
  private isRunning: boolean = false;
  private matchingInterval: NodeJS.Timeout | null = null;
  private processingInterval: number = 60000; // 60 seconds - increased from 30 seconds
  private pendingPartialFills: Map<string, NodeJS.Timeout> = new Map();
  // Negotiation state per asset
  private negotiationState: Map<string, {
    bestBid: any;
    bestOffer: any;
    turn: 'BID' | 'OFFER';
    timeout: NodeJS.Timeout | null;
  }> = new Map();

  constructor(wsService: WebSocketService) {
    this.wsService = wsService;
  }

  public start(): void {
    if (this.isRunning) return;
    
    this.isRunning = true;
    console.log('🚀 Starting real-time matching engine...');

    // Start with a longer delay
    setTimeout(() => {
      this.matchingInterval = setInterval(() => {
        this.processMatching();
      }, this.processingInterval);
    }, 10000); // 10 second initial delay
  }

  public stop(): void {
    if (!this.isRunning) return;
    
    this.isRunning = false;
    if (this.matchingInterval) {
      clearInterval(this.matchingInterval);
      this.matchingInterval = null;
    }
    console.log('🛑 Matching engine stopped');
  }

  private async processMatching(): Promise<void> {
    try {
      // Robust Redis flag logic
      let hasActiveOrders = await redisUtils.get('matching:has_active_orders');
      let activeOrders = [];

      if (hasActiveOrders) {
        activeOrders = await this.getActiveOrders();
      } else {
        // Redis flag is missing or false, check DB directly
        activeOrders = await this.getActiveOrders();
        if (activeOrders.length > 0) {
          await redisUtils.set('matching:has_active_orders', true, 300);
        } else {
          await redisUtils.set('matching:has_active_orders', false, 300);
          console.log('📭 No active orders, skipping matching cycle');
          return; // No active orders, skip matching
        }
      }

      if (activeOrders.length === 0) {
        // Optionally, you can still set the Redis flag here if you want
        // await redisUtils.set('matching:has_active_orders', false, 300); // 5 minutes
        return;
      }

      // Process matching in memory
      await this.processMatchingInMemory(activeOrders);
      
    } catch (error) {
      console.error('Error in matching engine:', error);
    }
  }

  private async getActiveOrders(): Promise<any[]> {
    try {
      return await prisma.order.findMany({
        where: {
          status: 'ACTIVE',
          remaining: { gt: 0 }
        },
        orderBy: [
          { price: 'desc' },
          { createdAt: 'asc' }
        ]
      });
    } catch (error) {
      console.error('Error getting active orders:', error);
      return [];
    }
  }

  private async processMatchingInMemory(orders: any[]): Promise<void> {
    // Group by asset
    const ordersByAsset: Record<string, any[]> = {};
    
    for (const order of orders) {
      if (!ordersByAsset[order.asset]) {
        ordersByAsset[order.asset] = [];
      }
      ordersByAsset[order.asset].push(order);
    }

    console.log(`🔍 Processing ${Object.keys(ordersByAsset).length} assets`);

    // Process each asset
    for (const [asset, assetOrders] of Object.entries(ordersByAsset)) {
      await this.processAssetMatching(asset, assetOrders);
    }
  }

  private async processAssetMatching(asset: string, orders: any[]): Promise<void> {
    const bids = orders.filter(order => order.action === 'BID');
    const offers = orders.filter(order => order.action === 'OFFER');

    if (bids.length === 0 || offers.length === 0) {
      console.log(`[MATCHING] No bids or offers for asset ${asset}`);
      return;
    }

    // Find best bid and best offer
    const bestBid = bids.sort((a, b) => Number(b.price) - Number(a.price) || a.createdAt - b.createdAt)[0];
    const bestOffer = offers.sort((a, b) => Number(a.price) - Number(b.price) || a.createdAt - b.createdAt)[0];

    // Check if prices match for potential trade
    if (Number(bestBid.price) === Number(bestOffer.price)) {
      const bidQuantity = Number(bestBid.remaining);
      const offerQuantity = Number(bestOffer.remaining);
      
      console.log(`[MATCHING] Price match found for ${asset}: Bid ${bidQuantity} @ ${bestBid.price}, Offer ${offerQuantity} @ ${bestOffer.price}`);
      
      // Check for quantity mismatch
      if (bidQuantity !== offerQuantity) {
        const smallerQuantity = Math.min(bidQuantity, offerQuantity);
        const largerQuantity = Math.max(bidQuantity, offerQuantity);
        const additionalQuantity = largerQuantity - smallerQuantity;
        
        // Determine which party has the smaller quantity (they get asked to increase)
        const smallerParty = bidQuantity < offerQuantity ? 'BUYER' : 'SELLER';
        const smallerOrder = bidQuantity < offerQuantity ? bestBid : bestOffer;
        const largerOrder = bidQuantity < offerQuantity ? bestOffer : bestBid;
        
        console.log(`[MATCHING] Quantity mismatch detected: ${smallerParty} has ${smallerQuantity}, other party has ${largerQuantity}. Asking ${smallerParty} if they want additional ${additionalQuantity} lots.`);
        
        // Create a pending quantity confirmation
        const confirmationKey = `${asset}:${bestBid.id}:${bestOffer.id}`;
        
        // Send confirmation request to the smaller party
        this.wsService.notifyUser(smallerOrder.userId, 'quantity:confirmation_request', {
          confirmationKey,
          asset,
          yourOrderId: smallerOrder.id,
          counterpartyOrderId: largerOrder.id,
          yourQuantity: smallerQuantity,
          counterpartyQuantity: largerQuantity,
          additionalQuantity,
          price: bestBid.price, // Trade price
          side: smallerParty === 'BUYER' ? 'BUY' : 'SELL',
          message: `Do you want to ${smallerParty === 'BUYER' ? 'buy' : 'sell'} ${additionalQuantity} additional lots at $${bestBid.price}? (Total would be ${largerQuantity} lots instead of ${smallerQuantity} lots)`
        });
        
        // Set a timeout for the confirmation (30 seconds)
        setTimeout(() => {
          console.log(`[MATCHING] Quantity confirmation timeout for ${confirmationKey}, proceeding with partial trade`);
          this.handleQuantityConfirmationResponse(confirmationKey, false);
        }, 30000);
        
        return; // Wait for confirmation before proceeding
      }
      
      // If quantities match exactly, proceed with immediate execution
      await this.executeMatch(bestBid, bestOffer);
      return;
    }

    // If no negotiation state, start one
    if (!this.negotiationState.has(asset)) {
      this.negotiationState.set(asset, {
        bestBid,
        bestOffer,
        turn: 'OFFER', // Offer responds to new best bid
        timeout: null
      });
      this.notifyNegotiation(asset);
      return;
    }

    // If best bid/offer changed, update negotiation state and notify
    const state = this.negotiationState.get(asset)!;
    let updated = false;
    if (bestBid.id !== state.bestBid.id) {
      state.bestBid = bestBid;
      state.turn = 'OFFER';
      updated = true;
    }
    if (bestOffer.id !== state.bestOffer.id) {
      state.bestOffer = bestOffer;
      state.turn = 'BID';
      updated = true;
    }
    if (updated) {
      if (state.timeout) clearTimeout(state.timeout);
      this.notifyNegotiation(asset);
      return;
    }
  }

  // Notify the counterparty in negotiation
  private async notifyNegotiation(asset: string) {
    const state = this.negotiationState.get(asset);
    if (!state) return;
    const { bestBid, bestOffer, turn } = state;
    // Fetch usernames if not present
    let bestBidUsername = bestBid.user?.username;
    let bestOfferUsername = bestOffer.user?.username;
    if (!bestBidUsername || !bestOfferUsername) {
      const [bidUser, offerUser] = await Promise.all([
        prisma.user.findUnique({ where: { id: bestBid.userId } }),
        prisma.user.findUnique({ where: { id: bestOffer.userId } })
      ]);
      bestBidUsername = bestBidUsername || bidUser?.username || '';
      bestOfferUsername = bestOfferUsername || offerUser?.username || '';
    }
    if (turn === 'OFFER') {
      this.wsService.notifyUser(bestOffer.userId, 'negotiation:your_turn', {
        asset,
        bestBid: bestBid.price,
        bestOffer: bestOffer.price,
        bestBidUserId: bestBid.userId,
        bestOfferUserId: bestOffer.userId,
        bestBidUsername,
        bestOfferUsername,
        turn: 'OFFER',
        message: `A new best bid (${bestBid.price}) is available for ${asset}. Improve your offer or pass.`
      });
    } else {
      this.wsService.notifyUser(bestBid.userId, 'negotiation:your_turn', {
        asset,
        bestBid: bestBid.price,
        bestOffer: bestOffer.price,
        bestBidUserId: bestBid.userId,
        bestOfferUserId: bestOffer.userId,
        bestBidUsername,
        bestOfferUsername,
        turn: 'BID',
        message: `A new best offer (${bestOffer.price}) is available for ${asset}. Improve your bid or pass.`
      });
    }
    // Set timeout for response (e.g., 30 seconds)
    if (state.timeout) clearTimeout(state.timeout);
    state.timeout = setTimeout(() => {
      // On timeout, broadcast to all and clear negotiation
      this.wsService.broadcastMarketUpdate({
        asset,
        bestBid: bestBid.price,
        bestOffer: bestOffer.price,
        message: `Market for ${asset}: ${bestBid.price} (bid) / ${bestOffer.price} (offer)`
      });
      this.negotiationState.delete(asset);
    }, 30000);
  }

  // Call this when a user improves their price or passes
  public async handleNegotiationResponse(asset: string, userId: string, improved: boolean, newPrice?: number) {
    const state = this.negotiationState.get(asset);
    if (!state) return;
    if (state.timeout) clearTimeout(state.timeout);
    // If improved, update the user's order price if newPrice is provided
    if (improved && newPrice !== undefined) {
      // Determine if user is bestBid or bestOffer
      let orderToUpdate = null;
      if (state.turn === 'OFFER' && state.bestOffer.userId === userId) {
        orderToUpdate = state.bestOffer;
      } else if (state.turn === 'BID' && state.bestBid.userId === userId) {
        orderToUpdate = state.bestBid;
      }
      if (orderToUpdate) {
        await prisma.order.update({
          where: { id: orderToUpdate.id },
          data: { price: newPrice }
        });
      }
      // After update, refetch best bid/offer and continue negotiation
      const orders = await this.getActiveOrders();
      await this.processAssetMatching(asset, orders.filter(o => o.asset === asset));
      return;
    }
    // If improved (but no new price), switch turn and notify
    if (improved) {
      state.turn = state.turn === 'BID' ? 'OFFER' : 'BID';
      this.notifyNegotiation(asset);
    } else {
      // If not improved, broadcast to all and clear negotiation
      this.wsService.broadcastMarketUpdate({
        asset,
        bestBid: state.bestBid.price,
        bestOffer: state.bestOffer.price,
        message: `Market for ${asset}: ${state.bestBid.price} (bid) / ${state.bestOffer.price} (offer)`
      });
      this.negotiationState.delete(asset);
    }
  }

  // Handle quantity confirmation responses
  public async handleQuantityConfirmationResponse(confirmationKey: string, accepted: boolean, newQuantity?: number) {
    console.log(`[MATCHING] Quantity confirmation response: ${confirmationKey}, accepted: ${accepted}, newQuantity: ${newQuantity}`);
    
    const [asset, bidId, offerId] = confirmationKey.split(':');
    
    try {
      // Get the current orders
      const bid = await prisma.order.findUnique({ where: { id: bidId } });
      const offer = await prisma.order.findUnique({ where: { id: offerId } });
      
      if (!bid || !offer) {
        console.error(`[MATCHING] Orders not found for confirmation: ${bidId}, ${offerId}`);
        return;
      }
      
      if (accepted && newQuantity) {
        // User accepted and wants to increase their order quantity
        const smallerParty = Number(bid.remaining) < Number(offer.remaining) ? 'BUYER' : 'SELLER';
        
        if (smallerParty === 'BUYER') {
          // Update buyer's order to match seller's quantity
          await prisma.order.update({
            where: { id: bidId },
            data: { 
              amount: newQuantity,
              remaining: newQuantity
            }
          });
          console.log(`[MATCHING] Updated buyer order ${bidId} to ${newQuantity} lots`);
        } else {
          // Update seller's order to match buyer's quantity
          await prisma.order.update({
            where: { id: offerId },
            data: { 
              amount: newQuantity,
              remaining: newQuantity
            }
          });
          console.log(`[MATCHING] Updated seller order ${offerId} to ${newQuantity} lots`);
        }
        
        // Now both orders have matching quantities, execute the trade
        const updatedBid = await prisma.order.findUnique({ where: { id: bidId } });
        const updatedOffer = await prisma.order.findUnique({ where: { id: offerId } });
        
        if (updatedBid && updatedOffer) {
          await this.executeMatch(updatedBid, updatedOffer);
        }
      } else {
        // User declined or timeout, proceed with partial trade for smaller quantity
        console.log(`[MATCHING] User declined additional quantity or timeout, proceeding with partial trade`);
        await this.executeMatch(bid, offer);
      }
      
    } catch (error) {
      console.error('[MATCHING] Error handling quantity confirmation response:', error);
    }
  }

  private async executeMatch(bid: any, offer: any): Promise<void> {
    try {
      const tradeAmount = Math.min(Number(bid.remaining), Number(offer.remaining));
      const tradePrice = Number(offer.price);
      const commission = this.calculateCommission(tradeAmount, tradePrice);

      // Determine the type of match
      const bidQuantity = Number(bid.remaining);
      const offerQuantity = Number(offer.remaining);
      let matchType: 'FULL_MATCH' | 'PARTIAL_FILL_BUYER' | 'PARTIAL_FILL_SELLER';
      
      if (bidQuantity === offerQuantity) {
        matchType = 'FULL_MATCH';
      } else if (bidQuantity < offerQuantity) {
        matchType = 'PARTIAL_FILL_BUYER'; // Buyer gets filled, seller has remaining
      } else {
        matchType = 'PARTIAL_FILL_SELLER'; // Seller gets filled, buyer has remaining
      }

      console.log('[MATCHING] Attempting to create trade:', {
        asset: bid.asset,
        price: tradePrice,
        amount: tradeAmount,
        buyerOrderId: bid.id,
        sellerOrderId: offer.id,
        commission,
        buyerId: bid.userId,
        sellerId: offer.userId,
        matchType,
        bidQuantity,
        offerQuantity,
        scenario: matchType === 'PARTIAL_FILL_BUYER' ? 'SELLER_QUANTITY_GREATER_THAN_BUYER' : 
                 matchType === 'PARTIAL_FILL_SELLER' ? 'BUYER_QUANTITY_GREATER_THAN_SELLER' : 'EXACT_MATCH'
      });

      // Execute match with minimal database operations
      const result = await prisma.$transaction(async (tx) => {
        // Create trade
        const trade = await tx.trade.create({
          data: {
            asset: bid.asset,
            price: tradePrice,
            amount: tradeAmount,
            buyerOrderId: bid.id,
            sellerOrderId: offer.id,
            commission,
            buyerId: bid.userId,
            sellerId: offer.userId
          }
        });
        console.log('[MATCHING] Trade created:', trade);

        // Update orders
        const bidRemaining = Number(bid.remaining) - tradeAmount;
        const offerRemaining = Number(offer.remaining) - tradeAmount;

        const updatedBid = await tx.order.update({
          where: { id: bid.id },
          data: {
            remaining: bidRemaining,
            matched: bidRemaining === 0,
            counterparty: bidRemaining === 0 ? offer.userId : null,
            status: bidRemaining === 0 ? 'MATCHED' : 'ACTIVE'
          }
        });
        console.log('[MATCHING] Updated Bid Order:', updatedBid);

        const updatedOffer = await tx.order.update({
          where: { id: offer.id },
          data: {
            remaining: offerRemaining,
            matched: offerRemaining === 0,
            counterparty: offerRemaining === 0 ? bid.userId : null,
            status: offerRemaining === 0 ? 'MATCHED' : 'ACTIVE'
          }
        });
        console.log('[MATCHING] Updated Offer Order:', updatedOffer);

        // Log the specific scenario results
        if (matchType === 'PARTIAL_FILL_BUYER') {
          console.log(`[MATCHING] ✅ SELLER_QUANTITY > BUYER_QUANTITY: Buyer fully filled (${tradeAmount}), Seller has ${offerRemaining} remaining`);
        } else if (matchType === 'PARTIAL_FILL_SELLER') {
          console.log(`[MATCHING] ✅ BUYER_QUANTITY > SELLER_QUANTITY: Seller fully filled (${tradeAmount}), Buyer has ${bidRemaining} remaining`);
        } else {
          console.log(`[MATCHING] ✅ EXACT_MATCH: Both orders fully filled (${tradeAmount})`);
        }

        return { trade, bidRemaining, offerRemaining, updatedBid, updatedOffer, matchType };
      });

      if (!result.trade) {
        console.error('[MATCHING] Trade was not created!');
        return;
      }

      // Update order book in Redis FIRST, before publishing events
      await (new (require('./order-book').OrderBookService)()).updateOrderBookInRedis(bid.asset);
      console.log('[MATCHING] Order book updated in Redis for asset:', bid.asset);

      // Publish trade event for trade board
      await redisUtils.publish('trade:executed', {
        tradeId: result.trade.id,
        asset: result.trade.asset,
        price: result.trade.price,
        amount: result.trade.amount,
        buyerId: result.trade.buyerId,
        sellerId: result.trade.sellerId,
        timestamp: result.trade.createdAt,
        // Include order update information for frontend
        bidFullyMatched: result.bidRemaining === 0,
        offerFullyMatched: result.offerRemaining === 0,
        bidOrderId: bid.id,
        offerOrderId: offer.id,
        matchType: result.matchType,
        partialFill: result.matchType !== 'FULL_MATCH'
      });
      console.log('[MATCHING] Trade event published for trade board.');

      // Emit order:matched events for both orders if fully matched
      if (result.bidRemaining === 0) {
        console.log('[MATCHING] Bid fully matched, emitting order:matched event');
        this.wsService.notifyUser(bid.userId, 'order:matched', {
          orderId: bid.id,
          status: 'MATCHED',
          asset: bid.asset,
          price: tradePrice,
          amount: tradeAmount,
          tradeId: result.trade.id,
          matchType: result.matchType
        });
      }
      if (result.offerRemaining === 0) {
        console.log('[MATCHING] Offer fully matched, emitting order:matched event');
        this.wsService.notifyUser(offer.userId, 'order:matched', {
          orderId: offer.id,
          status: 'MATCHED',
          asset: bid.asset,
          price: tradePrice,
          amount: tradeAmount,
          tradeId: result.trade.id,
          matchType: result.matchType
        });
      }

      // Handle partial fills - notify the filled party and broadcast remaining to market
      if (result.matchType === 'PARTIAL_FILL_BUYER' && result.offerRemaining > 0) {
        console.log(`[MATCHING] 🔄 PARTIAL FILL: Buyer filled, seller has ${result.offerRemaining} remaining`);
        
        // Notify buyer about full fill
        this.wsService.notifyUser(bid.userId, 'order:filled', {
          orderId: bid.id,
          asset: bid.asset,
          amount: tradeAmount,
          price: tradePrice,
          tradeId: result.trade.id,
          message: `Your buy order was fully filled. Purchased ${tradeAmount} units at $${tradePrice}.`
        });

        // Notify seller about partial fill
        this.wsService.notifyUser(offer.userId, 'order:partial_fill', {
          orderId: offer.id,
          asset: bid.asset,
          originalAmount: offer.amount,
          filledAmount: tradeAmount,
          remainingAmount: result.offerRemaining,
          price: tradePrice,
          tradeId: result.trade.id,
          message: `Your sell order was partially filled. ${tradeAmount} units sold at $${tradePrice}, ${result.offerRemaining} units remaining.`
        });

        // 🚨 BROADCAST TO ALL RELEVANT COUNTERPARTIES ABOUT REMAINING QUANTITY
        this.wsService.broadcastMarketUpdate({
          asset: bid.asset,
          type: 'remaining_quantity_available',
          action: 'OFFER', // Remaining quantity is for sale
          remainingQuantity: result.offerRemaining,
          price: tradePrice,
          message: `🔥 TRADE EXECUTED: ${tradeAmount} ${bid.asset} @ $${tradePrice}. ${result.offerRemaining} lots still available for sale at $${tradePrice}!`,
          tradeExecuted: true,
          lastTradePrice: tradePrice,
          lastTradeAmount: tradeAmount
        });

      } else if (result.matchType === 'PARTIAL_FILL_SELLER' && result.bidRemaining > 0) {
        console.log(`[MATCHING] 🔄 PARTIAL FILL: Seller filled, buyer has ${result.bidRemaining} remaining`);
        
        // Notify seller about full fill
        this.wsService.notifyUser(offer.userId, 'order:filled', {
          orderId: offer.id,
          asset: bid.asset,
          amount: tradeAmount,
          price: tradePrice,
          tradeId: result.trade.id,
          message: `Your sell order was fully filled. Sold ${tradeAmount} units at $${tradePrice}.`
        });

        // Notify buyer about partial fill
        this.wsService.notifyUser(bid.userId, 'order:partial_fill', {
          orderId: bid.id,
          asset: bid.asset,
          originalAmount: bid.amount,
          filledAmount: tradeAmount,
          remainingAmount: result.bidRemaining,
          price: tradePrice,
          tradeId: result.trade.id,
          message: `Your buy order was partially filled. ${tradeAmount} units purchased at $${tradePrice}, ${result.bidRemaining} units remaining.`
        });

        // 🚨 BROADCAST TO ALL RELEVANT COUNTERPARTIES ABOUT REMAINING QUANTITY
        this.wsService.broadcastMarketUpdate({
          asset: bid.asset,
          type: 'remaining_quantity_available',
          action: 'BID', // Remaining quantity is wanted for purchase
          remainingQuantity: result.bidRemaining,
          price: tradePrice,
          message: `🔥 TRADE EXECUTED: ${tradeAmount} ${bid.asset} @ $${tradePrice}. ${result.bidRemaining} lots still wanted at $${tradePrice}!`,
          tradeExecuted: true,
          lastTradePrice: tradePrice,
          lastTradeAmount: tradeAmount
        });
      } else {
        // Full match - broadcast successful trade completion
        this.wsService.broadcastMarketUpdate({
          asset: bid.asset,
          type: 'trade_completed',
          message: `✅ TRADE COMPLETED: ${tradeAmount} ${bid.asset} @ $${tradePrice}`,
          tradeExecuted: true,
          lastTradePrice: tradePrice,
          lastTradeAmount: tradeAmount
        });
      }

      // Always broadcast updated market data to show new best orders after this trade
      const updatedMarketData = await (new (require('./order-book').OrderBookService)()).getMarketData();
      const assetMarketData = updatedMarketData.find((m: any) => m.asset === bid.asset);
      
      if (assetMarketData) {
        this.wsService.broadcastMarketUpdate({
          asset: bid.asset,
          ...assetMarketData,
          tradeExecuted: true,
          lastTradePrice: tradePrice,
          lastTradeAmount: tradeAmount,
          matchType: result.matchType
        });
      }

      // Handle partial fill logic
      if (result.bidRemaining > 0 && result.offerRemaining === 0) {
        console.log('[MATCHING] Partial fill: bid still has remaining, offer fully matched.');
        // Notify buyer for remaining lots
        this.wsService.notifyUser(bid.userId, 'partial_fill', {
          asset: bid.asset,
          remaining: result.bidRemaining,
          price: tradePrice,
          message: `You have ${result.bidRemaining} lots remaining for ${bid.asset} at ${tradePrice}. Would you like to buy the rest?`
        });

        // Set up a listener for buyer response (pseudo event, you must handle this on the frontend)
        const responseHandler = async (response: { userId: string, accept: boolean }) => {
          console.log('[MATCHING] Partial fill response received:', response);
          if (response.userId === bid.userId) {
            clearTimeout(this.pendingPartialFills.get(bid.id));
            this.pendingPartialFills.delete(bid.id);
            if (response.accept) {
              // Create a new order for the remaining lots
              await prisma.order.create({
                data: {
                  action: 'BID',
                  price: tradePrice,
                  asset: bid.asset,
                  amount: result.bidRemaining,
                  remaining: result.bidRemaining,
                  matched: false,
                  counterparty: null,
                  status: 'ACTIVE',
                  expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
                  metadata: {},
                  userId: bid.userId
                }
              });
              await redisUtils.set('matching:has_active_orders', true, 300);
              console.log('[MATCHING] New order created for remaining lots after partial fill.');
            } else {
              // Notify all traders about remaining lots
              this.wsService.broadcastMarketUpdate({
                asset: bid.asset,
                remaining: result.bidRemaining,
                price: tradePrice,
                message: `A trade occurred at ${tradePrice} for ${bid.asset}. ${result.bidRemaining} lots remain available.`
              });
              console.log('[MATCHING] Buyer declined remaining lots after partial fill.');
            }
          }
        };
        // Listen for a custom event (pseudo-code, you must wire this up in your websocket event handlers)
        this.wsService.getIO().once(`partial_fill_response:${bid.userId}:${bid.id}`, responseHandler);

        // Set a timeout for buyer response (e.g., 60 seconds)
        const timeout = setTimeout(() => {
          this.wsService.getIO().removeListener(`partial_fill_response:${bid.userId}:${bid.id}`, responseHandler);
          this.pendingPartialFills.delete(bid.id);
          // Notify all traders about remaining lots
          this.wsService.broadcastMarketUpdate({
            asset: bid.asset,
            remaining: result.bidRemaining,
            price: tradePrice,
            message: `A trade occurred at ${tradePrice} for ${bid.asset}. ${result.bidRemaining} lots remain available.`
          });
          console.warn('[MATCHING] Partial fill response timed out.');
        }, 60000);
        this.pendingPartialFills.set(bid.id, timeout);
      } else if (result.offerRemaining > 0 && result.bidRemaining === 0) {
        // Notify all traders about remaining lots
        this.wsService.broadcastMarketUpdate({
          asset: offer.asset,
          remaining: result.offerRemaining,
          price: tradePrice,
          message: `A trade occurred at ${tradePrice} for ${offer.asset}. ${result.offerRemaining} lots remain available.`
        });
        console.log('[MATCHING] Offer still has remaining after trade.');
      }

      console.log(`💱 Trade executed: ${tradeAmount} ${bid.asset} @ ${tradePrice}`);
    } catch (error) {
      console.error('[MATCHING] Error executing match:', error);
    }
  }

  private calculateCommission(amount: number, price: number): number {
    return Math.round((amount * price * 0.001) * 100) / 100;
  }

  public async getOrderBook(asset: string): Promise<any> {
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

      const bids = orders.filter(order => order.action === 'BID');
      const offers = orders.filter(order => order.action === 'OFFER');

      return {
        asset,
        bids: bids.slice(0, 10),
        offers: offers.slice(0, 10),
        totalBids: bids.length,
        totalOffers: offers.length,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      console.error('Error getting order book:', error);
      return {
        asset,
        bids: [],
        offers: [],
        totalBids: 0,
        totalOffers: 0,
        timestamp: new Date().toISOString()
      };
    }
  }

  // Method to mark that there are active orders (called when orders are created)
  public async markActiveOrders(): Promise<void> {
    await redisUtils.set('matching:has_active_orders', true, 300); // 5 minutes
  }
} 