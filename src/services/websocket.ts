import { Server as SocketIOServer } from 'socket.io';
import { Server as HTTPServer } from 'http';
import jwt from 'jsonwebtoken';
import { SECRET_KEY } from '../config';
import { redisUtils } from '../config/redis';

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
    this.io = new SocketIOServer(server, {
      cors: {
        origin: process.env.FRONTEND_URL || "http://localhost:3000",
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
        const token = socket.handshake.auth.token || socket.handshake.headers.authorization?.replace('Bearer ', '');
        
        if (!token) {
          return next(new Error('Authentication error: No token provided'));
        }

        const decoded = jwt.verify(token, SECRET_KEY) as any;
        const user: SocketUser = {
          userId: decoded.userId,
          username: decoded.username,
          role: decoded.role,
          socketId: socket.id
        };

        socket.data.user = user;
        this.connectedUsers.set(user.userId, user);
        
        // Store user session in Redis
        await redisUtils.setUserSession(user.userId, {
          socketId: socket.id,
          connectedAt: new Date().toISOString(),
          username: user.username,
          role: user.role
        });

        next();
      } catch (error) {
        console.error('Socket authentication error:', error);
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
    this.io.to('orders').emit('order:created', {
      type: 'order_created',
      data: orderData,
      timestamp: new Date().toISOString()
    });
  }

  public broadcastOrderMatched(matchData: any) {
    // Notify both buyer and seller
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

    // Broadcast to all users
    this.io.to('orders').emit('order:matched', {
      type: 'order_matched',
      data: matchData,
      timestamp: new Date().toISOString()
    });
  }

  public broadcastOrderCancelled(cancelData: any) {
    this.io.to('orders').emit('order:cancelled', {
      type: 'order_cancelled',
      data: cancelData,
      timestamp: new Date().toISOString()
    });
  }

  public broadcastTradeExecuted(tradeData: any) {
    // Notify both parties
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

    // Broadcast to all users
    this.io.to('trades').emit('trade:executed', {
      type: 'trade_executed',
      data: tradeData,
      timestamp: new Date().toISOString()
    });
  }

  public broadcastMarketUpdate(marketData: any) {
    this.io.to('orders').emit('market:update', {
      type: 'market_update',
      data: marketData,
      timestamp: new Date().toISOString()
    });
  }

  public broadcastOrderUpdated(orderData: any) {
    this.io.to('orders').emit('order:updated', {
      type: 'order_updated',
      data: orderData,
      timestamp: new Date().toISOString()
    });
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