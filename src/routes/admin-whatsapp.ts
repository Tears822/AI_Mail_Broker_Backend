import express from 'express';
import { prisma } from '../database/prisma-client';
import { sendWhatsAppMessage } from '../services/whatsapp';
import WhatsAppTemplateService from '../services/whatsapp-templates';
import { authenticateToken } from '../middleware/auth';

const router = express.Router();

/**
 * Admin route to send WhatsApp messages to users
 * Only works for users who have previously messaged the system
 */

// Send message to specific user
router.post('/send-message', authenticateToken, async (req, res) => {
  try {
    const { userId, message } = req.body;
    
    if (!userId || !message) {
      return res.status(400).json({ error: 'userId and message are required' });
    }

    // Get user phone number
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { phone: true, username: true }
    });

    if (!user?.phone) {
      return res.status(404).json({ error: 'User not found or no phone number' });
    }

    const success = await sendWhatsAppMessage(user.phone, message);
    
    if (success) {
      res.json({ 
        success: true, 
        message: `Message sent to ${user.username} (${user.phone})` 
      });
    } else {
      res.status(500).json({ error: 'Failed to send message' });
    }
  } catch (error) {
    console.error('Admin WhatsApp send error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Send welcome template to specific user
router.post('/send-welcome', authenticateToken, async (req, res) => {
  try {
    const { userId } = req.body;
    
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { phone: true, username: true }
    });

    if (!user?.phone) {
      return res.status(404).json({ error: 'User not found or no phone number' });
    }

    const success = await WhatsAppTemplateService.sendWelcomeTemplate(user.phone, user.username);
    
    if (success) {
      res.json({ 
        success: true, 
        message: `Welcome message sent to ${user.username}` 
      });
    } else {
      res.status(500).json({ error: 'Failed to send welcome message' });
    }
  } catch (error) {
    console.error('Admin WhatsApp welcome error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Send market alert to users with active orders in specific asset
router.post('/send-market-alert', authenticateToken, async (req, res) => {
  try {
    const { asset, price, alertType } = req.body;
    
    if (!asset || !price || !alertType) {
      return res.status(400).json({ error: 'asset, price, and alertType are required' });
    }

    // Get users with active orders for this asset
    const activeOrders = await prisma.order.findMany({
      where: {
        asset,
        status: 'ACTIVE',
        remaining: { gt: 0 }
      },
      include: {
        user: {
          select: { id: true, phone: true, username: true }
        }
      }
    });

    // Get unique users
    const uniqueUsers = new Map();
    activeOrders.forEach(order => {
      if (order.user?.phone && !uniqueUsers.has(order.user.id)) {
        uniqueUsers.set(order.user.id, {
          phone: order.user.phone,
          username: order.user.username
        });
      }
    });

    const results = [];
    for (const [userId, userData] of uniqueUsers) {
      const success = await WhatsAppTemplateService.sendMarketAlertTemplate(
        userData.phone, 
        asset, 
        price, 
        alertType
      );
      
      results.push({
        userId,
        username: userData.username,
        phone: userData.phone,
        success
      });
    }

    res.json({
      success: true,
      message: `Market alert sent to ${uniqueUsers.size} users`,
      results
    });
  } catch (error) {
    console.error('Admin market alert error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Send promotional message to all users with phone numbers
router.post('/send-promotional', authenticateToken, async (req, res) => {
  try {
    const { promoType, targetRole } = req.body;
    
    if (!promoType) {
      return res.status(400).json({ error: 'promoType is required' });
    }

    // Get users with phone numbers
    const whereClause: any = {
      phone: { not: null }
    };
    
    if (targetRole) {
      whereClause.role = targetRole;
    }

    const users = await prisma.user.findMany({
      where: whereClause,
      select: { id: true, phone: true, username: true, role: true }
    });

    const results = [];
    for (const user of users) {
      if (user.phone) {
        const success = await WhatsAppTemplateService.sendPromotionalTemplate(
          user.phone, 
          promoType
        );
        
        results.push({
          userId: user.id,
          username: user.username,
          phone: user.phone,
          role: user.role,
          success
        });
      }
    }

    res.json({
      success: true,
      message: `Promotional message sent to ${results.length} users`,
      results
    });
  } catch (error) {
    console.error('Admin promotional message error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get users with WhatsApp capabilities
router.get('/whatsapp-users', authenticateToken, async (req, res) => {
  try {
    const users = await prisma.user.findMany({
      where: {
        phone: { not: null as any }
      },
      select: {
        id: true,
        username: true,
        phone: true,
        role: true,
        createdAt: true,
        _count: {
          select: {
            orders: true
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    // Get trade counts separately
    const usersWithTradeCounts = await Promise.all(
      users.map(async (user) => {
        const [buyTrades, sellTrades] = await Promise.all([
          prisma.trade.count({ where: { buyerId: user.id } }),
          prisma.trade.count({ where: { sellerId: user.id } })
        ]);
        
        return {
          ...user,
          totalTrades: buyTrades + sellTrades,
          buyTrades,
          sellTrades
        };
      })
    );

    res.json({
      success: true,
      users: usersWithTradeCounts
    });
  } catch (error) {
    console.error('Get WhatsApp users error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router; 