import twilio from 'twilio';
import { processNLPCommand } from './nlp-parser';
import { orderBookService } from './order-book';

const accountSid = process.env.TWILIO_ACCOUNT_SID || '';
const authToken = process.env.TWILIO_AUTH_TOKEN || '';
const fromNumber = process.env.TWILIO_WHATSAPP_NUMBER || '';

// Initialize Twilio client
const client = twilio(accountSid, authToken);

/**
 * Process incoming WhatsApp message
 */
export async function processWhatsAppMessage(message: string, from: string): Promise<string> {
  try {
    console.log(`📱 Processing WhatsApp message: ${message} from ${from}`);

    // Process the message using NLP
    const result = await processNLPCommand(message, from);
    
    if (result.success) {
      // Send response back via WhatsApp
      await sendWhatsAppMessage(from, result.response);
      return result.response;
    } else {
      const errorResponse = `❌ ${result.error}`;
      await sendWhatsAppMessage(from, errorResponse);
      return errorResponse;
    }
  } catch (error) {
    console.error('Error processing WhatsApp message:', error);
    const errorResponse = '❌ Sorry, I encountered an error processing your request.';
    await sendWhatsAppMessage(from, errorResponse);
    return errorResponse;
  }
}

/**
 * Send WhatsApp message via Twilio
 */
export async function sendWhatsAppMessage(to: string, message: string): Promise<boolean> {
  try {
    if (!accountSid || !authToken || !fromNumber) {
      console.error('❌ Twilio credentials not configured');
      return false;
    }

    // Format phone number for WhatsApp
    const formattedTo = to.startsWith('whatsapp:') ? to : `whatsapp:${to}`;
    const formattedFrom = fromNumber.startsWith('whatsapp:') ? fromNumber : `whatsapp:${fromNumber}`;

    const result = await client.messages.create({
      body: message,
      from: formattedFrom,
      to: formattedTo
    });

    console.log(`✅ WhatsApp message sent to ${to}: ${result.sid}`);
    return true;
  } catch (error) {
    console.error('❌ Failed to send WhatsApp message:', error);
    return false;
  }
}

/**
 * Send SMS message via Twilio
 */
export async function sendSMSMessage(to: string, message: string): Promise<boolean> {
  try {
    if (!accountSid || !authToken || !fromNumber) {
      console.error('❌ Twilio credentials not configured');
      return false;
    }

    const result = await client.messages.create({
      body: message,
      from: fromNumber.replace('whatsapp:', ''),
      to: to
    });

    console.log(`✅ SMS sent to ${to}: ${result.sid}`);
    return true;
  } catch (error) {
    console.error('❌ Failed to send SMS:', error);
    return false;
  }
}

/**
 * Verify Twilio webhook signature
 */
export function verifyWebhookSignature(
  url: string,
  params: Record<string, string>,
  signature: string
): boolean {
  try {
    return twilio.validateRequest(
      authToken,
      signature,
      url,
      params
    );
  } catch (error) {
    console.error('❌ Webhook signature verification failed:', error);
    return false;
  }
} 