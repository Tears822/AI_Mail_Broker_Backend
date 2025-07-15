import { Router } from 'express';
import { processWhatsAppMessage } from '../services/whatsapp';
import { whatsappAuthService } from '../services/whatsapp-auth';

const router = Router();

// WhatsApp webhook endpoint
router.post('/whatsapp', async (req, res) => {
  try {
    const { Body, From, To } = req.body;
    
    if (!Body || !From) {
      console.log('[Webhook] Missing required fields:', { Body: !!Body, From: !!From });
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const phoneNumber = From.replace('whatsapp:', '');
    console.log(`📱 [Webhook] WhatsApp message from ${phoneNumber}: "${Body}"`);

    // Authenticate user using WhatsApp auth service
    try {
      const session = await whatsappAuthService.authenticateUser(phoneNumber);
      console.log(`[Webhook] User authenticated: ${session.username} (${session.isRegistered ? 'Registered' : 'Guest'})`);
    } catch (error) {
      console.error('[Webhook] Authentication failed:', error);
      return res.status(500).json({ error: 'Authentication failed' });
    }

    // Process the message
    const response = await processWhatsAppMessage(Body, From);
    
    console.log(`[Webhook] Response sent to ${phoneNumber}:`, response);
    
    res.json({
      success: true,
      response
    });
  } catch (error) {
    console.error('[Webhook] Error:', error);
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