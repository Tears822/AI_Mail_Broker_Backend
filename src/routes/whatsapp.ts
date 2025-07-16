import express from 'express';
import { orderBookService } from '../services/order-book';
import { NLPService } from '../services/nlp';
import { AuthService } from '../services/auth';
import { sendWhatsAppMessage } from '../services/whatsapp';
import { normalizeOrderInput } from '../utils';
import { WebSocketService } from '../services/websocket';
import { wsService } from '../ws-singleton';

const router = express.Router();
const nlpService = new NLPService();
const authService = new AuthService();

// WhatsApp webhook endpoint
router.post('/webhook', async (req, res) => {
  try {
    const { Body, From, To } = req.body;
    
    if (!Body || !From) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const message = Body.trim();
    const phoneNumber = From.replace('whatsapp:', '');
    
    console.log(`📱 WhatsApp message from ${phoneNumber}: ${message}`);

    // Process message with NLP
    const nlpResult = await nlpService.processMessage(message);
    
    let response = '';

    switch (nlpResult.intent) {
      case 'create_order':
        try {
          // Find user by phone number
          const user = await authService.getUserByPhone(phoneNumber);
          if (!user) {
            response = '❌ User not found. Please register first.';
            break;
          }

          const result = await orderBookService.createOrder(
            user.id,
            nlpResult.action.toUpperCase() as 'BID' | 'OFFER',
            nlpResult.price,
            nlpResult.monthyear,
            nlpResult.product,
            nlpResult.amount
          );

          if (result.errors.length > 0) {
            response = `❌ Order creation failed: ${result.errors.join(', ')}`;
          } else {
            response = `✅ Order created successfully!\n\n` +
                      `Type: ${nlpResult.action.toUpperCase()}\n` +
                      `Amount: ${nlpResult.amount}\n` +
                      `Product: ${nlpResult.product} ${nlpResult.monthyear}\n` +
                      `Price: $${nlpResult.price}\n` +
                      `Order ID: ${result.order.id}`;
          }
        } catch (error) {
          console.error('Order creation error:', error);
          response = '❌ Failed to create order. Please try again.';
        }
        break;

      case 'cancel_order':
        try {
          const user = await authService.getUserByPhone(phoneNumber);
          if (!user) {
            response = '❌ User not found. Please register first.';
            break;
          }

          const result = await orderBookService.cancelOrder(user.id, nlpResult.orderId);
          
          if (result.success) {
            response = `✅ ${result.message}`;
          } else {
            response = `❌ ${result.message}`;
          }
        } catch (error) {
          console.error('Order cancellation error:', error);
          response = '❌ Failed to cancel order. Please try again.';
        }
        break;

      case 'market_data':
        try {
          const marketData = await orderBookService.getMarketData();
          const asset = `${nlpResult.monthyear}-${nlpResult.product}`;
          const assetData = marketData.find(m => m.asset === asset);
          
          if (assetData) {
            response = `📊 Market Data for ${nlpResult.product} ${nlpResult.monthyear}:\n\n` +
                      `Best Bid: ${assetData.bid_price ? `$${assetData.bid_price}` : 'N/A'}\n` +
                      `Best Offer: ${assetData.offer_price ? `$${assetData.offer_price}` : 'N/A'}\n` +
                      `Bid Volume: ${assetData.bid_amount || 'N/A'}\n` +
                      `Offer Volume: ${assetData.offer_amount || 'N/A'}`;
          } else {
            response = `📊 No market data available for ${nlpResult.product} ${nlpResult.monthyear}`;
          }
        } catch (error) {
          console.error('Market data error:', error);
          response = '❌ Failed to fetch market data. Please try again.';
        }
        break;

      case 'account_summary':
        try {
          const user = await authService.getUserByPhone(phoneNumber);
          if (!user) {
            response = '❌ User not found. Please register first.';
            break;
          }

          const summary = await orderBookService.getAccountSummary(user.id);
          
          response = `📈 Account Summary for ${user.username}:\n\n` +
                    `Total Orders: ${summary.total_orders}\n` +
                    `Active Orders: ${summary.active_orders}\n` +
                    `Total Trades: ${summary.total_trades}\n` +
                    `Total Volume: ${summary.total_volume}\n` +
                    `24h P&L: $${summary.pnl_24h}`;
        } catch (error) {
          console.error('Account summary error:', error);
          response = '❌ Failed to fetch account summary. Please try again.';
        }
        break;

      case 'unknown':
        response = `🤖 I didn't understand your message. Here are some examples:\n\n` +
                  `• "buy 1000 gas jan24 at 50"\n` +
                  `• "sell 500 power feb24 at 75"\n` +
                  `• "cancel order ABC123"\n` +
                  `• "market gas jan24"\n` +
                  `• "balance"`;
        break;

      default:
        response = '❌ Unknown command. Please try again.';
    }

    // Send WhatsApp response
    await sendWhatsAppMessage(phoneNumber, response);
    
    res.status(200).json({ success: true, response });
  } catch (error) {
    console.error('WhatsApp webhook error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// WhatsApp webhook verification (for Twilio)
router.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    console.log('✅ WhatsApp webhook verified');
    res.status(200).send(challenge);
  } else {
    console.log('❌ WhatsApp webhook verification failed');
    res.status(403).json({ error: 'Verification failed' });
  }
});

export default router;