import bcrypt from 'bcryptjs';
import jwt, { SignOptions } from 'jsonwebtoken';
import { prisma } from '../database/prisma-client';
import { SECRET_KEY } from '../config';

export interface LoginCredentials {
  username: string;
  password: string;
}

export interface RegisterData {
  username: string;
  email: string;
  password: string;
  phone: string;
  role?: 'TRADER' | 'ADMIN';
}

export interface AuthResult {
  success: boolean;
  user?: any;
  token?: string;
  error?: string;
}

export class AuthService {
  /**
   * Register a new user
   */
  async register(data: RegisterData): Promise<AuthResult> {
    try {
      // Check if user already exists
      const existingUser = await prisma.user.findFirst({
        where: {
          OR: [
            { username: data.username },
            { email: data.email }
          ]
        }
      });

      if (existingUser) {
        return {
          success: false,
          error: 'Username or email already exists'
        };
      }

      // Hash password
      const saltRounds = 12;
      const passwordHash = await bcrypt.hash(data.password, saltRounds);

      // Create user
      const user = await prisma.user.create({
        data: {
          username: data.username,
          email: data.email,
          passwordHash,
          phone: data.phone,
          role: data.role || 'TRADER',
          isActive: true
        }
      });

      // Tracking log for registration
      console.log(`[TRACK] User registered: username=${user.username}, email=${user.email}, userId=${user.id}`);

      // Generate token
      const token = this.generateToken(user);

      return {
        success: true,
        user,
        token
      };
    } catch (error) {
      console.error('Registration error:', error);
      return {
        success: false,
        error: 'Registration failed'
      };
    }
  }

  /**
   * Authenticate user login
   */
  async login(credentials: LoginCredentials): Promise<AuthResult> {
    try {
      // Find user
      const user = await prisma.user.findUnique({
        where: { username: credentials.username }
      });

      if (!user || !user.isActive) {
        return {
          success: false,
          error: 'Invalid credentials'
        };
      }

      // Verify password
      const isValidPassword = await bcrypt.compare(credentials.password, user.passwordHash);
      if (!isValidPassword) {
        return {
          success: false,
          error: 'Invalid credentials'
        };
      }

      // Update last login
      await prisma.user.update({
        where: { id: user.id },
        data: { lastLoginAt: new Date() }
      });

      // Tracking log for login
      console.log(`[TRACK] User login: username=${user.username}, email=${user.email}, userId=${user.id}`);

      // Generate token
      const token = this.generateToken(user);

      return {
        success: true,
        user,
        token
      };
    } catch (error) {
      console.error('Login error:', error);
      return {
        success: false,
        error: 'Login failed'
      };
    }
  }

  /**
   * Verify JWT token
   */
  async verifyToken(token: string): Promise<AuthResult> {
    try {
      const decoded = jwt.verify(token, SECRET_KEY) as any;
      const user = await prisma.user.findUnique({
        where: { id: decoded.userId }
      });

      if (!user || !user.isActive) {
        return {
          success: false,
          error: 'Invalid token'
        };
      }

      return {
        success: true,
        user
      };
    } catch (error) {
      return {
        success: false,
        error: 'Invalid token'
      };
    }
  }

  /**
   * Generate JWT token
   */
  private generateToken(user: any): string {
    const payload = {
      userId: user.id,
      username: user.username,
      role: user.role
    };

    const options: SignOptions = {
      expiresIn: '24h'
    };

    return jwt.sign(payload, SECRET_KEY, options);
  }

  /**
   * Get user by ID
   */
  async getUserById(id: string): Promise<any | null> {
    try {
      return await prisma.user.findUnique({
        where: { id }
      });
    } catch (error) {
      console.error('Error getting user by ID:', error);
      return null;
    }
  }

  /**
   * Get user by username
   */
  async getUserByUsername(username: string): Promise<any | null> {
    try {
      return await prisma.user.findUnique({
        where: { username }
      });
    } catch (error) {
      console.error('Error getting user by username:', error);
      return null;
    }
  }

  /**
   * Get user by phone
   */
  async getUserByPhone(phone: string): Promise<any | null> {
    try {
      return await prisma.user.findFirst({
        where: { phone }
      });
    } catch (error) {
      console.error('Error getting user by phone:', error);
      return null;
    }
  }

  /**
   * Update user profile
   */
  async updateProfile(userId: string, updates: Partial<any>): Promise<AuthResult> {
    try {
      // Remove sensitive fields that shouldn't be updated
      const { passwordHash, id, ...safeUpdates } = updates;

      const user = await prisma.user.update({
        where: { id: userId },
        data: safeUpdates
      });

      return {
        success: true,
        user
      };
    } catch (error) {
      console.error('Error updating profile:', error);
      return {
        success: false,
        error: 'Failed to update profile'
      };
    }
  }

  /**
   * Change user password
   */
  async changePassword(userId: string, currentPassword: string, newPassword: string): Promise<AuthResult> {
    try {
      const user = await prisma.user.findUnique({
        where: { id: userId }
      });

      if (!user) {
        return {
          success: false,
          error: 'User not found'
        };
      }

      // Verify current password
      const isValidPassword = await bcrypt.compare(currentPassword, user.passwordHash);
      if (!isValidPassword) {
        return {
          success: false,
          error: 'Current password is incorrect'
        };
      }

      // Hash new password
      const saltRounds = 12;
      const newPasswordHash = await bcrypt.hash(newPassword, saltRounds);

      // Update password
      await prisma.user.update({
        where: { id: userId },
        data: { passwordHash: newPasswordHash }
      });

      return {
        success: true
      };
    } catch (error) {
      console.error('Error changing password:', error);
      return {
        success: false,
        error: 'Failed to change password'
      };
    }
  }

  /**
   * Deactivate user account
   */
  async deactivateAccount(userId: string): Promise<AuthResult> {
    try {
      await prisma.user.update({
        where: { id: userId },
        data: { isActive: false }
      });

      return {
        success: true
      };
    } catch (error) {
      console.error('Error deactivating account:', error);
      return {
        success: false,
        error: 'Failed to deactivate account'
      };
    }
  }

  /**
   * Get all users (admin only)
   */
  async getAllUsers(): Promise<any[]> {
    try {
      return await prisma.user.findMany({
        select: {
          id: true,
          username: true,
          email: true,
          phone: true,
          role: true,
          isActive: true,
          lastLoginAt: true,
          createdAt: true,
          updatedAt: true
        }
      });
    } catch (error) {
      console.error('Error getting all users:', error);
      return [];
    }
  }
} 