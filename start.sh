#!/bin/bash

# MaiBroker Backend Startup Script

echo "🚀 Starting MaiBroker Backend..."

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js 18+ first."
    exit 1
fi

# Check if npm is installed
if ! command -v npm &> /dev/null; then
    echo "❌ npm is not installed. Please install npm first."
    exit 1
fi

# Check if .env file exists
if [ ! -f .env ]; then
    echo "⚠️  .env file not found. Creating from template..."
    cp env.example .env
    echo "📝 Please edit .env file with your configuration before starting the server."
    exit 1
fi

# Install dependencies if node_modules doesn't exist
if [ ! -d "node_modules" ]; then
    echo "📦 Installing dependencies..."
    npm install
fi

# Check if dist folder exists, if not build the project
if [ ! -d "dist" ]; then
    echo "🔨 Building project..."
    npm run build
fi

# Start the server
echo "🌟 Starting server..."
if [ "$1" = "dev" ]; then
    echo "🔧 Development mode"
    npm run dev
else
    echo "🚀 Production mode"
    npm start
fi 