import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import { apiRateLimit, authRateLimit, orderRateLimit, webhookRateLimit, checkSuspiciousActivity, trackFailedAuth } from './middleware/rate-limit';
import authRoutes from './routes/auth';
import apiRoutes from './routes/api';
import webhookRoutes from './routes/webhook';
import adminRoutes from './routes/admin';

const app = express();

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
    },
  },
}));

// CORS configuration
const corsOrigins = process.env.CORS_ORIGINS 
  ? process.env.CORS_ORIGINS.split(',').map(origin => origin.trim())
  : [
      'http://localhost:3000', 
      'http://localhost:3001',
      'https://giftcard.88808880.xyz',
      'https://api.giftcard.88808880.xyz',
      'https://webhook.88808880.xyz'
    ];

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    if (corsOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      console.warn(`CORS blocked request from: ${origin}`);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));

// Compression
app.use(compression());

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Security checks
app.use(checkSuspiciousActivity);
app.use(trackFailedAuth);

// Rate limiting
app.use('/api/auth', authRateLimit);
app.use('/api/orders', orderRateLimit);
app.use('/api/admin', apiRateLimit); // Admin routes get API rate limiting
app.use('/webhook', webhookRateLimit);
app.use('/api', apiRateLimit);

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV || 'development'
  });
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api', apiRoutes);
app.use('/webhook', webhookRoutes);

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    error: 'Not Found',
    message: `Route ${req.originalUrl} not found`
  });
});

// Global error handler
app.use((error: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Global error handler:', error);
  
  const status = error.status || 500;
  const message = error.message || 'Internal Server Error';
  
  res.status(status).json({
    error: status === 500 ? 'Internal Server Error' : error.name || 'Error',
    message,
    ...(process.env.NODE_ENV === 'development' && { stack: error.stack })
  });
});

export default app; 