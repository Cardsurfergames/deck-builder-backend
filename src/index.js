/**
 * Cardsurfer Games - Deck Builder Backend
 * 
 * Main entry point. Starts the Express server, initializes the database,
 * runs the initial inventory sync, and schedules periodic re-syncs.
 */

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
const { initializeDatabase } = require('./database');
const { syncInventory } = require('./services/inventory-sync');
const apiRoutes = require('./routes/api');

const app = express();
const PORT = process.env.PORT || 3000;

console.log('=== Cardsurfer Deck Builder Backend Starting ===');
console.log(`[STARTUP] Node version: ${process.version}`);
console.log(`[STARTUP] Environment: ${process.env.NODE_ENV || 'development'}`);
console.log(`[STARTUP] Port: ${PORT}`);
console.log(`[STARTUP] Shopify Store Domain: ${process.env.SHOPIFY_STORE_DOMAIN || 'NOT SET'}`);
console.log(`[STARTUP] Shopify Client ID: ${process.env.SHOPIFY_CLIENT_ID ? process.env.SHOPIFY_CLIENT_ID.substring(0, 8) + '...' : 'NOT SET'}`);
console.log(`[STARTUP] Shopify Client Secret: ${process.env.SHOPIFY_CLIENT_SECRET ? '***SET***' : 'NOT SET'}`);
console.log(`[STARTUP] Database URL: ${process.env.DATABASE_URL ? '***SET***' : 'NOT SET'}`);
console.log(`[STARTUP] Frontend URL: ${process.env.FRONTEND_URL || 'NOT SET'}`);

// Middleware
app.use(cors({
  origin: process.env.FRONTEND_URL || '*',
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type'],
}));
app.use(express.json({ limit: '1mb' }));

// Request logging middleware
app.use((req, res, next) => {
  const start = Date.now();
  console.log(`[REQUEST] ${req.method} ${req.path}`);
  
  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(`[RESPONSE] ${req.method} ${req.path} - ${res.statusCode} (${duration}ms)`);
  });
  
  next();
});

// API Routes
app.use('/api', apiRoutes);

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    service: 'Cardsurfer Deck Builder API',
    version: '1.0.0',
    endpoints: {
      'POST /api/deck/import': 'Parse a deck list (text or URL) and match against inventory',
      'POST /api/deck/parse': 'Parse a deck list without matching',
      'POST /api/deck/match': 'Match card names against inventory',
      'POST /api/deck/auto-select': 'Auto-select variants (cheapest or best-condition)',
      'GET /api/search?q=': 'Search cards by name',
      'GET /api/sync/status': 'Get inventory sync status',
      'POST /api/sync/trigger': 'Trigger manual inventory sync',
      'GET /api/health': 'Health check',
    },
  });
});

// Start server
async function start() {
  try {
    // Initialize database tables
    console.log('[STARTUP] Initializing database...');
    await initializeDatabase();
    console.log('[STARTUP] Database initialized successfully');

    // Start Express server
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`[STARTUP] Server running on port ${PORT}`);
      console.log('[STARTUP] Ready to accept requests');
    });

    // Run initial inventory sync
    console.log('[STARTUP] Starting initial inventory sync...');
    syncInventory()
      .then(result => {
        console.log(`[STARTUP] Initial sync complete: ${result.productCount} products, ${result.variantCount} variants in ${result.elapsed}s`);
      })
      .catch(err => {
        console.error('[STARTUP] Initial sync failed (will retry on schedule):', err.message);
        console.error('[STARTUP] Full error:', err);
      });

    // Schedule inventory sync every 15 minutes
    cron.schedule('*/15 * * * *', () => {
      console.log('[CRON] Running scheduled inventory sync...');
      syncInventory()
        .then(result => {
          console.log(`[CRON] Scheduled sync complete: ${result.productCount} products, ${result.variantCount} variants in ${result.elapsed}s`);
        })
        .catch(err => {
          console.error('[CRON] Scheduled sync failed:', err.message);
          console.error('[CRON] Full error:', err);
        });
    });

    console.log('[STARTUP] Inventory sync scheduled every 15 minutes');

  } catch (error) {
    console.error('[FATAL] Failed to start server:', error);
    process.exit(1);
  }
}

start();
