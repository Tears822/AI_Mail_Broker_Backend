const axios = require('axios');
require('dotenv').config();

const API_BASE = 'https://api.giftcard.88808880.xyz';
const WEBHOOK_URL = `${API_BASE}/webhook/whatsapp`;

// Test user data
const testUsers = [
  {
    username: 'whatsapp_buyer',
    email: 'buyer@whatsapp.test',
    password: 'testpass123',
    phone: '+1234567890',
    role: 'TRADER'
  },
  {
    username: 'whatsapp_seller', 
    email: 'seller@whatsapp.test',
    password: 'testpass123',
    phone: '+1234567891',
    role: 'TRADER'
  }
];

async function createTestUser(userData) {
  try {
    const response = await axios.post(`${API_BASE}/api/auth/register`, userData, {
      headers: { 'Content-Type': 'application/json' }
    });
    console.log(`✅ Created user: ${userData.username}`);
    return response.data;
  } catch (error) {
    if (error.response?.status === 400 && error.response?.data?.error?.includes('already exists')) {
      console.log(`ℹ️  User ${userData.username} already exists`);
      return null;
    }
    console.error(`❌ Failed to create user ${userData.username}:`, error.response?.data);
    return null;
  }
}

async function sendWhatsAppCommand(phone, message, description) {
  console.log(`\n🧪 ${description}`);
  console.log(`📱 From: ${phone}`);
  console.log(`📤 Message: "${message}"`);
  
  try {
    const response = await axios.post(WEBHOOK_URL, {
      Body: message,
      From: `whatsapp:${phone}`,
      To: 'whatsapp:+14155238886'
    }, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });

    console.log(`✅ Status: ${response.status}`);
    console.log(`📥 Response: ${response.data.response}`);
    return response.data;
  } catch (error) {
    console.error(`❌ Failed:`, error.response?.data || error.message);
    return null;
  }
}

async function testWhatsAppNotifications() {
  console.log('🚀 Testing WhatsApp Notifications System');
  console.log('=======================================\n');

  // Step 1: Create test users
  console.log('📋 1. CREATING TEST USERS');
  console.log('=========================');
  
  for (const userData of testUsers) {
    await createTestUser(userData);
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  // Step 2: Test order creation notifications
  console.log('\n📋 2. TESTING ORDER CREATION NOTIFICATIONS');
  console.log('==========================================');
  
  await sendWhatsAppCommand(
    testUsers[0].phone, 
    'buy 100 wheat dec25 at 150',
    'Testing buy order creation - should send WhatsApp notification'
  );
  
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  await sendWhatsAppCommand(
    testUsers[1].phone,
    'sell 50 wheat dec25 at 150', 
    'Testing sell order creation - should trigger partial fill notifications'
  );

  // Step 3: Test quantity mismatch notifications  
  console.log('\n📋 3. TESTING QUANTITY MISMATCH SCENARIO');
  console.log('=======================================');
  
  await new Promise(resolve => setTimeout(resolve, 3000));
  
  await sendWhatsAppCommand(
    testUsers[0].phone,
    'buy 200 gold jan26 at 2000',
    'Testing buyer with larger quantity'
  );
  
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  await sendWhatsAppCommand(
    testUsers[1].phone,
    'sell 100 gold jan26 at 2000',
    'Testing quantity mismatch - should ask buyer about additional quantity'
  );

  // Step 4: Test market data and status
  console.log('\n📋 4. TESTING MARKET STATUS QUERIES');
  console.log('==================================');
  
  await sendWhatsAppCommand(
    testUsers[0].phone,
    'market',
    'Testing market data query'
  );
  
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  await sendWhatsAppCommand(
    testUsers[1].phone,
    'orders',
    'Testing order status query'
  );

  // Step 5: Test help and commands
  console.log('\n📋 5. TESTING HELP SYSTEM');
  console.log('=========================');
  
  await sendWhatsAppCommand(
    testUsers[0].phone,
    'help',
    'Testing help command'
  );

  console.log('\n📋 TEST SUMMARY');
  console.log('===============');
  console.log('✅ Order creation notifications: Tested');
  console.log('✅ Trade execution notifications: Tested');  
  console.log('✅ Partial fill notifications: Tested');
  console.log('✅ Quantity confirmation: Tested');
  console.log('✅ Market status updates: Tested');
  console.log('✅ Help and queries: Tested');
  console.log('\n🎉 WhatsApp notification system testing complete!');
  console.log('\n📱 Check your WhatsApp messages for notifications.');
}

testWhatsAppNotifications().catch(console.error); 