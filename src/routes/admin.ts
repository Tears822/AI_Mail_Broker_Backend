import express from 'express';
import { prisma } from '../database/prisma-client';
import { authenticateToken, requireAdmin, AuthenticatedRequest } from '../middleware/auth';
import { redisUtils } from '../config/redis';
import { sendWhatsAppMessage } from '../services/whatsapp';

const router = express.Router();

// Apply authentication and admin-only middleware to all routes
router.use(authenticateToken);
router.use(requireAdmin);

// ===== DASHBOARD OVERVIEW =====
router.get('/dashboard', async (req, res) => {
  try {
    const [
      totalUsers,
      activeUsers,
      totalOrders,
      activeOrders,
      totalTrades,
      todayTrades,
      systemHealth,
      whatsappMessages
    ] = await Promise.all([
      prisma.user.count(),
      prisma.user.count({
        where: {
          lastLoginAt: {
            gte: new Date(Date.now() - 24 * 60 * 60 * 1000) // Last 24 hours
          }
        }
      }),
      prisma.order.count(),
      prisma.order.count({ where: { status: 'ACTIVE' } }),
      prisma.trade.count(),
      prisma.trade.count({
        where: {
          createdAt: {
            gte: new Date(Date.now() - 24 * 60 * 60 * 1000)
          }
        }
      }),
      getSystemHealth(),
      getWhatsAppStats()
    ]);

    const topAssets = await prisma.trade.groupBy({
      by: ['asset'],
      _count: { asset: true },
      _sum: { amount: true },
      orderBy: { _count: { asset: 'desc' } },
      take: 5
    });

    res.json({
      overview: {
        totalUsers,
        activeUsers,
        totalOrders,
        activeOrders,
        totalTrades,
        todayTrades
      },
      systemHealth,
      whatsappMessages,
      topAssets,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Admin dashboard error:', error);
    res.status(500).json({ error: 'Failed to load dashboard data' });
  }
});

// ===== USER MANAGEMENT =====
router.get('/users', async (req, res) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const search = req.query.search as string;
    const role = req.query.role as string;
    const status = req.query.status as string;

    const where: any = {};
    if (search) {
      where.OR = [
        { username: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search, mode: 'insensitive' } }
      ];
    }
    if (role) where.role = role;
    if (status === 'active') where.lastLoginAt = { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) };

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        select: {
          id: true,
          username: true,
          email: true,
          phone: true,
          role: true,
          createdAt: true,
          lastLoginAt: true,
          _count: {
            select: {
              orders: true
            }
          }
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit
      }),
      prisma.user.count({ where })
    ]);

    res.json({
      users: users.map(user => ({
        ...user,
        totalTrades: 0, // Will be calculated separately if needed
        isActive: user.lastLoginAt && user.lastLoginAt > new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
      })),
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

router.get('/users/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const [user, orders, trades, summary] = await Promise.all([
      prisma.user.findUnique({
        where: { id },
        select: {
          id: true,
          username: true,
          email: true,
          phone: true,
          role: true,
          createdAt: true,
          lastLoginAt: true
        }
      }),
      prisma.order.findMany({
        where: { userId: id },
        orderBy: { createdAt: 'desc' },
        take: 10
      }),
      prisma.trade.findMany({
        where: {
          OR: [
            { buyerId: id },
            { sellerId: id }
          ]
        },
        orderBy: { createdAt: 'desc' },
        take: 10,
        include: {
          buyer: { select: { username: true } },
          seller: { select: { username: true } }
        }
      }),
      getUserSummary(id)
    ]);

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ user, orders, trades, summary });
  } catch (error) {
    console.error('Get user details error:', error);
    res.status(500).json({ error: 'Failed to fetch user details' });
  }
});

router.patch('/users/:id/role', async (req, res) => {
  try {
    const { id } = req.params;
    const { role } = req.body;

    if (!['USER', 'TRADER', 'ADMIN'].includes(role)) {
      return res.status(400).json({ error: 'Invalid role' });
    }

    const updatedUser = await prisma.user.update({
      where: { id },
      data: { role },
      select: { id: true, username: true, role: true }
    });

    res.json({ user: updatedUser, message: 'User role updated successfully' });
  } catch (error) {
    console.error('Update user role error:', error);
    res.status(500).json({ error: 'Failed to update user role' });
  }
});

// ===== ORDER MANAGEMENT =====
router.get('/orders', async (req, res) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 50;
    const status = req.query.status as string;
    const asset = req.query.asset as string;
    const userId = req.query.userId as string;

    const where: any = {};
    if (status) where.status = status;
    if (asset) where.asset = { contains: asset, mode: 'insensitive' };
    if (userId) where.userId = userId;

    const [orders, total] = await Promise.all([
      prisma.order.findMany({
        where,
        include: {
          user: { select: { username: true, phone: true } }
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit
      }),
      prisma.order.count({ where })
    ]);

    res.json({
      orders,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Get orders error:', error);
    res.status(500).json({ error: 'Failed to fetch orders' });
  }
});

router.patch('/orders/:id/cancel', async (req: AuthenticatedRequest, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;

    const order = await prisma.order.findUnique({
      where: { id },
      include: { user: true }
    });

    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    if (order.status !== 'ACTIVE') {
      return res.status(400).json({ error: 'Order cannot be cancelled' });
    }

    await prisma.order.update({
      where: { id },
      data: { 
        status: 'CANCELLED',
        metadata: {
          ...order.metadata as any,
          adminCancellation: {
            reason,
            cancelledBy: req.user?.userId,
            cancelledAt: new Date().toISOString()
          }
        }
      }
    });

    // Notify user via WhatsApp
    if (order.user.phone) {
      await sendWhatsAppMessage(
        order.user.phone,
        `🚫 ORDER CANCELLED BY ADMIN\n\nOrder: ${order.asset} ${order.action}\nAmount: ${order.amount} lots\nReason: ${reason}\n\nContact support if you have questions.`
      );
    }

    res.json({ message: 'Order cancelled successfully' });
  } catch (error) {
    console.error('Cancel order error:', error);
    res.status(500).json({ error: 'Failed to cancel order' });
  }
});

// ===== TRADE MONITORING =====
router.get('/trades', async (req, res) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 50;
    const asset = req.query.asset as string;
    const fromDate = req.query.fromDate as string;
    const toDate = req.query.toDate as string;

    const where: any = {};
    if (asset) where.asset = { contains: asset, mode: 'insensitive' };
    if (fromDate) where.createdAt = { gte: new Date(fromDate) };
    if (toDate) where.createdAt = { ...where.createdAt, lte: new Date(toDate) };

    const [trades, total, volumeStats] = await Promise.all([
      prisma.trade.findMany({
        where,
        include: {
          buyer: { select: { username: true } },
          seller: { select: { username: true } }
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit
      }),
      prisma.trade.count({ where }),
      prisma.trade.aggregate({
        where,
        _sum: { amount: true },
        _avg: { price: true }
      })
    ]);

    res.json({
      trades,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      },
      statistics: {
        totalVolume: volumeStats._sum.amount || 0,
        averagePrice: volumeStats._avg.price || 0
      }
    });
  } catch (error) {
    console.error('Get trades error:', error);
    res.status(500).json({ error: 'Failed to fetch trades' });
  }
});

// ===== WHATSAPP ACTIVITY =====
router.get('/whatsapp/activity', async (req, res) => {
  try {
    const hours = parseInt(req.query.hours as string) || 24;
    const fromTime = new Date(Date.now() - hours * 60 * 60 * 1000);

    // Get WhatsApp activity stats (simplified)
    const stats = await getWhatsAppStats();

    res.json({
      messages: [], // Simplified - no detailed message log for now
      stats,
      timeRange: { hours, fromTime }
    });
  } catch (error) {
    console.error('Get WhatsApp activity error:', error);
    res.status(500).json({ error: 'Failed to fetch WhatsApp activity' });
  }
});

// ===== SYSTEM CONFIGURATION =====
router.get('/config', async (req, res) => {
  try {
    const config = await getSystemConfig();
    res.json({ config });
  } catch (error) {
    console.error('Get config error:', error);
    res.status(500).json({ error: 'Failed to fetch configuration' });
  }
});

router.patch('/config', async (req, res) => {
  try {
    const { key, value } = req.body;
    
    await redisUtils.set(`config:${key}`, JSON.stringify(value));
    
    res.json({ message: 'Configuration updated successfully' });
  } catch (error) {
    console.error('Update config error:', error);
    res.status(500).json({ error: 'Failed to update configuration' });
  }
});

// ===== ANALYTICS =====
router.get('/analytics/overview', async (req, res) => {
  try {
    const days = parseInt(req.query.days as string) || 30;
    const fromDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const [
      userGrowth,
      tradingVolume,
      assetPopularity,
      userActivity
    ] = await Promise.all([
      getUserGrowthData(fromDate),
      getTradingVolumeData(fromDate),
      getAssetPopularityData(fromDate),
      getUserActivityData(fromDate)
    ]);

    res.json({
      timeRange: { days, fromDate },
      userGrowth,
      tradingVolume,
      assetPopularity,
      userActivity
    });
  } catch (error) {
    console.error('Get analytics error:', error);
    res.status(500).json({ error: 'Failed to fetch analytics' });
  }
});

// ===== HELPER FUNCTIONS =====

async function getSystemHealth() {
  try {
    const [dbHealth, redisHealth, matchingEngineHealth] = await Promise.all([
      checkDatabaseHealth(),
      checkRedisHealth(),
      checkMatchingEngineHealth()
    ]);

    return {
      database: dbHealth,
      redis: redisHealth,
      matchingEngine: matchingEngineHealth,
      overall: dbHealth && redisHealth && matchingEngineHealth ? 'healthy' : 'degraded'
    };
  } catch (error) {
    return {
      database: false,
      redis: false,
      matchingEngine: false,
      overall: 'error'
    };
  }
}

async function checkDatabaseHealth() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

async function checkRedisHealth() {
  try {
    await redisUtils.get('health_check');
    return true;
  } catch {
    return false;
  }
}

async function checkMatchingEngineHealth() {
  try {
    const lastRun = await redisUtils.get('matching:last_run');
    if (!lastRun) return false;
    
    const lastRunTime = new Date(lastRun);
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    
    return lastRunTime > fiveMinutesAgo;
  } catch {
    return false;
  }
}

async function getWhatsAppStats() {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const stats = await redisUtils.get('whatsapp:daily_stats') || '{}';
    return JSON.parse(stats);
  } catch {
    return { messages: 0, orders: 0, errors: 0 };
  }
}

async function getUserSummary(userId: string) {
  const [orderStats, tradeStats] = await Promise.all([
    prisma.order.aggregate({
      where: { userId },
      _count: { id: true }
    }),
    prisma.trade.aggregate({
      where: {
        OR: [{ buyerId: userId }, { sellerId: userId }]
      },
      _count: { id: true },
      _sum: { amount: true }
    })
  ]);

  return {
    totalOrders: orderStats._count.id,
    totalTrades: tradeStats._count.id,
    totalVolume: tradeStats._sum.amount || 0
  };
}

async function getSystemConfig() {
  try {
    const keys = [
      'commission_rate',
      'max_orders_per_user',
      'order_expiry_hours',
      'matching_interval_seconds',
      'whatsapp_enabled'
    ];
    
    const config: any = {};
    for (const key of keys) {
      const value = await redisUtils.get(`config:${key}`);
      config[key] = value ? JSON.parse(value) : getDefaultConfigValue(key);
    }
    
    return config;
  } catch {
    return {};
  }
}

function getDefaultConfigValue(key: string) {
  const defaults: any = {
    commission_rate: 0.001,
    max_orders_per_user: 50,
    order_expiry_hours: 24,
    matching_interval_seconds: 120,
    whatsapp_enabled: true
  };
  return defaults[key];
}

async function getUserGrowthData(fromDate: Date) {
  const growth = await prisma.user.groupBy({
    by: ['createdAt'],
    _count: { id: true },
    where: {
      createdAt: { gte: fromDate }
    }
  });

  return growth.map(g => ({
    date: g.createdAt.toISOString().split('T')[0],
    count: g._count.id
  }));
}

async function getTradingVolumeData(fromDate: Date) {
  const volume = await prisma.trade.groupBy({
    by: ['createdAt'],
    _sum: { amount: true },
    _count: { id: true },
    where: {
      createdAt: { gte: fromDate }
    }
  });

  return volume.map(v => ({
    date: v.createdAt.toISOString().split('T')[0],
    volume: v._sum.amount || 0,
    trades: v._count.id
  }));
}

async function getAssetPopularityData(fromDate: Date) {
  return await prisma.trade.groupBy({
    by: ['asset'],
    _count: { id: true },
    _sum: { amount: true },
    where: {
      createdAt: { gte: fromDate }
    },
    orderBy: {
      _count: { id: 'desc' }
    },
    take: 10
  });
}

async function getUserActivityData(fromDate: Date) {
  const activity = await prisma.order.groupBy({
    by: ['userId'],
    _count: { id: true },
    where: {
      createdAt: { gte: fromDate }
    },
    orderBy: {
      _count: { id: 'desc' }
    },
    take: 20
  });

  // Get usernames
  const userIds = activity.map(a => a.userId);
  const users = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, username: true }
  });

  const userMap = new Map(users.map(u => [u.id, u.username]));

  return activity.map(a => ({
    userId: a.userId,
    username: userMap.get(a.userId) || 'Unknown',
    orderCount: a._count.id
  }));
}

export default router; 