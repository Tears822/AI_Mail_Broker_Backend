#!/bin/bash

echo "🚀 MaiBroker Backend Setup Script"
echo "=================================="

# Check if .env file exists
if [ ! -f .env ]; then
    echo "📝 Creating .env file from template..."
    cp env.example .env
    echo "⚠️  Please edit .env file with your database credentials before continuing"
    echo "   Key variables to set:"
    echo "   - DATABASE_URL (your PostgreSQL connection string)"
    echo "   - SECRET_KEY (a secure random string)"
    echo "   - SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_KEY (if using Supabase)"
    echo ""
    read -p "Press Enter after you've configured .env file..."
else
    echo "✅ .env file already exists"
fi

# Install dependencies
echo "📦 Installing dependencies..."
npm install

# Generate Prisma client
echo "🔧 Generating Prisma client..."
npm run generate

# Check if DATABASE_URL is set
if grep -q "DATABASE_URL=postgresql://" .env; then
    echo "🗄️  Setting up database..."
    echo "   This will create tables in your database"
    echo "   Make sure your database is accessible"
    echo ""
    read -p "Press Enter to continue with database setup..."
    
    # Run migration
    npm run migrate
    
    echo ""
    echo "🎉 Setup completed!"
    echo ""
    echo "Next steps:"
    echo "1. Start the server: npm run dev"
    echo "2. Test the API: curl http://localhost:8000/health"
    echo "3. Register a user: POST http://localhost:8000/api/auth/register"
    echo ""
    echo "📚 For more information, see PRISMA_SETUP.md"
else
    echo "⚠️  DATABASE_URL not found in .env file"
    echo "   Please set up your database connection string first"
    echo "   Example: DATABASE_URL=postgresql://user:pass@host:port/db"
fi 