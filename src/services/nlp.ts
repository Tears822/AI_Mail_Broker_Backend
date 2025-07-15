/**
 * NLP Service for processing natural language messages
 */
export class NLPService {
  /**
   * Process a natural language message and extract trading intent
   */
  async processMessage(message: string): Promise<any> {
    const lowerMessage = message.toLowerCase();
    
    // Extract basic patterns
    const patterns = {
      bid: /(buy|bid|purchase)\s+(\d+)\s+(\w+)\s+(\w+)\s+at\s+(\d+)/i,
      offer: /(sell|offer|sell)\s+(\d+)\s+(\w+)\s+(\w+)\s+at\s+(\d+)/i,
      cancel: /(cancel|delete)\s+order\s+(\w+)/i,
      market: /(market|price|quote)\s+(\w+)\s+(\w+)/i,
      balance: /(balance|account|summary)/i
    };

    // Check for bid pattern
    const bidMatch = lowerMessage.match(patterns.bid);
    if (bidMatch) {
      return {
        intent: 'create_order',
        action: 'bid',
        amount: parseInt(bidMatch[2]),
        product: bidMatch[3],
        monthyear: bidMatch[4],
        price: parseInt(bidMatch[5]),
        confidence: 0.9
      };
    }

    // Check for offer pattern
    const offerMatch = lowerMessage.match(patterns.offer);
    if (offerMatch) {
      return {
        intent: 'create_order',
        action: 'offer',
        amount: parseInt(offerMatch[2]),
        product: offerMatch[3],
        monthyear: offerMatch[4],
        price: parseInt(offerMatch[5]),
        confidence: 0.9
      };
    }

    // Check for cancel pattern
    const cancelMatch = lowerMessage.match(patterns.cancel);
    if (cancelMatch) {
      return {
        intent: 'cancel_order',
        orderId: cancelMatch[2],
        confidence: 0.8
      };
    }

    // Check for market query
    const marketMatch = lowerMessage.match(patterns.market);
    if (marketMatch) {
      return {
        intent: 'market_data',
        product: marketMatch[2],
        monthyear: marketMatch[3],
        confidence: 0.7
      };
    }

    // Check for balance query
    const balanceMatch = lowerMessage.match(patterns.balance);
    if (balanceMatch) {
      return {
        intent: 'account_summary',
        confidence: 0.6
      };
    }

    // Default response for unrecognized messages
    return {
      intent: 'unknown',
      message: 'I did not understand your request. Please use clear trading commands.',
      confidence: 0.0
    };
  }

  /**
   * Extract order parameters from natural language
   */
  async extractOrderParams(message: string): Promise<any> {
    const result = await this.processMessage(message);
    
    if (result.intent === 'create_order') {
      return {
        action: result.action,
        amount: result.amount,
        product: result.product,
        monthyear: result.monthyear,
        price: result.price
      };
    }
    
    return null;
  }

  /**
   * Generate human-readable response
   */
  generateResponse(intent: string, data?: any): string {
    switch (intent) {
      case 'create_order':
        return `Order created: ${data.action} ${data.amount} ${data.product} ${data.monthyear} at ${data.price}`;
      
      case 'cancel_order':
        return `Order ${data.orderId} cancelled successfully`;
      
      case 'market_data':
        return `Market data for ${data.product} ${data.monthyear}: ${data.bidPrice || 'N/A'} / ${data.offerPrice || 'N/A'}`;
      
      case 'account_summary':
        return `Account summary: ${data.totalOrders} orders, ${data.totalTrades} trades, ${data.totalVolume} volume`;
      
      case 'unknown':
        return 'Please use clear trading commands like "buy 1000 gas jan24 at 50" or "sell 500 power feb24 at 75"';
      
      default:
        return 'Command processed successfully';
    }
  }
} 