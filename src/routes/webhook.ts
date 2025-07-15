import { Router } from 'express';
import { processWhatsAppMessage } from '../services/whatsapp';

const router = Router();

// WhatsApp webhook endpoint
router.post('/whatsapp', async (req, res) => {
  try {
    const { Body, From, To } = req.body;
    
    if (!Body || !From) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    console.log(`📱 WhatsApp message from ${From}: ${Body}`);

    // Process the message
    const response = await processWhatsAppMessage(Body, From);
    
    res.json({
      success: true,
      response
    });
  } catch (error) {
    console.error('Webhook error:', error);
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