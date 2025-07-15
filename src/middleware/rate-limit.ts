import { Request, Response, NextFunction } from 'express';
import { redisUtils } from '../config/redis';

interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
  message?: string;
}

interface RateLimitStore {
  [key: string]: {
    count: number;
    resetTime: number;
  };
}

const rateLimitStore: RateLimitStore = {};

export function createRateLimiter(config: RateLimitConfig) {
  return async (req: Request, res: Response, next: NextFunction) => {
    // Bypass rate limiting in development mode
    if (process.env.NODE_ENV === 'development' && process.env.BYPASS_RATE_LIMIT === 'true') {
      return next();
    }

    const key = `rate_limit:${req.ip}`;
    const now = Date.now();
    const windowStart = now - config.windowMs;

    try {
      // Try to get from Redis first
      let rateLimitData = await redisUtils.get(key);
      
      if (!rateLimitData || rateLimitData.resetTime < now) {
        // Reset or create new rate limit data
        rateLimitData = {
          count: 0,
          resetTime: now + config.windowMs
        };
      }

      // Increment count
      rateLimitData.count++;

      // Check if limit exceeded
      if (rateLimitData.count > config.maxRequests) {
        const retryAfter = Math.ceil((rateLimitData.resetTime - now) / 1000);
        
        res.setHeader('Retry-After', retryAfter.toString());
        res.setHeader('X-RateLimit-Limit', config.maxRequests.toString());
        res.setHeader('X-RateLimit-Remaining', '0');
        res.setHeader('X-RateLimit-Reset', new Date(rateLimitData.resetTime).toISOString());
        
        // More graceful error response
        return res.status(429).json({
          error: 'Rate Limit Exceeded',
          message: 'Please slow down your requests. Try again in a moment.',
          retryAfter,
          limit: config.maxRequests,
          windowMs: config.windowMs
        });
      }

      // Store updated data
      await redisUtils.set(key, rateLimitData, Math.ceil(config.windowMs / 1000));

      // Set headers
      res.setHeader('X-RateLimit-Limit', config.maxRequests.toString());
      res.setHeader('X-RateLimit-Remaining', (config.maxRequests - rateLimitData.count).toString());
      res.setHeader('X-RateLimit-Reset', new Date(rateLimitData.resetTime).toISOString());

      next();
    } catch (error) {
      console.error('Rate limiting error:', error);
      // Fallback: allow request if Redis fails (more lenient)
      console.log('Rate limiting disabled due to Redis error, allowing request');
      next();
    }
  };
}

// Predefined rate limiters
export const authRateLimit = createRateLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  maxRequests: 200, // Increased from 50
  message: 'Too many authentication attempts'
});

export const apiRateLimit = createRateLimiter({
  windowMs: 60 * 1000, // 1 minute
  maxRequests: 5000, // Increased from 1000
  message: 'Too many API requests'
});

export const orderRateLimit = createRateLimiter({
  windowMs: 60 * 1000, // 1 minute
  maxRequests: 500, // Increased from 100
  message: 'Too many order requests'
});

export const webhookRateLimit = createRateLimiter({
  windowMs: 60 * 1000, // 1 minute
  maxRequests: 1000, // Increased from 300
  message: 'Too many webhook requests'
});

// IP-based blocking for suspicious activity
export async function checkSuspiciousActivity(req: Request, res: Response, next: NextFunction) {
  const key = `suspicious:${req.ip}`;
  
  try {
    const suspiciousCount = await redisUtils.get(key) || 0;
    
    if (suspiciousCount > 10) {
      return res.status(403).json({
        error: 'Access Denied',
        message: 'Suspicious activity detected'
      });
    }
    
    next();
  } catch (error) {
    next();
  }
}

// Track failed authentication attempts
export async function trackFailedAuth(req: Request, res: Response, next: NextFunction) {
  const originalSend = res.send;
  
  res.send = function(data) {
    if (res.statusCode === 401 || res.statusCode === 403) {
      const key = `failed_auth:${req.ip}`;
      redisUtils.get(key).then((count = 0) => {
        redisUtils.set(key, count + 1, 3600); // 1 hour
      });
    }
    return originalSend.call(this, data);
  };
  
  next();
} 