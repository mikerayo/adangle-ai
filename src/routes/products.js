const express = require('express');
const { pool } = require('../config/database');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

/**
 * Get all products
 * For embedded apps without API access, returns demo/saved products
 * GET /api/products
 */
router.get('/', authMiddleware, async (req, res) => {
  try {
    const { shopId, shop } = req.shopify;

    // Get products from our database
    const result = await pool.query(`
      SELECT p.*, COUNT(a.id) as angles_discovered
      FROM products p
      LEFT JOIN angles a ON a.product_id = p.id
      WHERE p.shop_id = $1
      GROUP BY p.id
      ORDER BY p.created_at DESC
    `, [shopId]);

    if (result.rows.length === 0) {
      // No products yet - return empty with instructions
      return res.json({ 
        products: [],
        message: 'Add your first product to get started'
      });
    }

    res.json({ products: result.rows });

  } catch (error) {
    console.error('Get products error:', error);
    res.status(500).json({ error: 'Failed to fetch products' });
  }
});

/**
 * Add a product manually
 * POST /api/products
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
 * GET /api/products/:id
 */
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const { shopId } = req.shopify;
    const { id } = req.params;

    const productResult = await pool.query(
      'SELECT * FROM products WHERE (id = $1 OR shopify_product_id = $1) AND shop_id = $2',
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

module.exports = router;
