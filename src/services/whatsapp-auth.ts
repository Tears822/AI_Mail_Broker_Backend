import { prisma } from '../database/prisma-client';
import { redisUtils } from '../config/redis';
import { normalizePhoneNumber } from '../utils';
import bcrypt from 'bcryptjs';

export interface WhatsAppUser {
  id: string;
  username: string;
  phone: string;
  email?: string;
  role: string;
  isRegistered: boolean;
  isActive: boolean;
  lastLoginAt?: Date;
}

export interface WhatsAppSession {
  userId: string;
  phone: string;
  username: string;
  role: string;
  isRegistered: boolean;
  createdAt: string;
  expiresAt: string;
}

/**
 * WhatsApp Authentication Service
 * Handles phone-based authentication without requiring JWT tokens
 */
export class WhatsAppAuthService {
  private activeSessions: Map<string, WhatsAppSession> = new Map();
  
  /**
   * Find or create a WhatsApp user by phone number
   * Integrates with web platform users using phone as unique identifier
   */
  async findOrCreateUser(phoneNumber: string): Promise<WhatsAppUser> {
    try {
      // Always normalize the phone number first
      const normalizedPhone = normalizePhoneNumber(phoneNumber);
      console.log('[WhatsApp Auth] Looking up user by phone:', normalizedPhone);
      
      // Always try to find existing user by normalized phone number first
      let user = await prisma.user.findFirst({
        where: { phone: normalizedPhone }
      });

      if (user) {
        console.log('[WhatsApp Auth] Found existing user:', user.username);
        
        // Determine if this is a registered user or WhatsApp-created guest
        const isRegistered = !user.username.startsWith('WhatsApp_') && 
                           !user.email.includes('@whatsapp.temp');
        
        return {
          id: user.id,
          username: user.username,
          phone: user.phone,
          email: user.email,
          role: user.role,
          isRegistered,
          isActive: user.isActive,
          lastLoginAt: user.lastLoginAt || undefined
        };
      }

      // Create new WhatsApp guest user if not found
      console.log('[WhatsApp Auth] Creating WhatsApp guest user for phone:', normalizedPhone);
      
      // Generate unique username from phone number
      const phoneDigits = normalizedPhone.replace(/\D/g, '').slice(-4);
      const randomSuffix = Math.floor(Math.random() * 9000) + 1000;
      const username = `WhatsApp_${phoneDigits}_${randomSuffix}`;
      
      // Check if username already exists and make it unique
      let finalUsername = username;
      let counter = 1;
      while (await prisma.user.findUnique({ where: { username: finalUsername } })) {
        finalUsername = `${username}_${counter}`;
        counter++;
      }

      const newUser = await prisma.user.create({
        data: {
          username: finalUsername,
          email: `${finalUsername}@whatsapp.temp`,
          passwordHash: await bcrypt.hash('whatsapp_temp_' + Date.now(), 10),
          phone: normalizedPhone,
          role: 'TRADER',
          isActive: true
        }
      });

      console.log('[WhatsApp Auth] Created WhatsApp guest user:', finalUsername);
      
      return {
        id: newUser.id,
        username: newUser.username,
        phone: newUser.phone,
        email: newUser.email,
        role: newUser.role,
        isRegistered: false,
        isActive: newUser.isActive,
        lastLoginAt: newUser.lastLoginAt || undefined
      };

    } catch (error) {
      console.error('[WhatsApp Auth] Error finding/creating user:', error);
      throw error;
    }
  }

  /**
   * Create session for WhatsApp user
   */
  async createSession(user: WhatsAppUser): Promise<WhatsAppSession> {
    try {
      const normalizedPhone = normalizePhoneNumber(user.phone);
      const sessionKey = `whatsapp_session:${normalizedPhone}`;
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
      
      const session: WhatsAppSession = {
        userId: user.id,
        phone: normalizedPhone,
        username: user.username,
        role: user.role,
        isRegistered: user.isRegistered,
        createdAt: new Date().toISOString(),
        expiresAt: expiresAt.toISOString()
      };

      // Store session in Redis with 24 hour expiration
      await redisUtils.set(sessionKey, JSON.stringify(session), 24 * 60 * 60);
      
      console.log('[WhatsApp Auth] Created session for user:', user.username);
      return session;

    } catch (error) {
      console.error('[WhatsApp Auth] Error creating session:', error);
      throw new Error('Failed to create WhatsApp session');
    }
  }

  /**
   * Get existing session for phone number
   */
  async getSession(phoneNumber: string): Promise<WhatsAppSession | null> {
    try {
      const normalizedPhone = normalizePhoneNumber(phoneNumber);
      const sessionKey = `whatsapp_session:${normalizedPhone}`;
      
      const sessionData = await redisUtils.get(sessionKey);
      if (!sessionData) {
        return null;
      }

      const session: WhatsAppSession = JSON.parse(sessionData);
      
      // Check if session is expired
      if (new Date(session.expiresAt) < new Date()) {
        await redisUtils.del(sessionKey);
        return null;
      }

      return session;

    } catch (error) {
      console.error('[WhatsApp Auth] Error getting session:', error);
      return null;
    }
  }

  /**
   * Authenticate WhatsApp user by phone number
   * Creates guest account if needed
   */
  async authenticateUser(phoneNumber: string): Promise<WhatsAppSession> {
    try {
      const normalizedPhone = normalizePhoneNumber(phoneNumber);
      console.log('[WhatsApp Auth] Authenticating user:', normalizedPhone);
      
      // Check if we have a cached session
      const existingSession = this.activeSessions.get(normalizedPhone);
      if (existingSession && new Date(existingSession.expiresAt) > new Date()) {
        console.log('[WhatsApp Auth] Using cached session for:', existingSession.username);
        
        // VERIFY the user still exists in database
        const userExists = await prisma.user.findUnique({
          where: { id: existingSession.userId }
        });
        
        if (userExists) {
          console.log('[WhatsApp Auth] User verified in database:', userExists.username);
          return existingSession;
        } else {
          console.log('[WhatsApp Auth] User not found in database, removing cached session and recreating');
          this.activeSessions.delete(normalizedPhone);
        }
      }

      // Find or create user
      const whatsappUser = await this.findOrCreateUser(normalizedPhone);
      
      // DOUBLE-CHECK user exists in database
      const dbUser = await prisma.user.findUnique({
        where: { id: whatsappUser.id }
      });
      
      if (!dbUser) {
        console.error('[WhatsApp Auth] Critical error: User creation failed or user missing from database');
        throw new Error('User authentication failed - database inconsistency');
      }

      // Create new session
      const session: WhatsAppSession = {
        userId: whatsappUser.id,
        phone: whatsappUser.phone,
        username: whatsappUser.username,
        role: whatsappUser.role,
        isRegistered: whatsappUser.isRegistered,
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() // 24 hours
      };

      // Cache the session
      this.activeSessions.set(normalizedPhone, session);
      console.log('[WhatsApp Auth] New session created for:', whatsappUser.username);

      // Store in Redis for persistence
      await redisUtils.setUserSession(`whatsapp:${normalizedPhone}`, session);

      return session;
    } catch (error) {
      console.error('[WhatsApp Auth] Authentication error:', error);
      throw new Error('WhatsApp authentication failed');
    }
  }

  /**
   * Check if user can perform trading operations
   */
  canTrade(session: WhatsAppSession): boolean {
    return session.role === 'TRADER' || session.role === 'ADMIN';
  }

  /**
   * Get user by session
   */
  async getUserFromSession(phoneNumber: string): Promise<WhatsAppUser | null> {
    try {
      const session = await this.getSession(phoneNumber);
      if (!session) {
        return null;
      }

      const user = await prisma.user.findUnique({
        where: { id: session.userId }
      });

      if (!user) {
        return null;
      }

      return {
        id: user.id,
        username: user.username,
        phone: user.phone || phoneNumber,
        email: user.email || undefined,
        role: user.role,
        isRegistered: !user.username.startsWith('WhatsApp_'),
        isActive: user.isActive,
        lastLoginAt: user.lastLoginAt || undefined
      };

    } catch (error) {
      console.error('[WhatsApp Auth] Error getting user from session:', error);
      return null;
    }
  }

  /**
   * Promote guest user to full user (when they register via web)
   * @deprecated Use linkWebRegistration instead for better integration
   */
  async promoteGuestUser(phoneNumber: string, username: string, email: string, password: string): Promise<boolean> {
    console.log('[WhatsApp Auth] promoteGuestUser is deprecated, use linkWebRegistration instead');
    const result = await this.linkWebRegistration(phoneNumber, username, email, password);
    return result.success;
  }

  /**
   * Link WhatsApp guest user to web registration
   * Called when a user registers on web platform with a phone number that has WhatsApp activity
   */
  async linkWebRegistration(phoneNumber: string, username: string, email: string, password: string): Promise<{ success: boolean; message: string; userId?: string }> {
    try {
      console.log('[WhatsApp Auth] Attempting to link web registration for phone:', phoneNumber);
      
      // Check if phone already has a user (could be WhatsApp guest or existing registered user)
      const existingUser = await prisma.user.findFirst({
        where: { phone: phoneNumber }
      });

      if (existingUser) {
        // Check if it's a WhatsApp guest user
        const isWhatsAppGuest = existingUser.username.startsWith('WhatsApp_') && 
                              existingUser.email.includes('@whatsapp.temp');
        
        if (isWhatsAppGuest) {
          console.log('[WhatsApp Auth] Upgrading WhatsApp guest user to registered user');
          
          // Upgrade the guest user to a full registered user
          const updatedUser = await prisma.user.update({
            where: { id: existingUser.id },
            data: {
              username,
              email,
              passwordHash: await bcrypt.hash(password, 10)
              // Keep all existing data: phone, role, orders, trades, etc.
            }
          });

          // Update any active WhatsApp session
          const session = await this.getSession(phoneNumber);
          if (session) {
            session.username = username;
            session.isRegistered = true;
            const sessionKey = `whatsapp_session:${phoneNumber}`;
            await redisUtils.set(sessionKey, JSON.stringify(session), 24 * 60 * 60);
            console.log('[WhatsApp Auth] Updated WhatsApp session for registered user');
          }

          console.log('[WhatsApp Auth] Successfully upgraded WhatsApp guest to registered user:', username);
          return {
            success: true,
            message: 'Account upgraded successfully! Your WhatsApp trading history has been preserved.',
            userId: updatedUser.id
          };
        } else {
          // Phone belongs to an already registered user
          console.log('[WhatsApp Auth] Phone already belongs to registered user:', existingUser.username);
          return {
            success: false,
            message: 'This phone number is already registered. Please use a different phone number or login with existing credentials.'
          };
        }
      } else {
        // No existing user - create new registered user
        console.log('[WhatsApp Auth] Creating new registered user with phone:', phoneNumber);
        
        const newUser = await prisma.user.create({
          data: {
            username,
            email,
            phone: phoneNumber,
            passwordHash: await bcrypt.hash(password, 10),
            role: 'TRADER',
            isActive: true,
            lastLoginAt: new Date()
          }
        });

        console.log('[WhatsApp Auth] Created new registered user:', username);
        return {
          success: true,
          message: 'Account created successfully! You can now use both web and WhatsApp platforms.',
          userId: newUser.id
        };
      }

    } catch (error) {
      console.error('[WhatsApp Auth] Error linking web registration:', error);
      return {
        success: false,
        message: 'Registration failed. Please try again.'
      };
    }
  }

  /**
   * Check if phone number has existing WhatsApp activity
   * Useful for web registration to inform users about existing activity
   */
  async hasWhatsAppActivity(phoneNumber: string): Promise<{ hasActivity: boolean; isGuest: boolean; orderCount: number; tradeCount: number }> {
    try {
      const user = await prisma.user.findFirst({
        where: { phone: phoneNumber }
      });

      if (!user) {
        return { hasActivity: false, isGuest: false, orderCount: 0, tradeCount: 0 };
      }

      const isGuest = user.username.startsWith('WhatsApp_') && user.email.includes('@whatsapp.temp');
      
      // Get counts separately to avoid Prisma include issues
      const orderCount = await prisma.order.count({
        where: { userId: user.id }
      });
      
      const tradeCount = await prisma.trade.count({
        where: {
          OR: [
            { buyerId: user.id },
            { sellerId: user.id }
          ]
        }
      });

      return {
        hasActivity: orderCount > 0 || tradeCount > 0,
        isGuest,
        orderCount,
        tradeCount
      };

    } catch (error) {
      console.error('[WhatsApp Auth] Error checking WhatsApp activity:', error);
      return { hasActivity: false, isGuest: false, orderCount: 0, tradeCount: 0 };
    }
  }

  /**
   * Cleanup expired sessions
   */
  async cleanupExpiredSessions(): Promise<void> {
    try {
      // This would be called periodically to clean up expired sessions
      // Redis TTL handles most of this automatically
      console.log('[WhatsApp Auth] Session cleanup completed');
    } catch (error) {
      console.error('[WhatsApp Auth] Error during session cleanup:', error);
    }
  }
}

export const whatsappAuthService = new WhatsAppAuthService(); 