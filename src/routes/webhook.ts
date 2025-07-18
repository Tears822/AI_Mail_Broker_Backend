import express from 'express';
import { processWhatsAppMessage } from '../services/whatsapp';
import { normalizePhoneNumber } from '../utils';

const router = express.Router();

// WhatsApp webhook endpoint for processing messages
router.post('/whatsapp', async (req, res) => {
  try {
    console.log('📱 [Webhook] Received WhatsApp webhook:', req.body);

    const { Body, From, To } = req.body;
    
    if (!Body || !From) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const message = Body.trim();
    const phoneNumber = normalizePhoneNumber(From);
    
    console.log(`📱 [Webhook] WhatsApp message from ${phoneNumber}: "${message}"`);

    // Process the message using the WhatsApp service (which handles both processing and sending response)
    const response = await processWhatsAppMessage(message, phoneNumber);
    
    console.log(`[Webhook] Response processed for ${phoneNumber}: ${response}`);
    return res.status(200).json({ 
      success: true,
      response: response 
    });

  } catch (error) {
    console.error('[Webhook] Error processing WhatsApp webhook:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Webhook verification (for WhatsApp Business API)
router.get('/whatsapp', (req, res) => {
  const { 'hub.mode': mode, 'hub.verify_token': token, 'hub.challenge': challenge } = req.query;
  
  if (mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    console.log('✅ WhatsApp webhook verified');
    res.status(200).send(challenge);
  } else {
    res.status(403).json({ error: 'Forbidden' });
  }
});

export default router; 