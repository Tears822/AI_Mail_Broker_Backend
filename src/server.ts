import app from './app';
import { PORT, HOST } from './config';
import { prisma } from './database/prisma-client';
import { initRedis, closeRedis } from './config/redis';
import { WebSocketService } from './services/websocket';
import { MatchingEngine } from './services/matching-engine';
import { createServer } from 'http';
import { setWsService } from './ws-singleton';
import { orderBookService } from './services/order-book';

// Check database setup before starting server
async function startServer() {
  try {
    // Test database connection
    console.log('🔗 Testing database connection...');
    await prisma.$connect();
    console.log('✅ Database connection successful');

    // Initialize Redis
    console.log('🔗 Initializing Redis...');
    await initRedis();
    console.log('✅ Redis initialized successfully');

    // Create HTTP server
    const server = createServer(app);

    // Initialize WebSocket service
    console.log('🔗 Initializing WebSocket service...');
    const wsService = new WebSocketService(server);
    setWsService(wsService);
    // Inject wsService into all OrderBookService instances
    orderBookService.setWebSocketService(wsService);
    console.log('✅ WebSocket service initialized');

    // Initialize and start matching engine (temporarily disabled)
    console.log('🔗 Initializing matching engine...');
    const matchingEngine = new MatchingEngine(wsService);
    wsService.setMatchingEngine(matchingEngine); // Set the reference
    orderBookService.setMatchingEngine(matchingEngine); // Inject matching engine for immediate triggers
    matchingEngine.start();
    // console.log('⚠️  Matching engine disabled - working on database connection optimization');

    // Start server
    server.listen(PORT, HOST, () => {
      console.log(`🚀 MaiBroker Backend running on http://${HOST}:${PORT}`);
      console.log(`📊 Health check: http://${HOST}:${PORT}/health`);
      console.log(`🔐 API endpoints: http://${HOST}:${PORT}/api`);
      console.log(`📱 WhatsApp webhook: http://${HOST}:${PORT}/webhook`);
      console.log(`🔌 WebSocket server: ws://${HOST}:${PORT}`);
      console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
    });

    // Graceful shutdown
    const gracefulShutdown = async () => {
      console.log('\n🛑 Shutting down gracefully...');
      
      // Stop matching engine
      matchingEngine.stop();
      
      // Close Redis connections
      await closeRedis();
      
      // Close database connection
      await prisma.$disconnect();
      
      // Close server
      server.close(() => {
        console.log('✅ Server closed');
        process.exit(0);
      });
    };

    process.on('SIGTERM', gracefulShutdown);
    process.on('SIGINT', gracefulShutdown);

  } catch (error) {
    console.error('❌ Failed to start server:', error);
    console.error('🔧 Make sure to run: npm run migrate (to set up database)');
    process.exit(1);
  }
}

// Start the server
startServer(); 