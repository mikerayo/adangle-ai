const { pool } = require('../config/database');

/**
 * Auth middleware - works with both OAuth and embedded apps
 */
async function authMiddleware(req, res, next) {
  // Try to get shop from multiple sources
  const shop = req.query.shop || req.session?.shop || req.headers['x-shopify-shop'];
  
  if (!shop) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  try {
    // Get or create shop in database
    let result = await pool.query(
      'SELECT id, shopify_domain, access_token, plan FROM shops WHERE shopify_domain = $1',
      [shop]
    );

    if (result.rows.length === 0) {
      // Auto-register shop for embedded apps
      result = await pool.query(`
        INSERT INTO shops (shopify_domain, access_token, plan)
        VALUES ($1, 'embedded', 'free')
        ON CONFLICT (shopify_domain) DO UPDATE SET updated_at = NOW()
        RETURNING id, shopify_domain, access_token, plan
      `, [shop]);
    }

    const shopData = result.rows[0];
    
    // Attach shop info to request
    req.shopify = {
      shop: shopData.shopify_domain,
      shopId: shopData.id,
      accessToken: shopData.access_token,
      plan: shopData.plan,
    };
    
    // Save to session for future requests
    req.session.shop = shop;

    next();
  } catch (error) {
    console.error('Auth middleware error:', error);
    res.status(500).json({ error: 'Authentication failed' });
  }
}

/**
 * Check usage limits based on plan
 */
function checkLimits(type) {
  return async (req, res, next) => {
    const limits = {
      free: { angles_per_month: 3, copies_per_month: 15 },
      starter: { angles_per_month: 30, copies_per_month: -1 },
      pro: { angles_per_month: -1, copies_per_month: -1 },
    };

    const shopId = req.shopify?.shopId;
    const plan = req.shopify?.plan || 'free';
    const planLimits = limits[plan] || limits.free;

    // -1 means unlimited
    if (planLimits[`${type}_per_month`] === -1) {
      return next();
    }

    // Check current usage
    const month = new Date().toISOString().slice(0, 7);
    const result = await pool.query(
      `SELECT ${type === 'angles' ? 'angles_discovered' : 'copies_generated'} as count 
       FROM usage WHERE shop_id = $1 AND month = $2`,
      [shopId, month]
    );

    const currentUsage = result.rows[0]?.count || 0;
    const limit = planLimits[`${type}_per_month`];

    if (currentUsage >= limit) {
      return res.status(403).json({ 
        error: `Monthly ${type} limit reached (${currentUsage}/${limit})`,
        upgrade: true
      });
    }

    next();
  };
}

module.exports = { authMiddleware, checkLimits };
