import twilio from 'twilio';

const accountSid = process.env.TWILIO_ACCOUNT_SID || '';
const authToken = process.env.TWILIO_AUTH_TOKEN || '';
const fromNumber = process.env.TWILIO_WHATSAPP_NUMBER || '';

const client = twilio(accountSid, authToken);

/**
 * WhatsApp Template Message Service
 * For business-initiated conversations using pre-approved templates
 */
export class WhatsAppTemplateService {
  
  /**
   * Send a welcome template message (must be pre-approved in Twilio Console)
   */
  static async sendWelcomeTemplate(to: string, userName?: string): Promise<boolean> {
    try {
      const templateMessage = `Hello${userName ? ` ${userName}` : ''}! 👋

Welcome to our trading platform! You can now place orders via WhatsApp.

Quick commands:
• "buy 100 wheat dec25 at 150" - Place buy order
• "sell 50 gold jan26 at 2000" - Place sell order  
• "market" - View market data
• "orders" - Check your orders
• "help" - See all commands

Start trading now!`;

      const formattedTo = to.startsWith('whatsapp:') ? to : `whatsapp:${to}`;
      const formattedFrom = fromNumber.startsWith('whatsapp:') ? fromNumber : `whatsapp:${fromNumber}`;

      const result = await client.messages.create({
        body: templateMessage,
        from: formattedFrom,
        to: formattedTo
      });

      console.log(`✅ Welcome template sent to ${to}: ${result.sid}`);
      return true;
    } catch (error) {
      console.error('❌ Failed to send welcome template:', error);
      return false;
    }
  }

  /**
   * Send market alert template
   */
  static async sendMarketAlertTemplate(to: string, asset: string, price: number, alertType: 'price_target' | 'volume_spike'): Promise<boolean> {
    try {
      let templateMessage = '';
      
      switch (alertType) {
        case 'price_target':
          templateMessage = `🎯 PRICE ALERT: ${asset.toUpperCase()}

Your target price of $${price} has been reached!

Reply with "market" to see current market data or place an order.`;
          break;
          
        case 'volume_spike':
          templateMessage = `📈 VOLUME ALERT: ${asset.toUpperCase()}

Unusual trading activity detected at $${price}!

High volume could indicate market opportunity. Reply "market" for details.`;
          break;
      }

      const formattedTo = to.startsWith('whatsapp:') ? to : `whatsapp:${to}`;
      const formattedFrom = fromNumber.startsWith('whatsapp:') ? fromNumber : `whatsapp:${fromNumber}`;

      const result = await client.messages.create({
        body: templateMessage,
        from: formattedFrom,
        to: formattedTo
      });

      console.log(`✅ Market alert template sent to ${to}: ${result.sid}`);
      return true;
    } catch (error) {
      console.error('❌ Failed to send market alert template:', error);
      return false;
    }
  }

  /**
   * Send order status template
   */
  static async sendOrderStatusTemplate(to: string, orderId: string, status: 'filled' | 'cancelled' | 'expired', details: any): Promise<boolean> {
    try {
      let templateMessage = '';
      
      switch (status) {
        case 'filled':
          templateMessage = `✅ ORDER FILLED

${details.asset} ${details.action}
Amount: ${details.amount} lots
Price: $${details.price}
Order ID: ${orderId.slice(0, 8)}

Your order has been successfully executed!`;
          break;
          
        case 'cancelled':
          templateMessage = `❌ ORDER CANCELLED

Order ID: ${orderId.slice(0, 8)}
${details.asset} ${details.action}

Your order has been cancelled as requested.`;
          break;
          
        case 'expired':
          templateMessage = `⏰ ORDER EXPIRED

Order ID: ${orderId.slice(0, 8)}
${details.asset} ${details.action}

Your order has expired. You can place a new order anytime.`;
          break;
      }

      const formattedTo = to.startsWith('whatsapp:') ? to : `whatsapp:${to}`;
      const formattedFrom = fromNumber.startsWith('whatsapp:') ? fromNumber : `whatsapp:${fromNumber}`;

      const result = await client.messages.create({
        body: templateMessage,
        from: formattedFrom,
        to: formattedTo
      });

      console.log(`✅ Order status template sent to ${to}: ${result.sid}`);
      return true;
    } catch (error) {
      console.error('❌ Failed to send order status template:', error);
      return false;
    }
  }

  /**
   * Send promotional/marketing template
   */
  static async sendPromotionalTemplate(to: string, promoType: 'new_feature' | 'trading_tips' | 'market_news'): Promise<boolean> {
    try {
      let templateMessage = '';
      
      switch (promoType) {
        case 'new_feature':
          templateMessage = `🚀 NEW FEATURE ALERT!

We've added real-time market notifications to keep you updated on your assets.

Enable notifications by replying "ALERTS ON" to never miss trading opportunities!`;
          break;
          
        case 'trading_tips':
          templateMessage = `💡 TRADING TIP

Did you know? You can place multiple orders at once:

"buy 100 wheat dec25 at 150, sell 50 gold jan26 at 2000"

Try it now and optimize your trading strategy!`;
          break;
          
        case 'market_news':
          templateMessage = `📰 MARKET UPDATE

Commodity markets showing increased volatility this week.

Check current prices with "market" command and consider your trading positions.`;
          break;
      }

      const formattedTo = to.startsWith('whatsapp:') ? to : `whatsapp:${to}`;
      const formattedFrom = fromNumber.startsWith('whatsapp:') ? fromNumber : `whatsapp:${fromNumber}`;

      const result = await client.messages.create({
        body: templateMessage,
        from: formattedFrom,
        to: formattedTo
      });

      console.log(`✅ Promotional template sent to ${to}: ${result.sid}`);
      return true;
    } catch (error) {
      console.error('❌ Failed to send promotional template:', error);
      return false;
    }
  }
}

export default WhatsAppTemplateService; 