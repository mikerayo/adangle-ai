const { pool } = require('../config/database');

/**
 * Auth middleware - verifies session and adds shopify data to request
 */
async function authMiddleware(req, res, next) {
  try {
    const { shop, accessToken } = req.session;

    if (!shop || !accessToken) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    // Get shop from database
    const result = await pool.query(
      'SELECT id, plan FROM shops WHERE shopify_domain = $1',
      [shop]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Shop not found' });
    }

    // Attach to request
    req.shopify = {
      shop,
      accessToken,
      shopId: result.rows[0].id,
      plan: result.rows[0].plan,
    };

    next();
  } catch (error) {
    console.error('Auth middleware error:', error);
    res.status(500).json({ error: 'Authentication error' });
  }
}

/**
 * Check usage limits
 */
function checkUsage(type) {
  return async (req, res, next) => {
    try {
      const { shopId, plan } = req.shopify;
      const month = new Date().toISOString().slice(0, 7);

      // Get current usage
      const usageResult = await pool.query(
        'SELECT angles_discovered, copies_generated FROM usage WHERE shop_id = $1 AND month = $2',
        [shopId, month]
      );
      
      const usage = usageResult.rows[0] || { angles_discovered: 0, copies_generated: 0 };
      const limits = getPlanLimits(plan);

      // Check limits
      if (type === 'angles') {
        if (limits.angles_per_month !== -1 && usage.angles_discovered >= limits.angles_per_month) {
          return res.status(403).json({
            error: 'Angle discovery limit reached',
            limit: limits.angles_per_month,
            used: usage.angles_discovered,
            upgrade: plan === 'free' ? 'starter' : 'pro',
          });
        }
      }

      if (type === 'copies') {
        if (limits.copies_per_month !== -1 && usage.copies_generated >= limits.copies_per_month) {
          return res.status(403).json({
            error: 'Copy generation limit reached',
            limit: limits.copies_per_month,
            used: usage.copies_generated,
            upgrade: plan === 'free' ? 'starter' : 'pro',
          });
        }
      }

      req.usage = usage;
      req.limits = limits;
      next();

    } catch (error) {
      console.error('Check usage error:', error);
      res.status(500).json({ error: 'Failed to check usage' });
    }
  };
}

function getPlanLimits(plan) {
  const limits = {
    free: { angles_per_month: 3, copies_per_month: 15 },
    starter: { angles_per_month: 30, copies_per_month: -1 },
    pro: { angles_per_month: -1, copies_per_month: -1 },
  };
  return limits[plan] || limits.free;
}

module.exports = { authMiddleware, checkUsage };
