/**
 * Database Configuration - PostgreSQL with Connection Pooling
 * Optimized for high-scale: 50,000+ concurrent users
 */

const { Pool } = require('pg');

// Connection pool configuration
// For $5M MRR scale, use PgBouncer in front of this
const poolConfig = {
  connectionString: process.env.DATABASE_URL,
  
  // Pool sizing for scale
  // Rule: (cores * 2) + spindle_count per node
  // For serverless: keep modest, let PgBouncer handle overflow
  max: parseInt(process.env.DB_POOL_MAX) || 20,
  min: parseInt(process.env.DB_POOL_MIN) || 5,
  
  // Connection lifecycle
  idleTimeoutMillis: 30000,          // Close idle connections after 30s
  connectionTimeoutMillis: 10000,     // Fail if can't connect in 10s
  
  // SSL for production (Railway, Supabase, etc.)
  ssl: process.env.NODE_ENV === 'production' 
    ? { rejectUnauthorized: false } 
    : false,
    
  // Statement timeout to prevent runaway queries
  statement_timeout: 30000, // 30 seconds max query time
  
  // Application name for monitoring
  application_name: 'adangle-ai',
};

const pool = new Pool(poolConfig);

// Connection event handlers
pool.on('connect', (client) => {
  // Set session-level config for each connection
  client.query('SET timezone = \'UTC\'');
});

pool.on('error', (err, client) => {
  console.error('Unexpected PostgreSQL error:', err);
});

pool.on('remove', () => {
  // Connection removed from pool
});

/**
 * Initialize database schema
 * Includes indexes for performance at scale
 */
async function initDB() {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    // Shops table
    await client.query(`
      CREATE TABLE IF NOT EXISTS shops (
        id SERIAL PRIMARY KEY,
        shopify_domain VARCHAR(255) UNIQUE NOT NULL,
        access_token TEXT NOT NULL,
        plan VARCHAR(50) DEFAULT 'free',
        plan_expires_at TIMESTAMPTZ,
        email VARCHAR(255),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // Products table
    await client.query(`
      CREATE TABLE IF NOT EXISTS products (
        id SERIAL PRIMARY KEY,
        shop_id INTEGER REFERENCES shops(id) ON DELETE CASCADE,
        shopify_product_id VARCHAR(50) NOT NULL,
        title VARCHAR(500) NOT NULL,
        description TEXT,
        price DECIMAL(10,2),
        compare_at_price DECIMAL(10,2),
        image_url TEXT,
        category VARCHAR(255),
        tags TEXT,
        data JSONB,
        angles_discovered INTEGER DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(shop_id, shopify_product_id)
      )
    `);

    // Angles table
    await client.query(`
      CREATE TABLE IF NOT EXISTS angles (
        id SERIAL PRIMARY KEY,
        shop_id INTEGER REFERENCES shops(id) ON DELETE CASCADE,
        product_id INTEGER REFERENCES products(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL,
        audience VARCHAR(500),
        pain_point TEXT,
        hook TEXT,
        objection TEXT,
        emotion VARCHAR(100),
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // Copies table
    await client.query(`
      CREATE TABLE IF NOT EXISTS copies (
        id SERIAL PRIMARY KEY,
        angle_id INTEGER REFERENCES angles(id) ON DELETE CASCADE,
        content TEXT NOT NULL,
        style VARCHAR(100),
        model_used VARCHAR(100),
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // Usage tracking (for billing/limits)
    await client.query(`
      CREATE TABLE IF NOT EXISTS usage (
        id SERIAL PRIMARY KEY,
        shop_id INTEGER REFERENCES shops(id) ON DELETE CASCADE,
        month VARCHAR(7) NOT NULL,
        angles_discovered INTEGER DEFAULT 0,
        copies_generated INTEGER DEFAULT 0,
        UNIQUE(shop_id, month)
      )
    `);

    // Jobs table for async tracking
    await client.query(`
      CREATE TABLE IF NOT EXISTS jobs (
        id SERIAL PRIMARY KEY,
        shop_id INTEGER REFERENCES shops(id) ON DELETE CASCADE,
        job_type VARCHAR(50) NOT NULL,
        job_id VARCHAR(255) NOT NULL,
        status VARCHAR(50) DEFAULT 'pending',
        result JSONB,
        error TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        completed_at TIMESTAMPTZ
      )
    `);

    // ========================================
    // INDEXES FOR SCALE
    // ========================================

    // Shops
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_shops_domain ON shops(shopify_domain)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_shops_plan ON shops(plan)
    `);

    // Products - for fast lookups
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_products_shop ON products(shop_id)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_products_shopify_id ON products(shop_id, shopify_product_id)
    `);

    // Angles - for product angle lookups
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_angles_product ON angles(product_id)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_angles_shop ON angles(shop_id)
    `);

    // Copies - for angle copy lookups
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_copies_angle ON copies(angle_id)
    `);

    // Usage - for billing queries
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_usage_shop_month ON usage(shop_id, month)
    `);

    // Jobs - for status checks
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_jobs_shop ON jobs(shop_id)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status) WHERE status != 'completed'
    `);

    // ========================================
    // PARTITIONING HINT (for $5M+ scale)
    // ========================================
    // When you hit millions of rows in copies/angles:
    // 1. Partition by shop_id range or hash
    // 2. Or partition usage by month for time-series queries
    // 
    // Example:
    // CREATE TABLE copies_partitioned (...) PARTITION BY HASH (angle_id);
    // CREATE TABLE copies_p0 PARTITION OF copies_partitioned FOR VALUES WITH (MODULUS 4, REMAINDER 0);

    await client.query('COMMIT');
    
    console.log('✅ Database schema initialized with indexes');
    
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Database initialization error:', error);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Health check query
 */
async function healthCheck() {
  const result = await pool.query('SELECT NOW() as time, pg_database_size(current_database()) as db_size');
  return {
    connected: true,
    time: result.rows[0].time,
    dbSize: result.rows[0].db_size,
    poolTotal: pool.totalCount,
    poolIdle: pool.idleCount,
    poolWaiting: pool.waitingCount,
  };
}

/**
 * Graceful shutdown
 */
async function closePool() {
  await pool.end();
  console.log('PostgreSQL pool closed');
}

module.exports = { 
  pool, 
  initDB, 
  healthCheck, 
  closePool 
};
