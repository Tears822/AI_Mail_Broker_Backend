# Prisma Database Setup Guide

## Overview
The MaiBroker backend has been migrated from Supabase to use Prisma ORM with PostgreSQL. This guide will help you set up the database.

## Prerequisites
- Node.js 18+ installed
- PostgreSQL database (Supabase, local, or any PostgreSQL provider)
- Database connection string

## Setup Steps

### 1. Environment Configuration
Create a `.env` file in the `mailbroker-backend` directory with your database connection:

```env
# Database Configuration (Supabase) - Prisma format
DATABASE_URL=postgresql://postgres:your-password@db.your-project-ref.supabase.co:5432/postgres?pgbouncer=true&connection_limit=1&pool_timeout=20

# Other required environment variables
SECRET_KEY=your-super-secret-key-change-in-production
JWT_EXPIRY=24h
SUPABASE_URL=https://your-project-id.supabase.co
SUPABASE_ANON_KEY=your-anon-key-from-supabase-dashboard
SUPABASE_SERVICE_KEY=your-service-role-key-from-supabase-dashboard
TWILIO_ACCOUNT_SID=your-twilio-account-sid
TWILIO_AUTH_TOKEN=your-twilio-auth-token
TWILIO_PHONE_NUMBER=your-twilio-phone-number
```

### 2. Database Schema Setup
Run the following commands to set up the database:

```bash
# Generate Prisma client
npm run generate

# Push the schema to your database (creates tables)
npm run migrate

# Or if you want to use migrations (recommended for production)
npm run migrate:dev
```

### 3. Verify Setup
Test the database connection:

```bash
# Start the development server
npm run dev
```

The server should start without database errors.

## Database Schema

The Prisma schema includes three main models:

### User Model
- `id`: UUID primary key
- `username`: Unique username
- `email`: Unique email
- `passwordHash`: Hashed password
- `phone`: Phone number
- `role`: TRADER or ADMIN
- `isActive`: Account status
- `lastLoginAt`: Last login timestamp
- `createdAt`/`updatedAt`: Timestamps

### Order Model
- `id`: UUID primary key
- `action`: BID or OFFER
- `price`: Decimal price
- `asset`: Trading asset (e.g., "JAN24-GAS")
- `amount`: Order amount
- `remaining`: Remaining amount
- `matched`: Whether order is matched
- `counterparty`: Counterparty user ID
- `status`: ACTIVE, MATCHED, CANCELLED, EXPIRED
- `expiresAt`: Expiration timestamp
- `metadata`: JSON metadata
- `userId`: User reference
- `createdAt`/`updatedAt`: Timestamps

### Trade Model
- `id`: UUID primary key
- `asset`: Trading asset
- `price`: Trade price
- `amount`: Trade amount
- `buyerOrderId`/`sellerOrderId`: Order references
- `commission`: Trade commission
- `buyerId`/`sellerId`: User references
- `createdAt`: Timestamp

## API Endpoints

### Authentication
- `POST /api/auth/register` - Register new user
- `POST /api/auth/login` - User login

### Orders
- `POST /api/orders` - Create order
- `GET /api/orders` - Get user orders
- `DELETE /api/orders/:orderId` - Cancel order

### Market Data
- `GET /api/market` - Get market data
- `GET /api/trades` - Get recent trades
- `GET /api/account` - Get account summary

### WhatsApp
- `POST /webhook/whatsapp` - WhatsApp webhook

## Troubleshooting

### Common Issues

1. **Database Connection Error**
   - Check your DATABASE_URL format
   - Ensure database is accessible
   - Verify credentials

2. **Schema Push Fails**
   - Check if tables already exist
   - Verify database permissions
   - Try `npm run migrate:dev` instead

3. **Prisma Client Not Generated**
   - Run `npm run generate`
   - Check for TypeScript errors

### Getting Help
- Check the Prisma documentation: https://www.prisma.io/docs
- Review the schema file: `prisma/schema.prisma`
- Check server logs for detailed error messages

## Next Steps
1. Set up your environment variables
2. Run the migration commands
3. Start the development server
4. Test user registration and login
5. Test order creation and matching 