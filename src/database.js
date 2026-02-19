const { Pool } = require('pg');

console.log('[DB] Creating connection pool...');
console.log(`[DB] DATABASE_URL: ${process.env.DATABASE_URL ? '***SET*** (length: ' + process.env.DATABASE_URL.length + ')' : 'NOT SET'}`);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

pool.on('error', (err) => {
  console.error('[DB] Unexpected pool error:', err.message);
});

pool.on('connect', () => {
  console.log('[DB] New client connected to pool');
});

async function initializeDatabase() {
  console.log('[DB] Attempting to connect and initialize tables...');
  const client = await pool.connect();
  console.log('[DB] Connected to database successfully');
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS products (
        id SERIAL PRIMARY KEY,
        shopify_product_id BIGINT UNIQUE NOT NULL,
        title TEXT NOT NULL,
        card_name TEXT NOT NULL,
        set_name TEXT,
        handle TEXT,
        image_url TEXT,
        product_url TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS variants (
        id SERIAL PRIMARY KEY,
        shopify_variant_id BIGINT UNIQUE NOT NULL,
        shopify_product_id BIGINT NOT NULL REFERENCES products(shopify_product_id) ON DELETE CASCADE,
        condition TEXT,
        finish TEXT,
        price DECIMAL(10, 2),
        quantity INTEGER DEFAULT 0,
        sku TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS sync_log (
        id SERIAL PRIMARY KEY,
        started_at TIMESTAMP DEFAULT NOW(),
        finished_at TIMESTAMP,
        products_synced INTEGER DEFAULT 0,
        variants_synced INTEGER DEFAULT 0,
        status TEXT DEFAULT 'running',
        error_message TEXT
      );

      -- Indexes for fast lookups
      CREATE INDEX IF NOT EXISTS idx_products_card_name ON products(card_name);
      CREATE INDEX IF NOT EXISTS idx_products_card_name_lower ON products(LOWER(card_name));
      CREATE INDEX IF NOT EXISTS idx_products_set_name ON products(set_name);
      CREATE INDEX IF NOT EXISTS idx_variants_product_id ON variants(shopify_product_id);
      CREATE INDEX IF NOT EXISTS idx_variants_quantity ON variants(quantity);
    `);
    console.log('[DB] Database tables initialized successfully');
  } catch (error) {
    console.error('[DB] Error initializing database:', error.message);
    console.error('[DB] Full error:', error);
    throw error;
  } finally {
    client.release();
  }
}

module.exports = { pool, initializeDatabase };
