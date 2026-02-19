/**
 * Deck Matching Service
 * 
 * Takes a list of card names (from a deck list) and queries the local database
 * to find all available variants across all printings in inventory.
 */

const { pool } = require('../database');

/**
 * Find all in-stock variants for a list of card names
 * Returns grouped results: each card name maps to all available printings/variants
 */
async function matchDeckList(cardNames) {
  if (!cardNames || cardNames.length === 0) {
    console.log('[MATCHER] No card names provided, returning empty');
    return [];
  }

  console.log(`[MATCHER] Matching ${cardNames.length} cards against inventory...`);
  console.log(`[MATCHER] First few cards: ${cardNames.slice(0, 5).join(', ')}${cardNames.length > 5 ? '...' : ''}`);

  // Normalize card names for matching (lowercase, trim whitespace)
  const normalizedNames = cardNames.map(name => name.trim().toLowerCase());

  const query = `
    SELECT 
      p.card_name,
      p.set_name,
      p.title,
      p.image_url,
      p.product_url,
      p.handle,
      v.shopify_variant_id,
      v.condition,
      v.finish,
      v.price,
      v.quantity,
      v.sku
    FROM products p
    JOIN variants v ON p.shopify_product_id = v.shopify_product_id
    WHERE LOWER(p.card_name) = ANY($1::text[])
      AND v.quantity > 0
    ORDER BY p.card_name, v.price ASC, 
      CASE v.condition
        WHEN 'Near Mint' THEN 1
        WHEN 'Lightly Played' THEN 2
        WHEN 'Moderately Played' THEN 3
        WHEN 'Heavily Played' THEN 4
        WHEN 'Damaged' THEN 5
        ELSE 6
      END
  `;

  const result = await pool.query(query, [normalizedNames]);
  console.log(`[MATCHER] Database returned ${result.rows.length} matching variants`);

  // Group results by card name
  const grouped = {};
  for (const row of result.rows) {
    const key = row.card_name.toLowerCase();
    if (!grouped[key]) {
      grouped[key] = {
        cardName: row.card_name,
        printings: [],
      };
    }

    grouped[key].printings.push({
      setName: row.set_name,
      title: row.title,
      imageUrl: row.image_url,
      productUrl: row.product_url,
      handle: row.handle,
      variantId: row.shopify_variant_id.toString(),
      condition: row.condition,
      finish: row.finish,
      price: parseFloat(row.price),
      quantity: row.quantity,
      sku: row.sku,
    });
  }

  // Map back to original card names to preserve casing and find missing cards
  const results = cardNames.map(name => {
    const key = name.trim().toLowerCase();
    if (grouped[key]) {
      return {
        requested: name.trim(),
        found: true,
        ...grouped[key],
      };
    }
    return {
      requested: name.trim(),
      found: false,
      cardName: name.trim(),
      printings: [],
    };
  });

  const foundCount = results.filter(r => r.found).length;
  const missingCount = results.filter(r => !r.found).length;
  console.log(`[MATCHER] Results: ${foundCount} found, ${missingCount} not in stock`);
  
  if (missingCount > 0) {
    const missingCards = results.filter(r => !r.found).map(r => r.requested);
    console.log(`[MATCHER] Missing cards: ${missingCards.join(', ')}`);
  }

  return results;
}

/**
 * Get the cheapest variant for each card (any condition, any printing)
 */
async function getCheapestForEach(cardNames) {
  console.log(`[MATCHER] Auto-selecting cheapest for ${cardNames.length} cards`);
  const allMatches = await matchDeckList(cardNames);
  
  return allMatches.map(card => {
    if (!card.found || card.printings.length === 0) {
      return { ...card, selected: null };
    }
    // Printings are already sorted by price ASC
    console.log(`[MATCHER] Cheapest for "${card.cardName}": $${card.printings[0].price} (${card.printings[0].condition}, ${card.printings[0].setName})`);
    return { ...card, selected: card.printings[0] };
  });
}

/**
 * Get the best condition variant for each card (prioritize NM, then LP, etc.)
 */
async function getBestConditionForEach(cardNames) {
  console.log(`[MATCHER] Auto-selecting best condition for ${cardNames.length} cards`);
  const allMatches = await matchDeckList(cardNames);
  
  return allMatches.map(card => {
    if (!card.found || card.printings.length === 0) {
      return { ...card, selected: null };
    }
    
    const conditionOrder = ['Near Mint', 'Lightly Played', 'Moderately Played', 'Heavily Played', 'Damaged'];
    
    // Sort by condition quality first, then price
    const sorted = [...card.printings].sort((a, b) => {
      const condA = conditionOrder.indexOf(a.condition);
      const condB = conditionOrder.indexOf(b.condition);
      if (condA !== condB) return condA - condB;
      return a.price - b.price;
    });

    console.log(`[MATCHER] Best condition for "${card.cardName}": ${sorted[0].condition} @ $${sorted[0].price} (${sorted[0].setName})`);
    return { ...card, selected: sorted[0] };
  });
}

/**
 * Search for cards by partial name match (for autocomplete/search)
 */
async function searchCards(searchTerm, limit = 20) {
  console.log(`[MATCHER] Searching for cards matching: "${searchTerm}" (limit: ${limit})`);
  
  const query = `
    SELECT DISTINCT p.card_name, p.set_name, p.image_url,
      MIN(v.price) as min_price,
      SUM(v.quantity) as total_quantity
    FROM products p
    JOIN variants v ON p.shopify_product_id = v.shopify_product_id
    WHERE LOWER(p.card_name) LIKE $1
      AND v.quantity > 0
    GROUP BY p.card_name, p.set_name, p.image_url
    ORDER BY p.card_name
    LIMIT $2
  `;

  const result = await pool.query(query, [`%${searchTerm.toLowerCase()}%`, limit]);
  console.log(`[MATCHER] Search returned ${result.rows.length} results`);
  return result.rows;
}

module.exports = { matchDeckList, getCheapestForEach, getBestConditionForEach, searchCards };
