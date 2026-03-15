const express = require('express');
const { pool } = require('../config/database');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

const SHOPIFY_API_KEY = process.env.SHOPIFY_API_KEY;
const SHOPIFY_API_SECRET = process.env.SHOPIFY_API_SECRET;

/**
 * Get products - tries Shopify API first, falls back to local DB
 */
router.get('/', authMiddleware, async (req, res) => {
  try {
    const { shopId, shop, accessToken } = req.shopify;
    
    // If we have a real access token, try Shopify API
    if (accessToken && accessToken !== 'embedded' && accessToken.startsWith('shp')) {
      try {
        const shopifyProducts = await fetchShopifyProducts(shop, accessToken);
        
        // Save to our DB
        for (const p of shopifyProducts) {
          await pool.query(`
            INSERT INTO products (shop_id, shopify_product_id, title, description, price, compare_at_price, image_url, category)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            ON CONFLICT (shop_id, shopify_product_id) 
            DO UPDATE SET title = $3, description = $4, price = $5, compare_at_price = $6, image_url = $7, updated_at = NOW()
          `, [shopId, p.id, p.title, p.description, p.price, p.compare_at_price, p.image_url, p.category]);
        }
      } catch (e) {
        console.log('Shopify API error, using local DB:', e.message);
      }
    }
    
    // Get from our database (includes Shopify synced + manually added)
    const result = await pool.query(`
      SELECT p.*, COUNT(a.id)::int as angles_discovered
      FROM products p
      LEFT JOIN angles a ON a.product_id = p.id
      WHERE p.shop_id = $1
      GROUP BY p.id
      ORDER BY p.created_at DESC
    `, [shopId]);

    res.json({ 
      products: result.rows,
      message: result.rows.length === 0 ? 'Add your first product to get started' : null
    });

  } catch (error) {
    console.error('Get products error:', error);
    res.status(500).json({ error: 'Failed to fetch products' });
  }
});

/**
 * Fetch products from Shopify API
 */
async function fetchShopifyProducts(shop, accessToken) {
  const response = await fetch(`https://${shop}/admin/api/2024-01/products.json?limit=50`, {
    headers: {
      'X-Shopify-Access-Token': accessToken,
      'Content-Type': 'application/json',
    },
  });
  
  if (!response.ok) {
    throw new Error(`Shopify API error: ${response.status}`);
  }
  
  const data = await response.json();
  
  return data.products.map(p => ({
    id: p.id.toString(),
    title: p.title,
    description: p.body_html ? p.body_html.replace(/<[^>]*>/g, '') : '',
    price: p.variants[0]?.price || 0,
    compare_at_price: p.variants[0]?.compare_at_price || null,
    image_url: p.image?.src || p.images?.[0]?.src || null,
    category: p.product_type || null,
  }));
}

/**
 * Add product manually
 */
router.post('/', authMiddleware, async (req, res) => {
  try {
    const { shopId } = req.shopify;
    const { title, description, price, compare_at_price, image_url, category } = req.body;

    if (!title) {
      return res.status(400).json({ error: 'Product title is required' });
    }

    const result = await pool.query(`
      INSERT INTO products (shop_id, shopify_product_id, title, description, price, compare_at_price, image_url, category)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `, [shopId, `manual_${Date.now()}`, title, description, price || 0, compare_at_price, image_url, category]);

    res.json({ product: result.rows[0] });

  } catch (error) {
    console.error('Add product error:', error);
    res.status(500).json({ error: 'Failed to add product' });
  }
});

/**
 * Get single product with angles
 */
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const { shopId } = req.shopify;
    const { id } = req.params;

    const productResult = await pool.query(
      'SELECT * FROM products WHERE (id::text = $1 OR shopify_product_id = $1) AND shop_id = $2',
      [id, shopId]
    );

    if (productResult.rows.length === 0) {
      return res.status(404).json({ error: 'Product not found' });
    }

    const product = productResult.rows[0];

    const anglesResult = await pool.query(
      'SELECT * FROM angles WHERE product_id = $1 ORDER BY created_at DESC',
      [product.id]
    );

    res.json({ 
      product,
      angles: anglesResult.rows
    });

  } catch (error) {
    console.error('Get product error:', error);
    res.status(500).json({ error: 'Failed to fetch product' });
  }
});

/**
 * Sync products from Shopify (manual trigger)
 */
router.post('/sync', authMiddleware, async (req, res) => {
  try {
    const { shopId, shop, accessToken } = req.shopify;
    
    if (!accessToken || accessToken === 'embedded') {
      return res.status(400).json({ error: 'No Shopify access token. Please reconnect the app.' });
    }
    
    const products = await fetchShopifyProducts(shop, accessToken);
    
    for (const p of products) {
      await pool.query(`
        INSERT INTO products (shop_id, shopify_product_id, title, description, price, compare_at_price, image_url, category)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (shop_id, shopify_product_id) 
        DO UPDATE SET title = $3, description = $4, price = $5, compare_at_price = $6, image_url = $7, updated_at = NOW()
      `, [shopId, p.id, p.title, p.description, p.price, p.compare_at_price, p.image_url, p.category]);
    }
    
    res.json({ success: true, synced: products.length });
    
  } catch (error) {
    console.error('Sync error:', error);
    res.status(500).json({ error: 'Failed to sync products' });
  }
});

module.exports = router;
