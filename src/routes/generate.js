const express = require('express');
const { pool } = require('../config/database');
const aiService = require('../services/openrouter');
const { authMiddleware, checkUsage } = require('../middleware/auth');

const router = express.Router();

/**
 * Generate ad copies for an angle
 * POST /api/generate/copies
 */
router.post('/copies', authMiddleware, checkUsage('copies'), async (req, res) => {
  try {
    const { shopId } = req.shopify;
    const { angleId } = req.body;

    if (!angleId) {
      return res.status(400).json({ error: 'Angle ID required' });
    }

    // Get angle and product data
    const angleResult = await pool.query(`
      SELECT a.*, p.title, p.description, p.price, p.compare_at_price, p.image_url
      FROM angles a
      JOIN products p ON a.product_id = p.id
      WHERE a.id = $1 AND p.shop_id = $2
    `, [angleId, shopId]);

    if (angleResult.rows.length === 0) {
      return res.status(404).json({ error: 'Angle not found' });
    }

    const data = angleResult.rows[0];
    
    const product = {
      title: data.title,
      description: data.description,
      price: data.price,
      compare_at_price: data.compare_at_price,
    };

    const angle = {
      name: data.name,
      audience: data.audience,
      pain_point: data.pain_point,
      hook: data.hook,
      objection: data.objection,
      emotion: data.emotion,
    };

    // Generate copies using multiple models
    const { plan } = req.shopify;
    console.log(`Generating copies for angle: ${angle.name} (plan: ${plan})`);
    const copies = await aiService.generateCopies(product, angle, plan);

    // Return copies directly without saving (DB schema issue)
    const savedCopies = copies.filter(c => !c.error).map((c, i) => ({
      id: i + 1,
      style: c.style,
      content: c.content,
      model: c.model
    }));

    // Skip usage tracking for now (DB schema issues)

    res.json({
      success: true,
      angle: angle.name,
      copies: savedCopies,
    });

  } catch (error) {
    console.error('Generate copies error:', error.message, error.stack);
    res.status(500).json({ error: 'Failed to generate copies: ' + error.message });
  }
});

/**
 * Generate video script for an angle
 * POST /api/generate/video-script
 */
router.post('/video-script', authMiddleware, checkUsage('copies'), async (req, res) => {
  try {
    const { shopId, plan } = req.shopify;
    const { angleId } = req.body;

    // Allow video scripts for testing (remove later)
    // if (plan === 'free') {
    //   return res.status(403).json({ error: 'Video scripts require Starter plan or higher' });
    // }

    if (!angleId) {
      return res.status(400).json({ error: 'Angle ID required' });
    }

    // Get angle and product data
    const angleResult = await pool.query(`
      SELECT a.*, p.title, p.description, p.price, p.compare_at_price
      FROM angles a
      JOIN products p ON a.product_id = p.id
      WHERE a.id = $1 AND p.shop_id = $2
    `, [angleId, shopId]);

    if (angleResult.rows.length === 0) {
      return res.status(404).json({ error: 'Angle not found' });
    }

    const data = angleResult.rows[0];
    
    const product = {
      title: data.title,
      description: data.description,
      price: data.price,
    };

    const angle = {
      name: data.name,
      audience: data.audience,
      hook: data.hook,
    };

    // Generate video script
    console.log(`Generating video script for angle: ${angle.name}`);
    const script = await aiService.generateVideoScript(product, angle);

    res.json({
      success: true,
      angle: angle.name,
      script: { content: script },
    });

  } catch (error) {
    console.error('Generate video script error:', error);
    res.status(500).json({ error: 'Failed to generate video script' });
  }
});

/**
 * Get all copies for an angle
 * GET /api/generate/copies/:angleId
 */
router.get('/copies/:angleId', authMiddleware, async (req, res) => {
  try {
    const { shopId } = req.shopify;
    const { angleId } = req.params;

    // Verify angle belongs to shop
    const verifyResult = await pool.query(`
      SELECT a.id FROM angles a
      JOIN products p ON a.product_id = p.id
      WHERE a.id = $1 AND p.shop_id = $2
    `, [angleId, shopId]);

    if (verifyResult.rows.length === 0) {
      return res.status(404).json({ error: 'Angle not found' });
    }

    const result = await pool.query(`
      SELECT * FROM copies WHERE angle_id = $1 ORDER BY created_at DESC
    `, [angleId]);

    res.json({ copies: result.rows });

  } catch (error) {
    console.error('Get copies error:', error);
    res.status(500).json({ error: 'Failed to get copies' });
  }
});

/**
 * Regenerate a single copy with different style
 * POST /api/generate/regenerate
 */
router.post('/regenerate', authMiddleware, async (req, res) => {
  try {
    const { shopId } = req.shopify;
    const { copyId } = req.body;

    // Get existing copy and angle data
    const copyResult = await pool.query(`
      SELECT c.*, a.name as angle_name, a.audience, a.pain_point, a.hook, a.emotion, a.objection,
             p.title, p.description, p.price, p.compare_at_price
      FROM copies c
      JOIN angles a ON c.angle_id = a.id
      JOIN products p ON a.product_id = p.id
      WHERE c.id = $1 AND p.shop_id = $2
    `, [copyId, shopId]);

    if (copyResult.rows.length === 0) {
      return res.status(404).json({ error: 'Copy not found' });
    }

    const data = copyResult.rows[0];
    
    const product = {
      title: data.title,
      description: data.description,
      price: data.price,
      compare_at_price: data.compare_at_price,
    };

    const angle = {
      name: data.angle_name,
      audience: data.audience,
      pain_point: data.pain_point,
      hook: data.hook,
      objection: data.objection,
      emotion: data.emotion,
    };

    // Generate new copy
    const copies = await aiService.generateCopies(product, angle);
    const newCopy = copies.find(c => c.style === data.style) || copies[0];

    // Update in DB
    const result = await pool.query(`
      UPDATE copies SET content = $1, model_used = $2, created_at = NOW()
      WHERE id = $3
      RETURNING *
    `, [newCopy.content, newCopy.model, copyId]);

    res.json({
      success: true,
      copy: result.rows[0],
    });

  } catch (error) {
    console.error('Regenerate copy error:', error);
    res.status(500).json({ error: 'Failed to regenerate copy' });
  }
});

/**
 * Generate hook variations (Unlimited only)
 * POST /api/generate/hooks
 */
router.post('/hooks', authMiddleware, async (req, res) => {
  try {
    const { shopId, plan } = req.shopify;
    const { angleId } = req.body;

    // Check if Unlimited
    if (plan !== 'unlimited') {
      return res.status(403).json({ 
        error: 'Hook variations require Unlimited plan',
        upgrade: true 
      });
    }

    // Get angle and product
    const result = await pool.query(`
      SELECT a.*, p.title, p.description, p.price
      FROM angles a
      JOIN products p ON a.product_id = p.id
      WHERE a.id = $1 AND p.shop_id = $2
    `, [angleId, shopId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Angle not found' });
    }

    const data = result.rows[0];
    const product = { title: data.title, description: data.description, price: data.price };
    const angle = { name: data.name, audience: data.audience, hook: data.hook };

    console.log(`Generating hook variations for: ${angle.name}`);
    const { hooks } = await aiService.generateHookVariations(product, angle, 5);

    res.json({ success: true, hooks });

  } catch (error) {
    console.error('Hook variations error:', error);
    res.status(500).json({ error: 'Failed to generate hooks: ' + error.message });
  }
});

/**
 * Bulk discover angles (Unlimited only)
 * POST /api/generate/bulk
 */
router.post('/bulk', authMiddleware, async (req, res) => {
  try {
    const { shopId, plan } = req.shopify;

    // Check if Unlimited
    if (plan !== 'unlimited') {
      return res.status(403).json({ 
        error: 'Bulk generation requires Unlimited plan',
        upgrade: true 
      });
    }

    // Get all products for this shop
    const productsResult = await pool.query(
      'SELECT id, title, description, price, compare_at_price, category FROM products WHERE shop_id = $1',
      [shopId]
    );

    if (productsResult.rows.length === 0) {
      return res.status(400).json({ error: 'No products found' });
    }

    console.log(`Bulk generating for ${productsResult.rows.length} products`);

    const results = [];
    for (const product of productsResult.rows) {
      try {
        const { angles } = await aiService.discoverAngles(product, plan);
        
        // Save angles
        for (const angle of (angles || [])) {
          await pool.query(`
            INSERT INTO angles (product_id, name, audience, pain_point, hook, objection, emotion)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
          `, [product.id, angle.name, angle.audience, angle.pain_point, angle.hook, angle.objection, angle.emotion]);
        }
        
        results.push({ product: product.title, angles: angles?.length || 0, success: true });
      } catch (e) {
        results.push({ product: product.title, error: e.message, success: false });
      }
    }

    res.json({ success: true, results, total: results.length });

  } catch (error) {
    console.error('Bulk generation error:', error);
    res.status(500).json({ error: 'Bulk generation failed: ' + error.message });
  }
});

module.exports = router;
