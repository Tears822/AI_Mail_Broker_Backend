#!/bin/bash

echo "🚀 MaiBroker Backend Environment Setup"
echo "======================================"
echo ""

# Check if .env file exists
if [ -f ".env" ]; then
    echo "⚠️  .env file already exists. Backing up to .env.backup"
    cp .env .env.backup
fi

# Copy example file
cp env.example .env

echo "✅ Created .env file from env.example"
echo ""
echo "📝 Please edit .env file and add your Supabase credentials:"
echo ""
echo "1. Go to your Supabase project dashboard"
echo "2. Navigate to Settings → API"
echo "3. Copy the following values:"
echo "   - Project URL → SUPABASE_URL"
echo "   - Anon public key → SUPABASE_ANON_KEY"
echo "   - Service role key → SUPABASE_SERVICE_KEY"
echo ""
echo "4. Update the .env file with your actual values"
echo ""
echo "🔑 At minimum, you need SUPABASE_ANON_KEY to run the backend"
echo "🔐 SUPABASE_SERVICE_KEY is recommended for full functionality"
echo ""
echo "📄 You can edit the file with: nano .env"
echo ""

# Check if nano is available
if command -v nano &> /dev/null; then
    read -p "Would you like to open .env in nano editor now? (y/n): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        nano .env
    fi
else
    echo "💡 You can edit .env with any text editor"
fi

echo ""
echo "🎯 After updating .env, run: npm run dev"
echo "" 