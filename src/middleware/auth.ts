import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { SECRET_KEY } from '../config';

export interface AuthenticatedRequest extends Request {
  user?: {
    userId: string;
    username: string;
    role: string;
  };
}

export const authMiddleware = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
      return res.status(401).json({ error: 'Access token required' });
    }

    const decoded = jwt.verify(token, SECRET_KEY) as any;
    req.user = {
      userId: decoded.userId,
      username: decoded.username,
      role: decoded.role
    };

    next();
  } catch (error) {
    console.error('Auth middleware error:', error);
    res.status(403).json({ error: 'Invalid token' });
  }
};

// Legacy export for backward compatibility
export const authenticateToken = authMiddleware;

/**
 * Middleware to require admin role
 */
export const requireAdmin = (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  if (!req.user) {
    return res.status(401).json({ detail: 'Authentication required' });
  }

  if (req.user.role !== 'admin') {
    return res.status(403).json({ detail: 'Admin access required' });
  }

  next();
};

/**
 * Create access token (legacy function for compatibility)
 */
export const createAccessToken = (username: string): string => {
  // This is a legacy function - in the new system, tokens are created by AuthService
  // For now, we'll create a temporary token for backward compatibility
  const payload = {
    userId: 'temp',
    username: username,
    role: 'trader'
  };
  
  // Note: This should be replaced with proper AuthService usage
  return require('jsonwebtoken').sign(payload, process.env['SECRET_KEY'] || 'temp-secret', { expiresIn: '24h' });
}; 