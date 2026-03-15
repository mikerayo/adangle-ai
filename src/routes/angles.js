const express = require('express');
const { pool } = require('../config/database');
const shopifyService = require('../services/shopify');
const aiService = require('../services/openrouter');
const { authMiddleware, checkUsage } = require('../middleware/auth');

const router = express.Router();

/**
 * Discover angles for a product
 * POST /api/angles/discover
 */
router.post('/discover', authMiddleware, checkUsage('angles'), async (req, res) => {
  try {
    const { shop, accessToken, shopId } = req.shopify;
    const { productId } = req.body;

    if (!productId) {
      return res.status(400).json({ error: 'Product ID required' });
    }

    // Fetch product from Shopify
    const product = await shopifyService.getProduct(shop, accessToken, productId);

    // Save product to DB if not exists
    const productResult = await pool.query(`
      INSERT INTO products (shop_id, shopify_product_id, title, description, price, compare_at_price, image_url, category, data)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (shop_id, shopify_product_id) 
      DO UPDATE SET title = $3, description = $4, price = $5, compare_at_price = $6, image_url = $7
      RETURNING id
    `, [
      shopId,
      productId,
      product.title,
      product.description,
      product.price,
      product.compare_at_price,
      product.image_url,
      product.category,
      JSON.stringify(product.data)
    ]);

    const dbProductId = productResult.rows[0].id;

    // Discover angles using AI
    console.log(`Discovering angles for: ${product.title}`);
    const { angles } = await aiService.discoverAngles(product);

    if (!angles || angles.length === 0) {
      return res.status(500).json({ error: 'Failed to discover angles' });
    }

    // Save angles to DB
    const savedAngles = [];
    for (const angle of angles) {
      const result = await pool.query(`
        INSERT INTO angles (product_id, name, audience, pain_point, hook, objection, emotion, target_demo)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING *
      `, [
        dbProductId,
        angle.name,
        angle.audience,
        angle.pain_point,
        angle.hook,
        angle.objection,
        angle.emotion,
        angle.target_demo
      ]);
      savedAngles.push(result.rows[0]);
    }

    // Update usage
    const month = new Date().toISOString().slice(0, 7);
    await pool.query(`
      INSERT INTO usage (shop_id, month, angles_discovered)
      VALUES ($1, $2, 1)
      ON CONFLICT (shop_id, month)
      DO UPDATE SET angles_discovered = usage.angles_discovered + 1
    `, [shopId, month]);

    res.json({
      success: true,
      product: {
        id: dbProductId,
        title: product.title,
        image_url: product.image_url,
      },
      angles: savedAngles,
    });

  } catch (error) {
    console.error('Discover angles error:', error);
    res.status(500).json({ error: 'Failed to discover angles' });
  }
});

/**
 * Get angles for a product
 * GET /api/angles/:productId
 */
router.get('/:productId', authMiddleware, async (req, res) => {
  try {
    const { shopId } = req.shopify;
    const { productId } = req.params;

    const result = await pool.query(`
      SELECT a.* FROM angles a
      JOIN products p ON a.product_id = p.id
      WHERE p.shop_id = $1 AND p.shopify_product_id = $2
      ORDER BY a.created_at DESC
    `, [shopId, productId]);

    res.json({ angles: result.rows });

  } catch (error) {
    console.error('Get angles error:', error);
    res.status(500).json({ error: 'Failed to get angles' });
  }
});

/**
 * Toggle favorite angle
 * POST /api/angles/:id/favorite
 */
router.post('/:id/favorite', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(`
      UPDATE angles SET is_favorite = NOT is_favorite
      WHERE id = $1
      RETURNING *
    `, [id]);

    res.json({ angle: result.rows[0] });

  } catch (error) {
    console.error('Favorite angle error:', error);
    res.status(500).json({ error: 'Failed to update favorite' });
  }
});

/**
 * Delete angle
 * DELETE /api/angles/:id
 */
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;

    await pool.query('DELETE FROM angles WHERE id = $1', [id]);

    res.json({ success: true });

  } catch (error) {
    console.error('Delete angle error:', error);
    res.status(500).json({ error: 'Failed to delete angle' });
  }
});

module.exports = router;
