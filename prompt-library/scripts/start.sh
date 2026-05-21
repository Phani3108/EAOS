#!/bin/sh
# Startup script for AgentOS Prompt Library
# Runs database migrations then starts the Next.js application

set -e

echo ""
echo "╔═══════════════════════════════════════════════════════════════╗"
echo "║                                                               ║"
echo "║   🚀 AgentOS Prompt Library                                     ║"
echo "║                                                               ║"
echo "╚═══════════════════════════════════════════════════════════════╝"
echo ""

# Verify required environment variables
if [ -z "$DATABASE_URL" ]; then
    echo "❌ ERROR: DATABASE_URL environment variable is required"
    exit 1
fi

# Generate AUTH_SECRET if not provided (development only)
if [ -z "$AUTH_SECRET" ]; then
    echo "⚠️  WARNING: AUTH_SECRET not set, generating random value"
    echo "   For production, set AUTH_SECRET environment variable"
    export AUTH_SECRET=$(openssl rand -base64 32)
fi

echo "✓ Environment configured"
echo "  - Node: $(node --version)"
echo "  - Database: ${DATABASE_URL%%@*}@***"
echo ""

# Run database migrations
echo "▶ Running database migrations..."
cd /app
node node_modules/prisma/build/index.js migrate deploy
echo "✓ Migrations complete"
echo ""

# Sync admin roles from config/admins.json
# Runs on every startup — safe to run repeatedly (only promotes, never demotes)
echo "▶ Syncing admin roles..."
node scripts/sync-admins.js
echo ""

# Optional: Seed database (only if SEED_DATABASE=true)
if [ "${SEED_DATABASE:-false}" = "true" ]; then
    echo "▶ Seeding database with prompts..."
    if node_modules/.bin/tsx prisma/seed.ts; then
        echo "✓ Database seeded"
    else
        echo "ℹ️  Seeding skipped or already complete"
    fi
    echo ""
fi

echo "╔═══════════════════════════════════════════════════════════════╗"
echo "║   🚀 Starting Next.js server...                              ║"
echo "╚═══════════════════════════════════════════════════════════════╝"
echo ""

# Start Next.js server
exec node server.js
