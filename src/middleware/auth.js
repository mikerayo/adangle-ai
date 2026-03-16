const { pool } = require('../config/database');
const crypto = require('crypto');

/**
 * Verify Shopify session token (JWT)
 */
function verifySessionToken(token) {
  try {
    const [headerB64, payloadB64, signatureB64] = token.split('.');
    
    // Decode payload
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString());
    
    // Verify signature
    const secret = process.env.SHOPIFY_CLIENT_SECRET;
    const data = `${headerB64}.${payloadB64}`;
    const expectedSig = crypto
      .createHmac('sha256', secret)
      .update(data)
      .digest('base64url');
    
    // Check expiration
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp && payload.exp < now) {
      console.log('Session token expired');
      return null;
    }
    
    // Extract shop from dest or iss
    const dest = payload.dest || payload.iss || '';
    const shopMatch = dest.match(/https:\/\/([^\/]+)/);
    const shop = shopMatch ? shopMatch[1] : null;
    
    return { shop, payload };
  } catch (e) {
    console.log('Session token verification failed:', e.message);
    return null;
  }
}

/**
 * Auth middleware - works with both OAuth and embedded apps
 */
async function authMiddleware(req, res, next) {
  console.log('Auth middleware - query:', req.query, 'headers auth:', !!req.headers.authorization);
  
  // Try session token from Authorization header first
  const authHeader = req.headers.authorization;
  let shop = null;
  
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    const verified = verifySessionToken(token);
    if (verified && verified.shop) {
      shop = verified.shop;
      console.log('Shop from session token:', shop);
    }
  }
  
  // Fallback to query/session
  if (!shop) {
    shop = req.query.shop || req.session?.shop || req.headers['x-shopify-shop'];
  }
  
  if (!shop) {
    console.log('No shop found in request');
    return res.status(401).json({ error: 'Not authenticated - no shop' });
  }

  try {
    console.log('Looking up shop:', shop);
    
    // Get or create shop in database
    let result = await pool.query(
      'SELECT id, shopify_domain, access_token, plan FROM shops WHERE shopify_domain = $1',
      [shop]
    );

    if (result.rows.length === 0) {
      console.log('Shop not found, creating:', shop);
      // Auto-register shop for embedded apps
      result = await pool.query(`
        INSERT INTO shops (shopify_domain, access_token, plan)
        VALUES ($1, 'embedded', 'free')
        ON CONFLICT (shopify_domain) DO UPDATE SET updated_at = NOW()
        RETURNING id, shopify_domain, access_token, plan
      `, [shop]);
    }

    const shopData = result.rows[0];
    console.log('Shop data:', shopData);
    
    // Attach shop info to request
    req.shopify = {
      shop: shopData.shopify_domain,
      shopId: shopData.id,
      accessToken: shopData.access_token,
      plan: shopData.plan,
    };
    
    // Save to session for future requests
    if (req.session) {
      req.session.shop = shop;
    }

    next();
  } catch (error) {
    console.error('Auth middleware error:', error.message, error.stack);
    res.status(500).json({ error: 'Authentication failed: ' + error.message });
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

module.exports = { authMiddleware, checkLimits, checkUsage: checkLimits };
