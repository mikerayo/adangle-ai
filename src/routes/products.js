const express = require('express');
const { pool } = require('../config/database');
const shopifyService = require('../services/shopify');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

/**
 * Get all products from connected shop
 * GET /api/products
 */
router.get('/', authMiddleware, async (req, res) => {
  try {
    const { shop, accessToken, shopId } = req.shopify;

    // Fetch from Shopify
    const products = await shopifyService.getProducts(shop, accessToken);

    // Return with any existing analysis data
    const productIds = products.map(p => p.shopify_product_id);
    
    const existingData = await pool.query(`
      SELECT p.shopify_product_id, COUNT(a.id) as angle_count
      FROM products p
      LEFT JOIN angles a ON a.product_id = p.id
      WHERE p.shop_id = $1 AND p.shopify_product_id = ANY($2)
      GROUP BY p.shopify_product_id
    `, [shopId, productIds]);

    const analysisMap = {};
    existingData.rows.forEach(row => {
      analysisMap[row.shopify_product_id] = parseInt(row.angle_count);
    });

    const enrichedProducts = products.map(product => ({
      ...product,
      angles_discovered: analysisMap[product.shopify_product_id] || 0,
    }));

    res.json({ products: enrichedProducts });

  } catch (error) {
    console.error('Get products error:', error);
    res.status(500).json({ error: 'Failed to fetch products' });
  }
});

/**
 * Get single product with angles
 * GET /api/products/:id
 */
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const { shop, accessToken, shopId } = req.shopify;
    const { id } = req.params;

    // Fetch from Shopify
    const product = await shopifyService.getProduct(shop, accessToken, id);

    // Get any existing angles
    const anglesResult = await pool.query(`
      SELECT a.* FROM angles a
      JOIN products p ON a.product_id = p.id
      WHERE p.shop_id = $1 AND p.shopify_product_id = $2
      ORDER BY a.created_at DESC
    `, [shopId, id]);

    res.json({
      product,
      angles: anglesResult.rows,
    });

  } catch (error) {
    console.error('Get product error:', error);
    res.status(500).json({ error: 'Failed to fetch product' });
  }
});

module.exports = router;
