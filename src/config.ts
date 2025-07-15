import dotenv from 'dotenv';

dotenv.config();

// Security
export const SECRET_KEY = process.env['SECRET_KEY'] || 'super-secret-key-change-in-production';
export const JWT_EXPIRY = process.env['JWT_EXPIRY'] || '24h';

// Twilio Configuration
export const TWILIO_ACCOUNT_SID = process.env['TWILIO_ACCOUNT_SID'] || '';
export const TWILIO_AUTH_TOKEN = process.env['TWILIO_AUTH_TOKEN'] || '';
export const TWILIO_PHONE_NUMBER = process.env['TWILIO_PHONE_NUMBER'] || '';

// Database Configuration
export const DATABASE_URL = process.env['DATABASE_URL'] || 'postgresql://localhost:5432/maibroker';
export const DATABASE_TYPE = process.env['DATABASE_TYPE'] || 'postgres'; // postgres, mysql, sqlite

// AI/NLP Configuration
export const OPENAI_API_KEY = process.env['OPENAI_API_KEY'] || '';
export const USE_AI_PARSING = process.env['USE_AI_PARSING'] === 'true';

// WebSocket Configuration
export const WS_PORT = parseInt(process.env['WS_PORT'] || '8001', 10);

// App Settings
export const DEBUG = process.env['DEBUG'] === 'true';
export const HOST = process.env.HOST || '127.0.0.1';
export const PORT = parseInt(process.env['PORT'] || '5000', 10);

// Rate Limiting
export const RATE_LIMIT_WINDOW = parseInt(process.env['RATE_LIMIT_WINDOW'] || '900000', 10);
export const RATE_LIMIT_MAX = parseInt(process.env['RATE_LIMIT_MAX'] || '100', 10);
export const BYPASS_RATE_LIMIT = process.env['BYPASS_RATE_LIMIT'] === 'true';
export const RATE_LIMIT_ENABLED = process.env['RATE_LIMIT_ENABLED'] !== 'false';

// Order Book Settings
export const MAX_ORDERS_PER_USER = parseInt(process.env['MAX_ORDERS_PER_USER'] || '50', 10);
export const ORDER_TIMEOUT_HOURS = parseInt(process.env['ORDER_TIMEOUT_HOURS'] || '24', 10);

// Initialize Twilio client
export let twilioClient: any = null;
if (TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && TWILIO_ACCOUNT_SID.startsWith('AC')) {
  try {
    const { Twilio } = require('twilio');
    twilioClient = new Twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
    console.log('Twilio client initialized successfully');
  } catch (error) {
    console.error('Failed to initialize Twilio client:', error);
  }
} else {
  console.log('Twilio credentials not configured, WhatsApp features will be disabled');
}

// Enhanced Types
export interface UserData {
  username: string;
  password: string;
  phone: string;
  role: 'trader' | 'admin';
  createdAt?: string;
  lastLogin?: string;
}

export interface Order {
  id: string;
  timestamp: string;
  action: 'bid' | 'offer';
  price: number;
  asset: string;
  amount: number;
  remaining: number;
  matched: boolean;
  counterparty?: string | undefined;
  user: string;
  status: 'active' | 'matched' | 'cancelled' | 'expired';
  expiresAt?: string;
  metadata?: Record<string, any>;
}

export interface Trade {
  id: string;
  timestamp: string;
  buyer: string;
  seller: string;
  asset: string;
  price: number;
  amount: number;
  buyerOrderId: string;
  sellerOrderId: string;
  commission?: number;
}

export interface MarketData {
  asset: string;
  bid_price?: number | undefined;
  bid_amount?: number | undefined;
  bid_user?: string | undefined;
  offer_price?: number | undefined;
  offer_amount?: number | undefined;
  offer_user?: string | undefined;
  last_trade_price?: number | undefined;
  last_trade_time?: string | undefined;
  volume_24h?: number | undefined;
}

export interface DashboardResponse {
  username: string;
  orders: OrderResponse[];
  market_data: MarketData[];
  recent_trades: TradeResponse[];
  account_summary: AccountSummary;
}

export interface AccountSummary {
  total_orders: number;
  active_orders: number;
  total_trades: number;
  total_volume: number;
  pnl_24h?: number;
}

export interface LoginRequest {
  username: string;
  password: string;
}

export interface LoginResponse {
  access_token: string;
  token_type: string;
  username: string;
  role: string;
  expires_in: number;
}

export interface OrderRequest {
  action: 'bid' | 'offer';
  price: number;
  monthyear: string;
  product: string;
  amount: number;
  expiresAt?: string;
}

export interface OrderResponse {
  id: string;
  timestamp: string;
  action: 'bid' | 'offer';
  price: number;
  asset: string;
  amount: number;
  remaining: number;
  matched: boolean;
  counterparty?: string | undefined;
  user: string;
  status: 'active' | 'matched' | 'cancelled' | 'expired';
  expiresAt?: string | undefined;
}

export interface TradeResponse {
  id: string;
  timestamp: string;
  buyer: string;
  seller: string;
  asset: string;
  price: number;
  amount: number;
  buyerOrderId: string;
  sellerOrderId: string;
}

export interface WhatsAppMessage {
  from: string;
  body: string;
  timestamp: string;
  messageId: string;
}

export interface ParsedOrder {
  action: 'bid' | 'offer';
  price: number;
  monthyear: string;
  product: string;
  amount: number;
  confidence: number;
  rawText: string;
}

export interface Notification {
  id: string;
  userId: string;
  type: 'order_placed' | 'order_matched' | 'order_cancelled' | 'trade_executed' | 'system';
  title: string;
  message: string;
  timestamp: string;
  read: boolean;
  metadata?: Record<string, any>;
} 