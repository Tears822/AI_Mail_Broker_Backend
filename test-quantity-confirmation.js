const { prisma } = require('./src/database/prisma-client');
const { WebSocketService } = require('./src/services/websocket');
const { MatchingEngine } = require('./src/services/matching-engine');
const { createServer } = require('http');

async function testQuantityConfirmation() {
  console.log('🧪 Testing Quantity Confirmation System');
  
  try {
    // Create mock WebSocket service
    const server = createServer();
    const wsService = new WebSocketService(server);
    const matchingEngine = new MatchingEngine(wsService);
    wsService.setMatchingEngine(matchingEngine);

    // Test scenario: Buyer has 10 lots, Seller has 12 lots
    console.log('\n📋 Test Scenario: Buyer 10 lots vs Seller 12 lots');
    
    // Create test users
    const buyer = await prisma.user.create({
      data: {
        username: 'test_buyer_' + Date.now(),
        email: 'buyer@test.com',
        password: 'password',
        phone: '+1234567890',
        role: 'TRADER'
      }
    });

    const seller = await prisma.user.create({
      data: {
        username: 'test_seller_' + Date.now(),
        email: 'seller@test.com',
        password: 'password',
        phone: '+1234567891',
        role: 'TRADER'
      }
    });

    // Create test orders
    const bidOrder = await prisma.order.create({
      data: {
        action: 'BID',
        price: 100,
        asset: 'dec25-wheat',
        amount: 10,
        remaining: 10,
        status: 'ACTIVE',
        userId: buyer.id
      }
    });

    const offerOrder = await prisma.order.create({
      data: {
        action: 'OFFER',
        price: 100,
        asset: 'dec25-wheat',
        amount: 12,
        remaining: 12,
        status: 'ACTIVE',
        userId: seller.id
      }
    });

    console.log(`✅ Created orders: Bid ${bidOrder.id.slice(0, 8)} (10 lots), Offer ${offerOrder.id.slice(0, 8)} (12 lots)`);

    // Mock the notifyUserViaWhatsApp method to avoid actual WhatsApp sending
    matchingEngine.notifyUserViaWhatsApp = async (userId, message) => {
      console.log(`📱 Mock WhatsApp to ${userId}: ${message}`);
      return true;
    };

    // Test the matching process
    console.log('\n🔄 Running matching engine...');
    await matchingEngine.processAssetMatching('dec25-wheat', [bidOrder, offerOrder]);

    // Check if confirmation was created
    const pendingConfirmations = matchingEngine.getUserPendingConfirmations(buyer.id);
    console.log(`\n✅ Pending confirmations for buyer: ${pendingConfirmations.length}`);
    
    if (pendingConfirmations.length > 0) {
      const confirmation = pendingConfirmations[0];
      console.log(`📋 Confirmation details:`, {
        asset: confirmation.details.asset,
        yourQuantity: confirmation.details.yourQuantity,
        availableQuantity: confirmation.details.availableQuantity,
        additionalQuantity: confirmation.details.additionalQuantity,
        side: confirmation.details.side
      });

      // Test acceptance
      console.log('\n✅ Testing ACCEPTANCE...');
      await matchingEngine.handleQuantityConfirmationResponse(
        confirmation.confirmationKey, 
        true, 
        confirmation.details.availableQuantity
      );

      // Check if orders were updated
      const updatedBid = await prisma.order.findUnique({ where: { id: bidOrder.id } });
      console.log(`Updated bid order amount: ${updatedBid.amount} (should be 12)`);

      // Check if trade was created
      const trades = await prisma.trade.findMany({
        where: {
          OR: [
            { buyerOrderId: bidOrder.id },
            { sellerOrderId: offerOrder.id }
          ]
        }
      });
      console.log(`Trades created: ${trades.length} (should be 1)`);
      if (trades.length > 0) {
        console.log(`Trade details: ${trades[0].amount} lots @ $${trades[0].price}`);
      }
    } else {
      console.log('❌ No pending confirmations created');
    }

    // Cleanup
    await prisma.trade.deleteMany({
      where: {
        OR: [
          { buyerId: buyer.id },
          { sellerId: seller.id }
        ]
      }
    });
    await prisma.order.deleteMany({
      where: {
        userId: { in: [buyer.id, seller.id] }
      }
    });
    await prisma.user.deleteMany({
      where: {
        id: { in: [buyer.id, seller.id] }
      }
    });

    console.log('\n🎉 Test completed successfully!');

  } catch (error) {
    console.error('❌ Test failed:', error);
  } finally {
    await prisma.$disconnect();
    process.exit(0);
  }
}

// Run the test
testQuantityConfirmation(); 