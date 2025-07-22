import { sendWhatsAppMessage } from './whatsapp';
import { WebSocketService } from './websocket';
import { prisma } from '../database/prisma-client';

export interface NotificationData {
  userId: string;
  type: 'order_created' | 'order_updated' | 'order_cancelled' | 'trade_executed' | 'quantity_confirmation' | 'partial_fill_approval' | 'partial_fill_declined' | 'counterparty_declined';
  data: any;
}

export class NotificationService {
  private wsService: WebSocketService;

  constructor(wsService: WebSocketService) {
    this.wsService = wsService;
  }

  /**
   * Send identical notifications to both WebSocket and WhatsApp
   */
  async sendNotification(notification: NotificationData): Promise<void> {
    try {
      const { userId, type, data } = notification;
      
      // Get user info for WhatsApp
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { phone: true, username: true }
      });

      let message = '';
      let wsEvent = '';
      let wsData = {};

      switch (type) {
        case 'order_created':
          message = this.formatOrderCreatedMessage(data);
          wsEvent = 'order:created';
          wsData = { ...data, message };
          break;

        case 'order_updated':
          message = this.formatOrderUpdatedMessage(data);
          wsEvent = 'order:updated';
          wsData = { ...data, message };
          break;

        case 'order_cancelled':
          message = this.formatOrderCancelledMessage(data);
          wsEvent = 'order:cancelled';
          wsData = { ...data, message };
          break;

        case 'trade_executed':
          message = this.formatTradeExecutedMessage(data);
          wsEvent = 'trade:executed';
          wsData = { ...data, message };
          break;

        case 'quantity_confirmation':
          message = this.formatQuantityConfirmationMessage(data);
          wsEvent = 'quantity:confirmation_request';
          wsData = { ...data, message };
          break;

        case 'partial_fill_approval':
          message = this.formatPartialFillApprovalMessage(data);
          wsEvent = 'quantity:partial_fill_approval';
          wsData = { ...data, message };
          break;

        case 'partial_fill_declined':
          message = this.formatPartialFillDeclinedMessage(data);
          wsEvent = 'quantity:partial_fill_declined';
          wsData = { ...data, message };
          break;

        case 'counterparty_declined':
          message = this.formatCounterpartyDeclinedMessage(data);
          wsEvent = 'quantity:counterparty_declined';
          wsData = { ...data, message };
          break;

        default:
          console.error(`[NOTIFICATION] Unknown notification type: ${type}`);
          return;
      }

      // Send WebSocket notification
      this.wsService.notifyUser(userId, wsEvent, wsData);

      // Send WhatsApp notification
      if (user?.phone && message) {
        await sendWhatsAppMessage(user.phone, message);
        console.log(`📱 ${type} notification sent to ${user.username} (${userId})`);
      }

    } catch (error) {
      console.error('[NOTIFICATION] Error sending notification:', error);
    }
  }

  private formatOrderCreatedMessage(data: any): string {
    return `✅ ORDER CREATED!

${data.asset.toUpperCase()} ${data.action}
Amount: ${data.amount} lots
Price: $${data.price} per lot
Total Value: $${(Number(data.amount) * Number(data.price)).toFixed(2)}
Order ID: ${data.orderId.slice(0, 8)}

Your order is now active in the market.`;
  }

  private formatOrderUpdatedMessage(data: any): string {
    return `📝 ORDER UPDATED!

${data.asset.toUpperCase()} ${data.action}
New Amount: ${data.amount} lots
New Price: $${data.price} per lot
New Total Value: $${(Number(data.amount) * Number(data.price)).toFixed(2)}
Order ID: ${data.orderId.slice(0, 8)}

Your updated order is now active in the market.`;
  }

  private formatOrderCancelledMessage(data: any): string {
    return `❌ ORDER CANCELLED!

${data.asset.toUpperCase()} ${data.action}
Amount: ${data.remaining}/${data.amount} lots
Price: $${data.price} per lot
Order ID: ${data.orderId.slice(0, 8)}

Your order has been successfully cancelled and removed from the market.`;
  }

  private formatTradeExecutedMessage(data: any): string {
    const { asset, side, amount, price, tradeId, orderId, isFullyFilled, remainingAmount } = data;
    
    if (isFullyFilled) {
      return `✅ TRADE EXECUTED! 

${asset.toUpperCase()} ${side === 'buyer' ? 'Purchase' : 'Sale'} COMPLETE
Amount: ${amount} lots
Price: $${price} per lot
Total: $${(amount * price).toFixed(2)}
Order ID: ${orderId.slice(0, 8)}
Trade ID: ${tradeId.slice(0, 8)}

🎉 Your order has been FULLY executed!`;
    } else {
      return `✅ TRADE EXECUTED!

${asset.toUpperCase()} ${side === 'buyer' ? 'Purchase' : 'Sale'} - PARTIAL FILL
Traded: ${amount} lots
Price: $${price} per lot
Total: $${(amount * price).toFixed(2)}
Remaining: ${remainingAmount} lots still active
Order ID: ${orderId.slice(0, 8)}
Trade ID: ${tradeId.slice(0, 8)}

⏳ Your order remains active for the remaining ${remainingAmount} lots.`;
    }
  }

  private formatQuantityConfirmationMessage(data: any): string {
    const { asset, price, yourQuantity, additionalQuantity, side, yourOrderId } = data;
    
    return `🤝 QUANTITY CONFIRMATION NEEDED
        
${asset.toUpperCase()} @ $${price}
Your order: ${yourQuantity} lots
Available: ${yourQuantity + additionalQuantity} lots

Do you want ${additionalQuantity} additional lots?
Reply "YES ${yourOrderId.slice(0, 8)}" to accept
Reply "NO ${yourOrderId.slice(0, 8)}" to proceed with ${yourQuantity} lots only

⏰ You have 60 seconds to respond.`;
  }

  private formatPartialFillApprovalMessage(data: any): string {
    const { asset, price, yourQuantity, partialFillQuantity, yourOrderId } = data;
    
    return `⚠️ PARTIAL FILL APPROVAL NEEDED

${asset.toUpperCase()} @ $${price}
Your order: ${yourQuantity} lots
Counterparty: ${partialFillQuantity} lots

Do you want to proceed with a partial fill for ${partialFillQuantity} lots?
Reply "YES ${yourOrderId.slice(0, 8)}" to accept
Reply "NO ${yourOrderId.slice(0, 8)}" to keep your order active.

⏰ You have 60 seconds to respond.`;
  }

  private formatPartialFillDeclinedMessage(data: any): string {
    return `❌ PARTIAL FILL DECLINED

${data.message || 'The partial fill was declined. No trade was executed. Your order remains active.'}`;
  }

  private formatCounterpartyDeclinedMessage(data: any): string {
    return `❌ COUNTERPARTY DECLINED

${data.message}`;
  }
} 