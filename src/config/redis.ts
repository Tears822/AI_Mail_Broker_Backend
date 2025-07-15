import { createClient } from 'redis';
import dotenv from 'dotenv';

dotenv.config();

// Parse Redis URL or use explicit parameters
function getRedisConfig() {
  const REDIS_URL = process.env.REDIS_URL;
  const REDIS_TLS_ENABLED = process.env.REDIS_TLS_ENABLED === 'true';
  
  // If REDIS_URL is provided, parse it
  if (REDIS_URL) {
    if (REDIS_URL.startsWith('rediss://') || REDIS_URL.startsWith('redis://')) {
      const url = new URL(REDIS_URL);
      const config: any = {
        username: url.username || 'default',
        password: url.password || undefined,
        socket: {
          host: url.hostname,
          port: parseInt(url.port) || 6379
        }
      };
      
      // Add TLS configuration for SSL connections
      if (REDIS_URL.startsWith('rediss://') || REDIS_TLS_ENABLED) {
        config.socket.tls = true;
      }
      
      return config;
    }
  }
  
  // Fallback to explicit Redis Cloud credentials from environment
  const REDIS_HOST = process.env.REDIS_HOST || 'redis-10019.c98.us-east-1-4.ec2.redns.redis-cloud.com';
  const REDIS_PORT = parseInt(process.env.REDIS_PORT || '10019');
  const REDIS_USERNAME = process.env.REDIS_USERNAME || 'default';
  const REDIS_PASSWORD = process.env.REDIS_PASSWORD || 'jutMpCK77YSW1mCRFMKDTisxgEjtRUq7';
  
  return {
    username: REDIS_USERNAME,
    password: REDIS_PASSWORD,
    socket: {
      host: REDIS_HOST,
      port: REDIS_PORT,
      tls: REDIS_TLS_ENABLED
    }
  };
}

const redisConfig = getRedisConfig();

// Create Redis client with enhanced error handling
export const redisClient = createClient({
  ...redisConfig,
  socket: {
    ...redisConfig.socket,
    reconnectStrategy: (retries) => {
      if (retries > 10) {
        console.error('Redis connection failed after 10 retries');
        return new Error('Redis connection failed');
      }
      return Math.min(retries * 100, 3000);
    },
    connectTimeout: 10000
  }
});

// Create Redis subscriber for pub/sub
export const redisSubscriber = redisClient.duplicate();

// Redis event handlers
redisClient.on('error', (err) => {
  console.error('Redis Client Error:', err);
});

redisClient.on('connect', () => {
  console.log('✅ Redis client connected');
});

redisClient.on('ready', () => {
  console.log('✅ Redis client ready');
});

redisSubscriber.on('error', (err) => {
  console.error('Redis Subscriber Error:', err);
});

redisSubscriber.on('connect', () => {
  console.log('✅ Redis subscriber connected');
});

// Initialize Redis connection
export async function initRedis() {
  try {
    console.log(`🔗 Connecting to Redis: ${redisConfig.socket.host}:${redisConfig.socket.port}`);
    await redisClient.connect();
    await redisSubscriber.connect();
    console.log('🚀 Redis initialized successfully');
  } catch (error) {
    console.error('❌ Redis initialization failed:', error);
    console.log('💡 Make sure Redis is running or check your REDIS_URL in .env');
    console.log('💡 For local development: redis://localhost:6379');
    console.log('💡 For Redis Cloud: rediss://username:password@host:port');
    throw error;
  }
}

// Graceful shutdown
export async function closeRedis() {
  try {
    await redisClient.quit();
    await redisSubscriber.quit();
    console.log('🔌 Redis connections closed');
  } catch (error) {
    console.error('Error closing Redis connections:', error);
  }
}

// Helper to ensure Redis client is open, and reconnect if not
async function ensureRedisConnected() {
  if (!redisClient.isOpen) {
    console.error('[Redis] Client is not open. Attempting to reconnect...');
    try {
      await redisClient.connect();
      console.log('[Redis] Reconnected successfully.');
    } catch (err) {
      console.error('[Redis] Reconnection failed:', err);
      throw new Error('Redis client is not open and reconnection failed');
    }
  }
}

// Redis utility functions
export const redisUtils = {
  // Cache functions
  async set(key: string, value: any, ttl?: number): Promise<void> {
    await ensureRedisConnected();
    const serialized = JSON.stringify(value);
    if (ttl) {
      await redisClient.setEx(key, ttl, serialized);
    } else {
      await redisClient.set(key, serialized);
    }
  },

  async get(key: string): Promise<any> {
    await ensureRedisConnected();
    const value = await redisClient.get(key);
    return value ? JSON.parse(value) : null;
  },

  async del(key: string): Promise<void> {
    await ensureRedisConnected();
    await redisClient.del(key);
  },

  // Pub/Sub functions
  async publish(channel: string, message: any): Promise<void> {
    await ensureRedisConnected();
    await redisClient.publish(channel, JSON.stringify(message));
  },

  async subscribe(channel: string, callback: (message: any) => void): Promise<void> {
    await ensureRedisConnected();
    await redisSubscriber.subscribe(channel, (message) => {
      try {
        const parsed = JSON.parse(message);
        callback(parsed);
      } catch (error) {
        console.error('Error parsing Redis message:', error);
      }
    });
  },

  async unsubscribe(channel: string): Promise<void> {
    await ensureRedisConnected();
    await redisSubscriber.unsubscribe(channel);
  },

  // Order book functions
  async addToOrderBook(asset: string, order: any): Promise<void> {
    await ensureRedisConnected();
    const key = `orderbook:${asset}`;
    const orders = await this.get(key) || [];
    orders.push(order);
    await this.set(key, orders, 3600); // Cache for 1 hour
  },

  async getOrderBook(asset: string): Promise<any[]> {
    await ensureRedisConnected();
    const key = `orderbook:${asset}`;
    return await this.get(key) || [];
  },

  async updateOrderBook(asset: string, orders: any[]): Promise<void> {
    await ensureRedisConnected();
    const key = `orderbook:${asset}`;
    await this.set(key, orders, 3600);
  },

  // User session functions
  async setUserSession(userId: string, sessionData: any): Promise<void> {
    await ensureRedisConnected();
    const key = `session:${userId}`;
    await this.set(key, sessionData, 86400); // 24 hours
  },

  async getUserSession(userId: string): Promise<any> {
    await ensureRedisConnected();
    const key = `session:${userId}`;
    return await this.get(key);
  },

  async removeUserSession(userId: string): Promise<void> {
    await ensureRedisConnected();
    const key = `session:${userId}`;
    await this.del(key);
  }
}; 