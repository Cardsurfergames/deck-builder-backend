/**
 * API Routes
 * 
 * All endpoints for the deck builder frontend to consume.
 */

const express = require('express');
const router = express.Router();
const { parseDeckInput } = require('../services/deck-parser');
const { matchDeckList, getCheapestForEach, getBestConditionForEach, searchCards } = require('../services/deck-matcher');
const { syncInventory } = require('../services/inventory-sync');
const { pool } = require('../database');

/**
 * POST /api/deck/parse
 * 
 * Accepts a deck list (text or URL) and returns parsed card names with quantities.
 * This is step 1: just parse, don't match against inventory yet.
 */
router.post('/deck/parse', async (req, res) => {
  try {
    const { input } = req.body;
    console.log(`[API] POST /deck/parse - input length: ${input ? input.length : 'null'}`);
    
    if (!input || typeof input !== 'string') {
      console.log('[API] POST /deck/parse - bad request: missing or invalid input');
      return res.status(400).json({ error: 'Missing or invalid "input" field' });
    }

    const result = await parseDeckInput(input);
    console.log(`[API] POST /deck/parse - success: ${result.cards.length} cards parsed`);
    res.json(result);
  } catch (error) {
    console.error('[API] POST /deck/parse - error:', error.message);
    console.error('[API] Full error:', error);
    res.status(400).json({ error: error.message });
  }
});

/**
 * POST /api/deck/match
 * 
 * Accepts a list of card names and returns all available variants from inventory.
 * This is step 2: match parsed cards against what's in stock.
 */
router.post('/deck/match', async (req, res) => {
  try {
    const { cards } = req.body;
    console.log(`[API] POST /deck/match - cards: ${cards ? cards.length : 'null'}`);
    
    if (!cards || !Array.isArray(cards)) {
      console.log('[API] POST /deck/match - bad request: missing or invalid cards array');
      return res.status(400).json({ error: 'Missing or invalid "cards" array' });
    }

    // Extract just the card names for matching
    const cardNames = cards.map(c => c.name || c);
    console.log(`[API] POST /deck/match - matching ${cardNames.length} card names`);
    
    const results = await matchDeckList(cardNames);

    // Merge quantities back in
    const withQuantities = results.map((result, i) => ({
      ...result,
      quantity: cards[i].quantity || 1,
    }));

    console.log(`[API] POST /deck/match - success: returning ${withQuantities.length} results`);
    res.json({ results: withQuantities });
  } catch (error) {
    console.error('[API] POST /deck/match - error:', error.message);
    console.error('[API] Full error:', error);
    res.status(500).json({ error: 'Failed to match deck list against inventory' });
  }
});

/**
 * POST /api/deck/import
 * 
 * Combined endpoint: parse + match in one call.
 * Accepts a deck list (text or URL) and returns matched inventory results.
 */
router.post('/deck/import', async (req, res) => {
  try {
    const { input } = req.body;
    console.log(`[API] POST /deck/import - input length: ${input ? input.length : 'null'}`);
    
    if (!input || typeof input !== 'string') {
      console.log('[API] POST /deck/import - bad request: missing or invalid input');
      return res.status(400).json({ error: 'Missing or invalid "input" field' });
    }

    // Step 1: Parse
    console.log('[API] POST /deck/import - Step 1: Parsing...');
    const parsed = await parseDeckInput(input);
    console.log(`[API] POST /deck/import - Parsed ${parsed.cards.length} cards from "${parsed.deckName}"`);

    // Step 2: Match against inventory
    console.log('[API] POST /deck/import - Step 2: Matching against inventory...');
    const cardNames = parsed.cards.map(c => c.name);
    const matches = await matchDeckList(cardNames);

    // Merge quantities and board info
    const results = matches.map((match, i) => ({
      ...match,
      quantity: parsed.cards[i].quantity,
      board: parsed.cards[i].board || 'mainboard',
    }));

    const foundCount = results.filter(r => r.found).length;
    const totalCards = results.length;
    console.log(`[API] POST /deck/import - success: ${foundCount}/${totalCards} cards found in inventory`);

    res.json({
      deckName: parsed.deckName,
      format: parsed.format,
      results,
      parseErrors: parsed.errors,
    });
  } catch (error) {
    console.error('[API] POST /deck/import - error:', error.message);
    console.error('[API] Full error:', error);
    res.status(400).json({ error: error.message });
  }
});

/**
 * POST /api/deck/auto-select
 * 
 * Given a list of card names, auto-select variants based on strategy.
 * Strategies: "cheapest" or "best-condition"
 */
router.post('/deck/auto-select', async (req, res) => {
  try {
    const { cards, strategy } = req.body;
    console.log(`[API] POST /deck/auto-select - cards: ${cards ? cards.length : 'null'}, strategy: ${strategy}`);
    
    if (!cards || !Array.isArray(cards)) {
      console.log('[API] POST /deck/auto-select - bad request: missing or invalid cards array');
      return res.status(400).json({ error: 'Missing or invalid "cards" array' });
    }

    const cardNames = cards.map(c => c.name || c);
    let results;

    if (strategy === 'best-condition') {
      results = await getBestConditionForEach(cardNames);
    } else {
      // Default to cheapest
      results = await getCheapestForEach(cardNames);
    }

    const withQuantities = results.map((result, i) => ({
      ...result,
      quantity: cards[i].quantity || 1,
    }));

    console.log(`[API] POST /deck/auto-select - success: ${withQuantities.length} results`);
    res.json({ results: withQuantities, strategy: strategy || 'cheapest' });
  } catch (error) {
    console.error('[API] POST /deck/auto-select - error:', error.message);
    console.error('[API] Full error:', error);
    res.status(500).json({ error: 'Failed to auto-select variants' });
  }
});

/**
 * GET /api/search?q=card+name
 * 
 * Search for cards by partial name match (for autocomplete).
 */
router.get('/search', async (req, res) => {
  try {
    const { q } = req.query;
    console.log(`[API] GET /search - query: "${q}"`);
    
    if (!q || q.length < 2) {
      console.log('[API] GET /search - bad request: query too short');
      return res.status(400).json({ error: 'Search query must be at least 2 characters' });
    }

    const results = await searchCards(q);
    console.log(`[API] GET /search - success: ${results.length} results for "${q}"`);
    res.json({ results });
  } catch (error) {
    console.error('[API] GET /search - error:', error.message);
    console.error('[API] Full error:', error);
    res.status(500).json({ error: 'Search failed' });
  }
});

/**
 * GET /api/sync/status
 * 
 * Get the status of the most recent inventory sync.
 */
router.get('/sync/status', async (req, res) => {
  try {
    console.log('[API] GET /sync/status');
    
    const result = await pool.query(
      'SELECT * FROM sync_log ORDER BY started_at DESC LIMIT 1'
    );
    
    if (result.rows.length === 0) {
      console.log('[API] GET /sync/status - no syncs yet');
      return res.json({ status: 'never_synced' });
    }

    const stats = await pool.query(
      'SELECT COUNT(DISTINCT shopify_product_id) as product_count, COUNT(*) as variant_count, SUM(quantity) as total_stock FROM variants WHERE quantity > 0'
    );

    console.log(`[API] GET /sync/status - last sync: ${result.rows[0].status}, products: ${stats.rows[0].product_count}, variants: ${stats.rows[0].variant_count}`);
    
    res.json({
      lastSync: result.rows[0],
      inventory: stats.rows[0],
    });
  } catch (error) {
    console.error('[API] GET /sync/status - error:', error.message);
    console.error('[API] Full error:', error);
    res.status(500).json({ error: 'Failed to get sync status' });
  }
});

/**
 * POST /api/sync/trigger
 * 
 * Manually trigger an inventory sync (for admin use).
 * In production, you'd want to protect this with authentication.
 */
router.post('/sync/trigger', async (req, res) => {
  try {
    console.log('[API] POST /sync/trigger - starting manual sync');
    // Don't await - let it run in the background
    syncInventory().catch(err => {
      console.error('[API] Background sync failed:', err.message);
      console.error('[API] Full error:', err);
    });
    res.json({ message: 'Sync started' });
  } catch (error) {
    console.error('[API] POST /sync/trigger - error:', error.message);
    console.error('[API] Full error:', error);
    res.status(500).json({ error: 'Failed to trigger sync' });
  }
});

/**
 * GET /api/health
 * 
 * Health check endpoint for Railway.
 */
router.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    console.log('[API] GET /health - healthy');
    res.json({ status: 'healthy', timestamp: new Date().toISOString() });
  } catch (error) {
    console.error('[API] GET /health - unhealthy:', error.message);
    res.status(500).json({ status: 'unhealthy', error: error.message });
  }
});

module.exports = router;
