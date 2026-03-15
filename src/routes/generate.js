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
    console.log(`Generating copies for angle: ${angle.name}`);
    const copies = await aiService.generateCopies(product, angle);

    // Save copies to DB
    const savedCopies = [];
    for (const copy of copies) {
      if (!copy.error) {
        const result = await pool.query(`
          INSERT INTO copies (angle_id, type, style, model_used, content)
          VALUES ($1, $2, $3, $4, $5)
          RETURNING *
        `, [angleId, 'ad_copy', copy.style, copy.model, copy.content]);
        savedCopies.push(result.rows[0]);
      }
    }

    // Update usage
    const month = new Date().toISOString().slice(0, 7);
    await pool.query(`
      INSERT INTO usage (shop_id, month, copies_generated)
      VALUES ($1, $2, 5)
      ON CONFLICT (shop_id, month)
      DO UPDATE SET copies_generated = usage.copies_generated + 5
    `, [shopId, month]);

    res.json({
      success: true,
      angle: angle.name,
      copies: savedCopies,
    });

  } catch (error) {
    console.error('Generate copies error:', error);
    res.status(500).json({ error: 'Failed to generate copies' });
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

    // Check if plan allows video scripts
    if (plan === 'free') {
      return res.status(403).json({ error: 'Video scripts require Starter plan or higher' });
    }

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

    // Save to DB
    const result = await pool.query(`
      INSERT INTO copies (angle_id, type, style, model_used, content)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `, [angleId, 'video_script', 'ugc', 'gpt-4o', script]);

    res.json({
      success: true,
      angle: angle.name,
      script: result.rows[0],
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

module.exports = router;
