/**
 * Inventory Sync Service
 * 
 * Pulls all Magic: The Gathering products from Shopify using the Admin API
 * and syncs them into our PostgreSQL database for fast deck-matching queries.
 * 
 * Product title format from CardCatalyst: "Card Name (Set Name)"
 * URL handle format: "card-name-set-name-tcg-{tcgplayer_id}"
 */

const { pool } = require('../database');
const { shopifyGraphQL } = require('./shopify-auth');

/**
 * Parse card name and set name from product title
 * Example: "Fell the Profane (Modern Horizons 3)" -> { cardName: "Fell the Profane", setName: "Modern Horizons 3" }
 */
function parseProductTitle(title) {
  const match = title.match(/^(.+?)\s*\(([^)]+)\)\s*$/);
  if (match) {
    return {
      cardName: match[1].trim(),
      setName: match[2].trim(),
    };
  }
  // Fallback: use full title as card name
  console.warn(`[SYNC] Could not parse title: "${title}" - using full title as card name`);
  return {
    cardName: title.trim(),
    setName: null,
  };
}

/**
 * Parse condition and finish from variant options
 * CardCatalyst uses two option axes: Condition (NM, LP, MP, HP, DMG) and Finish (Regular, Foil)
 */
function parseVariantOptions(variant) {
  let condition = null;
  let finish = null;

  // variant.selectedOptions is an array of { name, value } objects
  if (variant.selectedOptions) {
    for (const option of variant.selectedOptions) {
      const name = option.name.toLowerCase();
      const value = option.value;
      
      if (name === 'condition' || name === 'conditions') {
        condition = value;
      } else if (name === 'finish' || name === 'style' || name === 'type') {
        finish = value;
      }
    }
  }

  return { condition, finish };
}

/**
 * Fetch all products from Shopify using GraphQL pagination
 */
async function fetchAllProducts() {
  const allProducts = [];
  let hasNextPage = true;
  let cursor = null;
  let pageCount = 0;

  console.log('[SYNC] Starting to fetch all products from Shopify...');

  const query = `
    query GetProducts($cursor: String) {
      products(first: 250, after: $cursor) {
        pageInfo {
          hasNextPage
          endCursor
        }
        edges {
          node {
            id
            title
            handle
            featuredImage {
              url
            }
            variants(first: 100) {
              edges {
                node {
                  id
                  title
                  price
                  inventoryQuantity
                  sku
                  selectedOptions {
                    name
                    value
                  }
                }
              }
            }
          }
        }
      }
    }
  `;

  while (hasNextPage) {
    pageCount++;
    console.log(`[SYNC] Fetching page ${pageCount}${cursor ? ` (cursor: ${cursor.substring(0, 20)}...)` : ' (first page)'}...`);
    
    const data = await shopifyGraphQL(query, { cursor });
    const products = data.data.products;
    
    const pageProductCount = products.edges.length;
    for (const edge of products.edges) {
      allProducts.push(edge.node);
    }

    console.log(`[SYNC] Page ${pageCount}: received ${pageProductCount} products (total so far: ${allProducts.length})`);

    hasNextPage = products.pageInfo.hasNextPage;
    cursor = products.pageInfo.endCursor;

    // Small delay to respect rate limits
    if (hasNextPage) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }

  console.log(`[SYNC] Fetched ${allProducts.length} products in ${pageCount} pages`);
  return allProducts;
}

/**
 * Extract numeric Shopify ID from GraphQL global ID
 * "gid://shopify/Product/123456" -> 123456
 */
function extractNumericId(gid) {
  const match = gid.match(/\/(\d+)$/);
  return match ? parseInt(match[1], 10) : null;
}

/**
 * Main sync function - pulls from Shopify and upserts into PostgreSQL
 */
async function syncInventory() {
  const client = await pool.connect();
  
  // Create sync log entry
  const logResult = await client.query(
    'INSERT INTO sync_log (status) VALUES ($1) RETURNING id',
    ['running']
  );
  const syncLogId = logResult.rows[0].id;
  
  let productCount = 0;
  let variantCount = 0;

  try {
    console.log('[SYNC] ====== Starting inventory sync ======');
    const startTime = Date.now();
    
    const products = await fetchAllProducts();
    console.log(`[SYNC] Fetched ${products.length} total products from Shopify`);

    // Use a transaction for the database writes
    await client.query('BEGIN');
    console.log('[SYNC] Database transaction started');

    for (const product of products) {
      const shopifyProductId = extractNumericId(product.id);
      if (!shopifyProductId) {
        console.warn(`[SYNC] Could not extract numeric ID from: ${product.id}`);
        continue;
      }

      const { cardName, setName } = parseProductTitle(product.title);
      const storeDomain = process.env.SHOPIFY_STORE_DOMAIN.replace('.myshopify.com', '');
      const productUrl = `https://${storeDomain}.com/products/${product.handle}`;
      const imageUrl = product.featuredImage?.url || null;

      if (productCount < 3) {
        console.log(`[SYNC] Sample product: "${product.title}" -> cardName="${cardName}", setName="${setName}", id=${shopifyProductId}`);
      }

      // Upsert product
      await client.query(`
        INSERT INTO products (shopify_product_id, title, card_name, set_name, handle, image_url, product_url, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
        ON CONFLICT (shopify_product_id) DO UPDATE SET
          title = EXCLUDED.title,
          card_name = EXCLUDED.card_name,
          set_name = EXCLUDED.set_name,
          handle = EXCLUDED.handle,
          image_url = EXCLUDED.image_url,
          product_url = EXCLUDED.product_url,
          updated_at = NOW()
      `, [shopifyProductId, product.title, cardName, setName, product.handle, imageUrl, productUrl]);

      productCount++;

      // Upsert variants
      for (const variantEdge of product.variants.edges) {
        const variant = variantEdge.node;
        const shopifyVariantId = extractNumericId(variant.id);
        if (!shopifyVariantId) continue;

        const { condition, finish } = parseVariantOptions(variant);

        await client.query(`
          INSERT INTO variants (shopify_variant_id, shopify_product_id, condition, finish, price, quantity, sku, updated_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
          ON CONFLICT (shopify_variant_id) DO UPDATE SET
            condition = EXCLUDED.condition,
            finish = EXCLUDED.finish,
            price = EXCLUDED.price,
            quantity = EXCLUDED.quantity,
            sku = EXCLUDED.sku,
            updated_at = NOW()
        `, [shopifyVariantId, shopifyProductId, condition, finish, variant.price, variant.inventoryQuantity, variant.sku]);

        variantCount++;
      }
    }

    // Remove products that no longer exist in Shopify
    const shopifyProductIds = products
      .map(p => extractNumericId(p.id))
      .filter(id => id !== null);
    
    if (shopifyProductIds.length > 0) {
      const deleteResult = await client.query(
        'DELETE FROM products WHERE shopify_product_id != ALL($1::bigint[])',
        [shopifyProductIds]
      );
      console.log(`[SYNC] Removed ${deleteResult.rowCount} stale products from database`);
    }

    await client.query('COMMIT');
    console.log('[SYNC] Database transaction committed');

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[SYNC] ====== Sync complete: ${productCount} products, ${variantCount} variants in ${elapsed}s ======`);

    // Update sync log
    await client.query(
      'UPDATE sync_log SET finished_at = NOW(), products_synced = $1, variants_synced = $2, status = $3 WHERE id = $4',
      [productCount, variantCount, 'completed', syncLogId]
    );

    return { productCount, variantCount, elapsed };

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('[SYNC] ====== Sync FAILED ======');
    console.error('[SYNC] Error message:', error.message);
    console.error('[SYNC] Full error:', error);
    console.error('[SYNC] Products synced before failure:', productCount);
    console.error('[SYNC] Variants synced before failure:', variantCount);

    // Update sync log with error
    await client.query(
      'UPDATE sync_log SET finished_at = NOW(), status = $1, error_message = $2 WHERE id = $3',
      ['failed', error.message, syncLogId]
    );

    throw error;
  } finally {
    client.release();
  }
}

module.exports = { syncInventory, parseProductTitle };
