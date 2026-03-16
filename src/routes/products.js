const express = require('express');
const https = require('https');
const { pool } = require('../config/database');
const { authMiddleware } = require('../middleware/auth');

// Simple fetch using https with redirect following
function fetchJSON(urlString) {
  return new Promise((resolve, reject) => {
    const makeRequest = (url, redirectCount = 0) => {
      if (redirectCount > 5) return reject(new Error('Too many redirects'));
      
      const req = https.get(url, { 
        headers: { 
          'Accept': 'application/json',
          'User-Agent': 'Mozilla/5.0 (compatible; AdAngle/1.0)'
        }
      }, (res) => {
        // Follow redirects
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          let newUrl = res.headers.location;
          if (!newUrl.startsWith('http')) {
            const parsed = new URL(url);
            newUrl = `${parsed.protocol}//${parsed.host}${newUrl}`;
          }
          return makeRequest(newUrl, redirectCount + 1);
        }
        
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try {
              resolve(JSON.parse(data));
            } catch (e) {
              reject(new Error('Invalid JSON response'));
            }
          } else {
            reject(new Error(`HTTP ${res.statusCode}`));
          }
        });
      });
      
      req.on('error', reject);
      req.setTimeout(15000, () => {
        req.destroy();
        reject(new Error('Request timeout'));
      });
    };
    
    makeRequest(urlString);
  });
}

const router = express.Router();

const SHOPIFY_API_KEY = process.env.SHOPIFY_API_KEY;
const SHOPIFY_API_SECRET = process.env.SHOPIFY_API_SECRET;

/**
 * Get products - tries Shopify API first, falls back to local DB
 */
router.get('/', authMiddleware, async (req, res) => {
  try {
    const { shopId, shop } = req.shopify;
    
    // Check if we have products already
    const existingProducts = await pool.query(
      'SELECT COUNT(*) as count FROM products WHERE shop_id = $1',
      [shopId]
    );
    
    // Auto-sync from the user's own store if no products yet
    if (parseInt(existingProducts.rows[0].count) === 0 && shop) {
      console.log('No products found, auto-syncing from:', shop);
      try {
        // Try myshopify.com domain (public JSON endpoint)
        const jsonUrl = `https://${shop}/products.json?limit=250`;
        const data = await fetchJSON(jsonUrl);
        
        for (const p of (data.products || [])) {
          await pool.query(`
            INSERT INTO products (shop_id, shopify_product_id, title, description, price, compare_at_price, image_url, category)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            ON CONFLICT (shop_id, shopify_product_id) DO NOTHING
          `, [
            shopId,
            `${shop}_${p.id}`,
            p.title,
            p.body_html ? p.body_html.replace(/<[^>]*>/g, '').substring(0, 2000) : '',
            p.variants[0]?.price || 0,
            p.variants[0]?.compare_at_price || null,
            p.image?.src || p.images?.[0]?.src || null,
            p.product_type || null
          ]);
        }
        console.log('Auto-synced', data.products?.length, 'products');
      } catch (e) {
        console.log('Auto-sync failed:', e.message);
      }
    }
    
    // Get from our database
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
      message: result.rows.length === 0 ? 'No products found in your store' : null
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
 * Import ALL products from a store
 */
router.post('/import-store', authMiddleware, async (req, res) => {
  console.log('=== IMPORT STORE START ===');
  try {
    const { shopId } = req.shopify;
    let { store } = req.body;
    
    console.log('Import store request:', { shopId, store, body: req.body });
    
    if (!store) {
      return res.status(400).json({ error: 'Store domain is required' });
    }
    
    // Clean domain
    store = store.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    
    // Fetch all products (Shopify public endpoint, max 250)
    const jsonUrl = `https://${store}/products.json?limit=250`;
    console.log('Fetching all products from:', jsonUrl);
    
    let data;
    try {
      data = await fetchJSON(jsonUrl);
      console.log('Fetch success, products:', data.products?.length);
    } catch (fetchErr) {
      console.error('Fetch error:', fetchErr.message);
      return res.status(400).json({ error: 'Could not connect to store: ' + fetchErr.message });
    }
    
    const products = data.products || [];
    console.log('Products found:', products.length);
    
    if (products.length === 0) {
      return res.status(400).json({ error: 'No products found in this store' });
    }
    
    // Save all to database
    let count = 0;
    for (const p of products) {
      await pool.query(`
        INSERT INTO products (shop_id, shopify_product_id, title, description, price, compare_at_price, image_url, category)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (shop_id, shopify_product_id) 
        DO UPDATE SET title = $3, description = $4, price = $5, compare_at_price = $6, image_url = $7
      `, [
        shopId,
        `${store}_${p.id}`,
        p.title,
        p.body_html ? p.body_html.replace(/<[^>]*>/g, '').substring(0, 2000) : '',
        p.variants[0]?.price || 0,
        p.variants[0]?.compare_at_price || null,
        p.image?.src || p.images?.[0]?.src || null,
        p.product_type || null
      ]);
      count++;
    }
    
    res.json({ success: true, count });
    
  } catch (error) {
    console.error('Import store error:', error.message, error.stack);
    res.status(500).json({ error: 'Failed to import products: ' + error.message });
  }
});

/**
 * Import product from URL
 */
router.post('/import', authMiddleware, async (req, res) => {
  try {
    const { shopId } = req.shopify;
    const { url } = req.body;
    
    if (!url) {
      return res.status(400).json({ error: 'URL is required' });
    }
    
    // Parse the URL to get store and product handle
    // Formats: 
    // - https://store.myshopify.com/products/handle
    // - https://store.com/products/handle
    // - https://store.myshopify.com/products/handle?variant=123
    
    let productUrl;
    try {
      productUrl = new URL(url);
    } catch (e) {
      return res.status(400).json({ error: 'Invalid URL format' });
    }
    
    const pathParts = productUrl.pathname.split('/');
    const productsIndex = pathParts.indexOf('products');
    
    if (productsIndex === -1 || !pathParts[productsIndex + 1]) {
      return res.status(400).json({ error: 'URL must be a Shopify product page (e.g., /products/product-name)' });
    }
    
    const handle = pathParts[productsIndex + 1].split('?')[0];
    const storeHost = productUrl.hostname;
    
    // Fetch product JSON from Shopify (public endpoint)
    const jsonUrl = `https://${storeHost}/products/${handle}.json`;
    console.log('Fetching:', jsonUrl);
    
    let data;
    try {
      data = await fetchJSON(jsonUrl);
    } catch (fetchErr) {
      return res.status(400).json({ error: 'Could not fetch product: ' + fetchErr.message });
    }
    
    const p = data.product;
    
    if (!p) {
      return res.status(400).json({ error: 'Product not found' });
    }
    
    // Save to database
    const result = await pool.query(`
      INSERT INTO products (shop_id, shopify_product_id, title, description, price, compare_at_price, image_url, category)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (shop_id, shopify_product_id) 
      DO UPDATE SET title = $3, description = $4, price = $5, compare_at_price = $6, image_url = $7
      RETURNING *
    `, [
      shopId,
      `imported_${p.id}`,
      p.title,
      p.body_html ? p.body_html.replace(/<[^>]*>/g, '').substring(0, 2000) : '',
      p.variants[0]?.price || 0,
      p.variants[0]?.compare_at_price || null,
      p.image?.src || p.images?.[0]?.src || null,
      p.product_type || null
    ]);
    
    res.json({ success: true, product: result.rows[0] });
    
  } catch (error) {
    console.error('Import error:', error);
    res.status(500).json({ error: 'Failed to import product' });
  }
});

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
        DO UPDATE SET title = $3, description = $4, price = $5, compare_at_price = $6, image_url = $7
      `, [shopId, p.id, p.title, p.description, p.price, p.compare_at_price, p.image_url, p.category]);
    }
    
    res.json({ success: true, synced: products.length });
    
  } catch (error) {
    console.error('Sync error:', error);
    res.status(500).json({ error: 'Failed to sync products' });
  }
});

module.exports = router;
