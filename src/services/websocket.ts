import { Server as SocketIOServer } from 'socket.io';
import { Server as HTTPServer } from 'http';
import jwt from 'jsonwebtoken';
import { SECRET_KEY } from '../config';
import { redisUtils } from '../config/redis';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export interface SocketUser {
  userId: string;
  username: string;
  role: string;
  socketId: string;
}

export class WebSocketService {
  private io: SocketIOServer;
  private connectedUsers: Map<string, SocketUser> = new Map();
  private matchingEngine: any = null; // Will be set by the server

  constructor(server: HTTPServer) {
    const allowedOrigins = [
      process.env.FRONTEND_URL || "http://localhost:3000",
      "https://giftcard.88808880.xyz",
      "https://api.giftcard.88808880.xyz", 
      "https://webhook.88808880.xyz",
      "http://localhost:3000",
      "http://localhost:3001"
    ];

    this.io = new SocketIOServer(server, {
      cors: {
        origin: (origin, callback) => {
          // Allow requests with no origin (like mobile apps or curl requests)
          if (!origin) return callback(null, true);
          
          if (allowedOrigins.includes(origin)) {
            callback(null, true);
          } else {
            console.warn(`WebSocket CORS blocked request from: ${origin}`);
            console.log(`Allowed origins: ${allowedOrigins.join(', ')}`);
            callback(new Error('Not allowed by CORS'));
          }
        },
        methods: ["GET", "POST"],
        credentials: true
      },
      transports: ['websocket', 'polling']
    });

    this.setupMiddleware();
    this.setupEventHandlers();
    this.setupRedisSubscriptions();
  }

  // Method to set the matching engine reference
  public setMatchingEngine(matchingEngine: any) {
    this.matchingEngine = matchingEngine;
  }

  private setupMiddleware() {
    // Authentication middleware
    this.io.use(async (socket, next) => {
      try {
        console.log('[WebSocket AUTH] New connection attempt from:', socket.handshake.address);
        console.log('[WebSocket AUTH] Headers:', {
          origin: socket.handshake.headers.origin,
          userAgent: socket.handshake.headers['user-agent']
        });
        
        const token = socket.handshake.auth.token || socket.handshake.headers.authorization?.replace('Bearer ', '');
        console.log('[WebSocket AUTH] Token received:', token ? `${token.slice(0, 20)}...` : 'NO TOKEN');
        
        if (!token) {
          console.error('[WebSocket AUTH] Authentication failed: No token provided');
          return next(new Error('Authentication error: No token provided'));
        }

        console.log('[WebSocket AUTH] Verifying JWT token...');
        const decoded = jwt.verify(token, SECRET_KEY) as any;
        console.log('[WebSocket AUTH] JWT decoded successfully:', {
          userId: decoded.userId,
          username: decoded.username,
          role: decoded.role,
          exp: new Date(decoded.exp * 1000).toISOString()
        });
        
        const user: SocketUser = {
          userId: decoded.userId,
          username: decoded.username,
          role: decoded.role,
          socketId: socket.id
        };

        socket.data.user = user;
        this.connectedUsers.set(user.userId, user);
        
        console.log('[WebSocket AUTH] Storing user session in Redis...');
        // Store user session in Redis
        await redisUtils.setUserSession(user.userId, {
          socketId: socket.id,
          connectedAt: new Date().toISOString(),
          username: user.username,
          role: user.role
        });

        console.log('[WebSocket AUTH] Authentication successful for user:', user.username);
        next();
      } catch (error) {
        console.error('[WebSocket AUTH] Authentication error:', error);
        console.error('[WebSocket AUTH] Error details:', {
          message: (error as Error).message,
          name: (error as Error).name,
          stack: (error as Error).stack?.split('\n')[0]
        });
        next(new Error('Authentication error: Invalid token'));
      }
    });
  }

  private setupEventHandlers() {
    this.io.on('connection', (socket) => {
      const user = socket.data.user as SocketUser;
      console.log(`🔌 User connected: ${user.username} (${user.userId})`);

      // Join user to their personal room
      socket.join(`user:${user.userId}`);

      // Join admin room if user is admin
      if (user.role === 'ADMIN') {
        socket.join('admin');
      }

      // Automatically subscribe user to market rooms for their active orders
      this.subscribeUserToActiveOrderAssets(user.userId, socket);

      // Handle order updates
      socket.on('subscribe_orders', () => {
        socket.join('orders');
        console.log(`📊 User ${user.username} subscribed to order updates`);
      });

      // Handle market data updates
      socket.on('subscribe_market', (asset: string) => {
        socket.join(`market:${asset}`);
        console.log(`📈 User ${user.username} subscribed to market data for ${asset}`);
      });

      // Handle trade updates
      socket.on('subscribe_trades', () => {
        socket.join('trades');
        console.log(`💱 User ${user.username} subscribed to trade updates`);
      });

      // Handle seller approval responses
      socket.on('match:approval_response', (data: any) => {
        console.log(`[WEBSOCKET] Received match:approval_response from ${user.username}:`, data);
        if (this.matchingEngine && data.offerId && data.bidId !== undefined && data.approved !== undefined) {
          this.matchingEngine.handleSellerApprovalResponse(data.offerId, data.bidId, data.approved);
        } else {
          console.warn('[WEBSOCKET] Invalid match:approval_response data:', data);
        }
      });

      // Handle quantity confirmation responses
      socket.on('quantity:confirmation_response', (data: any) => {
        console.log(`[WEBSOCKET] Received quantity:confirmation_response from ${user.username}:`, data);
        if (this.matchingEngine && data.confirmationKey && data.accepted !== undefined) {
          this.matchingEngine.handleQuantityConfirmationResponse(data.confirmationKey, data.accepted, data.newQuantity);
        } else {
          console.warn('[WEBSOCKET] Invalid quantity:confirmation_response data:', data);
        }
      });

      // Handle disconnect
      socket.on('disconnect', () => {
        console.log(`🔌 User disconnected: ${user.username} (${user.userId})`);
        this.connectedUsers.delete(user.userId);
        redisUtils.removeUserSession(user.userId);
      });

      // Handle errors
      socket.on('error', (error) => {
        console.error(`Socket error for user ${user.username}:`, error);
      });
    });
  }

  /**
   * Subscribe user to market rooms for assets they have active orders in
   */
  private async subscribeUserToActiveOrderAssets(userId: string, socket: any) {
    try {
      // Get user's active orders
      const activeOrders = await prisma.order.findMany({
        where: {
          userId,
          status: 'ACTIVE',
          remaining: { gt: 0 }
        },
        select: { asset: true }
      });

      // Subscribe to market rooms for each asset
      const uniqueAssets = [...new Set(activeOrders.map(order => order.asset))];
      for (const asset of uniqueAssets) {
        socket.join(`market:${asset}`);
        console.log(`📈 Auto-subscribed user ${userId} to market:${asset}`);
      }
    } catch (error) {
      console.error('[WebSocket] Error subscribing user to active order assets:', error);
    }
  }

  /**
   * Subscribe a user to a specific asset market room
   */
  public subscribeUserToAsset(userId: string, asset: string) {
    const user = this.connectedUsers.get(userId);
    if (user) {
      const socket = this.io.sockets.sockets.get(user.socketId);
      if (socket) {
        socket.join(`market:${asset}`);
        console.log(`📈 User ${userId} subscribed to market:${asset}`);
      }
    }
  }

  /**
   * Unsubscribe a user from a specific asset market room
   */
  public unsubscribeUserFromAsset(userId: string, asset: string) {
    const user = this.connectedUsers.get(userId);
    if (user) {
      const socket = this.io.sockets.sockets.get(user.socketId);
      if (socket) {
        socket.leave(`market:${asset}`);
        console.log(`📈 User ${userId} unsubscribed from market:${asset}`);
      }
    }
  }

  private setupRedisSubscriptions() {
    // Subscribe to Redis channels for real-time updates
    redisUtils.subscribe('order:created', (data) => {
      this.broadcastOrderCreated(data);
    });

    redisUtils.subscribe('order:matched', (data) => {
      this.broadcastOrderMatched(data);
    });

    redisUtils.subscribe('order:cancelled', (data) => {
      this.broadcastOrderCancelled(data);
    });

    redisUtils.subscribe('trade:executed', (data) => {
      this.broadcastTradeExecuted(data);
    });

    redisUtils.subscribe('market:update', (data) => {
      this.broadcastMarketUpdate(data);
    });
    
    // Subscribe to order:updated and broadcast to all subscribers
    redisUtils.subscribe('order:updated', (data) => {
      this.broadcastOrderUpdated(data);
    });
  }

  // Broadcast methods
  public broadcastOrderCreated(orderData: any) {
    // Only broadcast to users who have active orders for the same asset
    this.io.to('orders').emit('order:created', {
      type: 'order_created',
      data: orderData,
      timestamp: new Date().toISOString()
    });
  }

  public broadcastOrderMatched(matchData: any) {
    // Only notify the specific buyer and seller involved in the match
    if (matchData.buyerId) {
      this.io.to(`user:${matchData.buyerId}`).emit('order:matched', {
        type: 'order_matched',
        data: { ...matchData, side: 'buy' },
        timestamp: new Date().toISOString()
      });
    }

    if (matchData.sellerId) {
      this.io.to(`user:${matchData.sellerId}`).emit('order:matched', {
        type: 'order_matched',
        data: { ...matchData, side: 'sell' },
        timestamp: new Date().toISOString()
      });
    }

    // Only broadcast to users with active orders for the same asset
    // This allows other traders to see market activity without unnecessary broadcasts
    if (matchData.asset) {
      this.io.to(`market:${matchData.asset}`).emit('order:matched', {
        type: 'order_matched',
        data: matchData,
        timestamp: new Date().toISOString()
      });
    }
  }

  public broadcastOrderCancelled(cancelData: any) {
    // Only notify the order owner who cancelled their order
    // Order cancellations should not be broadcasted to other users
    if (cancelData.userId) {
      console.log(`[WEBSOCKET] Order cancelled notification sent to user ${cancelData.userId}:`, {
        orderId: cancelData.orderId,
        asset: cancelData.asset,
        action: cancelData.action
      });
      
      this.io.to(`user:${cancelData.userId}`).emit('order:cancelled', {
        type: 'order_cancelled',
        data: cancelData,
        timestamp: new Date().toISOString()
      });
    }
    
    // Note: Order cancellations are not broadcasted to other users
    // Market state changes (price changes) are handled separately by updateOrderBookInRedis
  }

  public broadcastTradeExecuted(tradeData: any) {
    // Only notify the specific buyer and seller involved in the trade
    if (tradeData.buyerId) {
      this.io.to(`user:${tradeData.buyerId}`).emit('trade:executed', {
        type: 'trade_executed',
        data: { ...tradeData, side: 'buy' },
        timestamp: new Date().toISOString()
      });
    }

    if (tradeData.sellerId) {
      this.io.to(`user:${tradeData.sellerId}`).emit('trade:executed', {
        type: 'trade_executed',
        data: { ...tradeData, side: 'sell' },
        timestamp: new Date().toISOString()
      });
    }

    // Only broadcast to users with active orders for the same asset
    // This allows other traders to see market activity without unnecessary broadcasts
    if (tradeData.asset) {
      this.io.to(`market:${tradeData.asset}`).emit('trade:executed', {
        type: 'trade_executed',
        data: tradeData,
        timestamp: new Date().toISOString()
      });
    }
  }

  public broadcastMarketUpdate(marketData: any) {
    // Only broadcast to users with active orders for the specific asset
    if (marketData.asset) {
      this.io.to(`market:${marketData.asset}`).emit('market:update', {
        type: 'market_update',
        data: marketData,
        timestamp: new Date().toISOString()
      });
    } else {
      // If no specific asset, broadcast to all market subscribers
      this.io.to('orders').emit('market:update', {
        type: 'market_update',
        data: marketData,
        timestamp: new Date().toISOString()
      });
    }
  }

  /**
   * Broadcast market price changes to relevant users only
   * This is called when highest bid or lowest offer prices change
   */
  public broadcastMarketPriceChange(priceChangeData: any) {
    // Only notify users with active orders for the specific asset
    if (priceChangeData.asset) {
      this.io.to(`market:${priceChangeData.asset}`).emit('market:priceChanged', {
        type: 'market_price_changed',
        data: priceChangeData,
        timestamp: new Date().toISOString()
      });
      
      console.log(`[MARKET] Price change broadcast for ${priceChangeData.asset}:`, {
        bidChanged: priceChangeData.changeType?.bidChanged,
        offerChanged: priceChangeData.changeType?.offerChanged,
        previousBid: priceChangeData.previousBestBid,
        currentBid: priceChangeData.bestBid,
        previousOffer: priceChangeData.previousBestOffer,
        currentOffer: priceChangeData.bestOffer
      });
    }
  }

  public broadcastOrderUpdated(orderData: any) {
    // Only notify the order owner
    if (orderData.userId) {
      this.io.to(`user:${orderData.userId}`).emit('order:updated', {
        type: 'order_updated',
        data: orderData,
        timestamp: new Date().toISOString()
      });
    }

    // Only broadcast to users with active orders for the same asset if it's a SELLER (OFFER) update
    // Buyers (BID) updating their orders should not trigger broadcasts to other users
    if (orderData.asset && orderData.action === 'OFFER') {
      console.log(`[WEBSOCKET] Broadcasting seller order update for ${orderData.asset}:`, {
        orderId: orderData.orderId,
        userId: orderData.userId,
        action: orderData.action,
        price: orderData.price,
        amount: orderData.amount
      });
      
      this.io.to(`market:${orderData.asset}`).emit('order:updated', {
        type: 'order_updated',
        data: orderData,
        timestamp: new Date().toISOString()
      });
    } else if (orderData.asset && orderData.action === 'BID') {
      console.log(`[WEBSOCKET] Skipping broadcast for buyer order update for ${orderData.asset}:`, {
        orderId: orderData.orderId,
        userId: orderData.userId,
        action: orderData.action,
        price: orderData.price,
        amount: orderData.amount
      });
    }
  }

  // Direct user notifications
  public notifyUser(userId: string, event: string, data: any) {
    this.io.to(`user:${userId}`).emit(event, {
      type: event,
      data,
      timestamp: new Date().toISOString()
    });
  }

  // Admin notifications
  public notifyAdmins(event: string, data: any) {
    this.io.to('admin').emit(event, {
      type: event,
      data,
      timestamp: new Date().toISOString()
    });
  }

  // Get connected users
  public getConnectedUsers(): SocketUser[] {
    return Array.from(this.connectedUsers.values());
  }

  // Get user by ID
  public getUserById(userId: string): SocketUser | undefined {
    return this.connectedUsers.get(userId);
  }

  // Get socket instance
  public getIO(): SocketIOServer {
    return this.io;
  }
} 