# MaiBroker Trading Platform - Backend

A real-time trading platform with WhatsApp integration, built with Node.js, Express, TypeScript, Prisma, Redis, and WebSocket.

## 🚀 Features

### Core Trading System
- **Real-time Order Matching Engine** - Processes orders every 100ms
- **Order Book Management** - Bid/offer matching with price-time priority
- **Partial Order Fills** - Support for partial order execution
- **Commission Calculation** - 0.1% commission on trades
- **Order Expiration** - Automatic order expiration after 24 hours

### Real-time Infrastructure
- **WebSocket Server** - Real-time updates for orders, trades, and market data
- **Redis Integration** - Caching, pub/sub, and session management
- **Live Market Updates** - Instant price and order book updates
- **User Notifications** - Real-time trade and order notifications

### WhatsApp Integration
- **Natural Language Processing** - Parse trading commands from WhatsApp
- **Voice Commands** - Support for voice-to-text trading
- **Multi-language Support** - English, Spanish, Portuguese
- **Command Examples**:
  - "Buy 100 Dec25 Wheat at 150"
  - "Sell 50 Jan26 Gold for 2000"
  - "Market" - View market data
  - "Orders" - View your orders
  - "Trades" - View recent trades

### Security & Performance
- **Rate Limiting** - IP-based rate limiting with Redis
- **JWT Authentication** - Secure token-based authentication
- **Input Validation** - Comprehensive order validation
- **Suspicious Activity Detection** - IP-based blocking
- **Compression** - Response compression for better performance

### Database & ORM
- **Prisma ORM** - Type-safe database operations
- **PostgreSQL** - Robust relational database
- **Migrations** - Automated database schema management
- **Connection Pooling** - Optimized database connections

## 🏗️ Architecture

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Frontend      │    │   Backend       │    │   Database      │
│   (Next.js)     │◄──►│   (Express)     │◄──►│   (PostgreSQL)  │
└─────────────────┘    └─────────────────┘    └─────────────────┘
         │                       │                       │
         │                       │                       │
         ▼                       ▼                       ▼
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   WebSocket     │    │   Redis         │    │   WhatsApp      │
│   (Real-time)   │    │   (Cache/Pub)   │    │   (Twilio)      │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

## 📦 Installation

### Prerequisites
- Node.js 18+
- PostgreSQL (or Supabase)
- Redis
- Twilio Account (for WhatsApp)

### Setup

1. **Clone and install dependencies**
```bash
git clone <repository>
cd mailbroker-backend
npm install
```

2. **Environment Configuration**
```bash
cp env.example .env
# Edit .env with your configuration
```

3. **Database Setup**
```bash
# Run Prisma migrations
npx prisma migrate dev

# Generate Prisma client
npx prisma generate
```

4. **Start Redis**
```bash
# Install Redis (Ubuntu/Debian)
sudo apt-get install redis-server

# Or use Docker
docker run -d -p 6379:6379 redis:alpine
```

5. **Start the server**
```bash
npm run dev
```

## 🔧 Configuration

### Environment Variables

```env
# Server
PORT=8000
HOST=localhost
NODE_ENV=development

# Database
DATABASE_URL="postgresql://postgres:password@localhost:5432/maibroker"

# JWT
SECRET_KEY="your-super-secret-jwt-key"

# Redis
REDIS_URL="redis://localhost:6379"

# Twilio (WhatsApp)
TWILIO_ACCOUNT_SID="your-account-sid"
TWILIO_AUTH_TOKEN="your-auth-token"
TWILIO_WHATSAPP_NUMBER="whatsapp:+1234567890"
WHATSAPP_VERIFY_TOKEN="your-webhook-token"

# Frontend
FRONTEND_URL="http://localhost:3000"
```

## 📡 API Endpoints

### Authentication
- `POST /api/auth/register` - User registration
- `POST /api/auth/login` - User login
- `GET /api/auth/profile` - Get user profile

### Orders
- `POST /api/orders` - Create order
- `GET /api/orders` - Get user orders
- `DELETE /api/orders/:id` - Cancel order

### Market Data
- `GET /api/market` - Get market data
- `GET /api/trades` - Get recent trades
- `GET /api/orderbook/:asset` - Get order book

### Account
- `GET /api/account/summary` - Get account summary

### WebSocket Events
- `order:created` - New order created
- `order:matched` - Order matched
- `order:cancelled` - Order cancelled
- `trade:executed` - Trade executed
- `market:update` - Market data update

## 🤖 WhatsApp Commands

### Trading Commands
```
Buy 100 Dec25 Wheat at 150
Sell 50 Jan26 Gold for 2000
Bid 75 Dec25 Oil 10
Offer 1200 Dec25 Silver 25
```

### Information Commands
```
Market - View market data
Orders - View your orders
Trades - View recent trades
Help - Show available commands
```

### Order Management
```
Cancel [order_id] - Cancel specific order
```

## 🔄 Real-time Features

### WebSocket Connection
```javascript
// Frontend connection
import { websocketService } from '@/lib/websocket';

// Connect to WebSocket
websocketService.connect();

// Subscribe to updates
websocketService.subscribeToMarket('Dec25-Wheat');

// Listen for events
socket.on('trade:executed', (data) => {
  console.log('Trade executed:', data);
});
```

### Redis Pub/Sub
```javascript
// Backend publishing
await redisUtils.publish('trade:executed', tradeData);

// Backend subscribing
await redisUtils.subscribe('order:created', (data) => {
  // Handle new order
});
```

## 🧪 Testing

### Unit Tests
```bash
npm test
```

### Integration Tests
```bash
npm run test:integration
```

### Load Testing
```bash
npm run test:load
```

## 📊 Monitoring

### Health Check
```bash
curl http://localhost:8000/health
```

### Metrics
- Order processing rate
- Trade execution time
- WebSocket connection count
- Redis cache hit rate

## 🚀 Deployment

### Docker
```bash
docker build -t maibroker-backend .
docker run -p 8000:8000 maibroker-backend
```

### Environment Variables for Production
```env
NODE_ENV=production
DATABASE_URL="your-production-db-url"
REDIS_URL="your-production-redis-url"
SECRET_KEY="your-production-secret"
```

## 🔒 Security

### Rate Limiting
- Authentication: 5 requests per 15 minutes
- Orders: 10 requests per minute
- API: 100 requests per minute
- Webhooks: 30 requests per minute

### Input Validation
- Order amount and price validation
- Asset and contract validation
- User input sanitization

### Authentication
- JWT token-based authentication
- Token expiration and refresh
- Secure password hashing

## 📈 Performance

### Optimizations
- Redis caching for order book
- Database connection pooling
- Response compression
- Efficient order matching algorithm

### Benchmarks
- Order processing: < 100ms
- WebSocket latency: < 50ms
- Database queries: < 10ms
- Concurrent users: 1000+

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests
5. Submit a pull request

## 📄 License

MIT License - see LICENSE file for details

## 🆘 Support

For support and questions:
- Create an issue on GitHub
- Check the documentation
- Contact the development team

---

**MaiBroker Trading Platform** - Real-time trading with WhatsApp integration 