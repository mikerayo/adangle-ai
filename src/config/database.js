/**
 * Database Configuration - PostgreSQL
 */

const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 30000,
});

pool.on('error', (err) => {
  console.error('PostgreSQL error:', err);
});

async function initDB() {
  let client;
  let retries = 5;
  
  while (retries > 0) {
    try {
      client = await pool.connect();
      break;
    } catch (err) {
      retries--;
      console.log(`DB connection failed, retrying... (${retries} left)`);
      await new Promise(r => setTimeout(r, 5000));
    }
  }
  
  if (!client) {
    throw new Error('Could not connect to database after retries');
  }
  
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS shops (
        id SERIAL PRIMARY KEY,
        shopify_domain VARCHAR(255) UNIQUE NOT NULL,
        access_token TEXT NOT NULL,
        plan VARCHAR(50) DEFAULT 'free',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

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
        UNIQUE(shop_id, shopify_product_id)
      )
    `);

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
    
    console.log('✅ Database schema ready');
  } finally {
    client.release();
  }
}

async function healthCheck() {
  try {
    const result = await pool.query('SELECT NOW()');
    return { connected: true, time: result.rows[0].now };
  } catch (e) {
    return { connected: false, error: e.message };
  }
}

async function closePool() {
  await pool.end();
}

module.exports = { pool, initDB, healthCheck, closePool };
