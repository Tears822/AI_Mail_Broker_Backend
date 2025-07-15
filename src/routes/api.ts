import express from 'express';
import { AuthService } from '../services/auth';
import { OrderBookService } from '../services/order-book';
import { NLPService } from '../services/nlp';
import { authMiddleware, AuthenticatedRequest } from '../middleware/auth';
import { validateOrderInput } from '../utils';
import { WebSocketService } from '../services/websocket';
import { wsService } from '../ws-singleton'; // This file will export the shared wsService instance

const router = express.Router();
const authService = new AuthService();
const orderBookService = new OrderBookService();
const nlpService = new NLPService();

// Authentication routes
router.post('/auth/register', async (req, res) => {
  try {
    const { username, email, password, phone, role } = req.body;
    
    if (!username || !email || !password || !phone) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Normalize role to uppercase for Prisma enum
    const normalizedRole = role ? role.toUpperCase() as 'TRADER' | 'ADMIN' : 'TRADER';

    const result = await authService.register({ username, email, password, phone, role: normalizedRole });
    
    if (result.success) {
      res.status(201).json({
        message: 'User registered successfully',
        user: {
          id: result.user?.id,
          username: result.user?.username,
          email: result.user?.email,
          role: result.user?.role
        },
        token: result.token
      });
    } else {
      res.status(400).json({ error: result.error });
    }
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }

    const result = await authService.login({ username, password });
    
    if (result.success) {
      res.json({
        message: 'Login successful',
        user: {
          id: result.user?.id,
          username: result.user?.username,
          email: result.user?.email,
          role: result.user?.role
        },
        token: result.token
      });
    } else {
      res.status(401).json({ error: result.error });
    }
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Protected routes
router.use(authMiddleware);

// User profile
router.get('/profile', async (req: AuthenticatedRequest, res) => {
  try {
    const user = await authService.getUserById(req.user?.userId || '');
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    res.json({
      id: user.id,
      username: user.username,
      email: user.email,
      phone: user.phone,
      role: user.role,
      lastLoginAt: user.lastLoginAt
    });
  } catch (error) {
    console.error('Profile error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Order management
router.post('/orders', async (req: AuthenticatedRequest, res) => {
  try {
    const { action, price, monthyear, product, amount, expiresAt } = req.body;
    const userId = req.user?.userId || '';

    if (!action || !price || !monthyear || !product || !amount) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    if (!validateOrderInput(action, price, monthyear, product, amount)) {
      return res.status(400).json({ error: 'Invalid order parameters' });
    }

    // Convert action to uppercase to match Prisma enum
    const normalizedAction = action.toUpperCase() as 'BID' | 'OFFER';

    const result = await orderBookService.createOrder(
      userId,
      normalizedAction,
      price,
      monthyear,
      product,
      amount,
      expiresAt ? new Date(expiresAt) : undefined
    );

    if (result.errors.length > 0) {
      return res.status(400).json({ errors: result.errors });
    }

    res.status(201).json({
      message: 'Order created successfully',
      order: result.order
    });
  } catch (error) {
    console.error('Create order error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/orders', async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user?.userId || '';
    const orders = await orderBookService.getUserOrders(userId);
    res.json({ orders });
  } catch (error) {
    console.error('Get orders error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/orders/:orderId', async (req: AuthenticatedRequest, res) => {
  try {
    const { orderId } = req.params;
    const userId = req.user?.userId || '';

    const result = await orderBookService.cancelOrder(userId, orderId);
    
    if (result.success) {
      res.json({ message: result.message });
    } else {
      res.status(400).json({ error: result.message });
    }
  } catch (error) {
    console.error('Cancel order error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Add order update endpoint
router.put('/orders/:orderId', async (req: AuthenticatedRequest, res) => {
  try {
    const { orderId } = req.params;
    const userId = req.user?.userId || '';
    const { price, amount, expiresAt } = req.body;
    if (!price && !amount && !expiresAt) {
      return res.status(400).json({ error: 'No update fields provided' });
    }
    const updates: any = {};
    if (price !== undefined) updates.price = price;
    if (amount !== undefined) updates.amount = amount;
    if (expiresAt !== undefined) updates.expiresAt = new Date(expiresAt);
    const result = await orderBookService.updateOrder(userId, orderId, updates);
    if (result.success) {
      res.json({ message: result.message, order: result.order });
    } else {
      res.status(400).json({ error: result.message });
    }
  } catch (error) {
    console.error('Update order error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Market data
router.get('/market', async (req, res) => {
  try {
    const marketData = await orderBookService.getMarketData();
    res.json({ marketData });
  } catch (error) {
    console.error('Market data error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/trades', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 50;
    const trades = await orderBookService.getRecentTrades(limit);
    res.json({ trades });
  } catch (error) {
    console.error('Trades error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Account summary
router.get('/account', async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user?.userId || '';
    const summary = await orderBookService.getAccountSummary(userId);
    res.json({ summary });
  } catch (error) {
    console.error('Account summary error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Order book statistics
router.get('/stats', async (req, res) => {
  try {
    const stats = await orderBookService.getOrderBookStats();
    res.json({ stats });
  } catch (error) {
    console.error('Stats error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// NLP processing
router.post('/nlp/process', async (req, res) => {
  try {
    const { message } = req.body;
    
    if (!message) {
      return res.status(400).json({ error: 'Message required' });
    }

    const result = await nlpService.processMessage(message);
    res.json({ result });
  } catch (error) {
    console.error('NLP processing error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export { orderBookService };
export default router; 