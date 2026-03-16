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
    const { shopId, plan } = req.shopify;
    const { productId, language = 'en' } = req.body;

    console.log('Discover angles for productId:', productId, 'shopId:', shopId, 'plan:', plan, 'language:', language);

    if (!productId) {
      return res.status(400).json({ error: 'Product ID required' });
    }
    
    // Check language access based on plan
    const planLanguages = {
      free: ['en'],
      trial: ['en'],
      starter: ['en'],
      pro: ['en', 'es'],
      unlimited: ['en', 'es', 'fr', 'de', 'it', 'pt', 'nl']
    };
    const allowedLanguages = planLanguages[plan] || ['en'];
    if (!allowedLanguages.includes(language)) {
      return res.status(403).json({ 
        error: `${language.toUpperCase()} language requires upgrade`,
        upgrade: true
      });
    }

    // Get product from our DB (already synced)
    const productResult = await pool.query(
      'SELECT * FROM products WHERE id = $1 AND shop_id = $2',
      [productId, shopId]
    );

    if (productResult.rows.length === 0) {
      return res.status(404).json({ error: 'Product not found' });
    }

    const product = productResult.rows[0];
    const dbProductId = product.id;

    console.log('Found product:', product.title);

    // Discover angles using AI
    console.log(`Discovering angles for: ${product.title} (plan: ${plan}, language: ${language})`);
    const aiProduct = {
      title: product.title,
      description: product.description,
      price: product.price,
      compare_at_price: product.compare_at_price,
      category: product.category,
    };
    const { angles } = await aiService.discoverAngles(aiProduct, plan, { language });

    if (!angles || angles.length === 0) {
      return res.status(500).json({ error: 'Failed to discover angles' });
    }

    // Save angles to DB
    const savedAngles = [];
    for (const angle of angles) {
      const result = await pool.query(`
        INSERT INTO angles (product_id, name, audience, pain_point, hook, objection, emotion)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING *
      `, [
        dbProductId,
        angle.name,
        angle.audience,
        angle.pain_point,
        angle.hook,
        angle.objection,
        angle.emotion
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
    console.error('Discover angles error:', error.message, error.stack);
    res.status(500).json({ error: 'Discover failed: ' + error.message });
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
