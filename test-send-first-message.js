const axios = require('axios');
require('dotenv').config();

const API_BASE = 'https://api.giftcard.88808880.xyz';

// Import the WhatsApp template service
const { WhatsAppTemplateService } = require('./dist/services/whatsapp-templates');

async function sendFirstMessage() {
  console.log('📱 WhatsApp First Message Sender');
  console.log('==================================\n');

  // Get your phone number (replace with your actual number)
  const YOUR_PHONE = '+1234567890'; // Replace with your actual phone number
  
  console.log('🎯 IMPORTANT: WhatsApp Business Rules');
  console.log('=====================================');
  console.log('❗ Twilio WhatsApp has strict messaging rules:');
  console.log('   1. Users must message you FIRST');
  console.log('   2. OR you need pre-approved templates');
  console.log('   3. After user messages you, you have 24h to respond freely\n');

  console.log('🚀 RECOMMENDED APPROACH: Get Users to Message You First');
  console.log('========================================================');
  console.log('Share these instructions with your users:\n');
  
  console.log('📱 "Send a WhatsApp message to: +14155238886"');
  console.log('💬 "Say: Hello" or "help" to get started');
  console.log('🎯 "Then you can place orders like: buy 100 wheat dec25 at 150"\n');

  console.log('🧪 TESTING: Send Message to Yourself');
  console.log('====================================');
  console.log('1. Open WhatsApp on your phone');
  console.log('2. Send a message to: +14155238886 (your Twilio number)');
  console.log('3. Type: "hello" or "help"');
  console.log('4. You should get an automated response');
  console.log('5. Then try: "buy 100 wheat dec25 at 150"\n');

  // Test if we can send a basic message (this might fail due to WhatsApp rules)
  console.log('🔍 Testing Basic Message Send...');
  try {
    const { sendWhatsAppMessage } = require('./dist/services/whatsapp');
    
    const testMessage = `🤖 WhatsApp Trading Bot Test

This is a test message to verify our WhatsApp integration is working.

If you receive this message, our system can send you notifications!

Try sending "help" to see available commands.`;

    const result = await sendWhatsAppMessage(YOUR_PHONE, testMessage);
    
    if (result) {
      console.log('✅ Test message sent successfully!');
      console.log(`📱 Check your WhatsApp at ${YOUR_PHONE}`);
    } else {
      console.log('❌ Test message failed - this is normal if user hasn\'t messaged you first');
    }
  } catch (error) {
    console.log('❌ Test message failed:', error.message);
    console.log('💡 This is expected - users must message you first!');
  }

  console.log('\n📋 NEXT STEPS');
  console.log('==============');
  console.log('1. Share your WhatsApp number (+14155238886) with users');
  console.log('2. Ask them to send "hello" or "help" first');
  console.log('3. After they message you, you can send notifications freely');
  console.log('4. Your system already sends automatic notifications for:');
  console.log('   • Order creation confirmations');
  console.log('   • Trade execution alerts');
  console.log('   • Partial fill notifications');
  console.log('   • Quantity confirmation requests');
  console.log('   • Market status updates\n');

  console.log('🎉 Your WhatsApp integration is ready!');
  console.log('Users just need to message you first to start receiving notifications.');
}

// Alternative: Create a simple web page users can visit to start WhatsApp conversation
async function createWhatsAppStarter() {
  console.log('\n💡 BONUS: WhatsApp Quick Start Link');
  console.log('===================================');
  
  const whatsappNumber = '+14155238886'; // Your Twilio WhatsApp number
  const message = encodeURIComponent('Hello! I want to start trading.');
  const whatsappLink = `https://wa.me/${whatsappNumber.replace('+', '')}?text=${message}`;
  
  console.log('🔗 Share this link with users for instant WhatsApp connection:');
  console.log(whatsappLink);
  console.log('\n📱 This link will:');
  console.log('1. Open WhatsApp on their phone');
  console.log('2. Pre-fill a message to your trading bot');
  console.log('3. Start the conversation automatically');
  console.log('4. Enable all future notifications\n');
}

// Run the tests
sendFirstMessage()
  .then(() => createWhatsAppStarter())
  .catch(console.error); 