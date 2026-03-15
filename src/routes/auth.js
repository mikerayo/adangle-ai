const express = require('express');
const crypto = require('crypto');
const { pool } = require('../config/database');

const router = express.Router();

const SHOPIFY_API_KEY = process.env.SHOPIFY_API_KEY;
const SHOPIFY_API_SECRET = process.env.SHOPIFY_API_SECRET;
const SHOPIFY_SCOPES = process.env.SHOPIFY_SCOPES || 'read_products';
const SHOPIFY_HOST = process.env.SHOPIFY_HOST;

/**
 * Validate shop domain format
 * Per Shopify docs: must be valid myshopify.com domain
 */
function isValidShop(shop) {
  if (!shop || typeof shop !== 'string') return false;
  // Shopify shop domains: {store}.myshopify.com
  const shopRegex = /^[a-zA-Z0-9][a-zA-Z0-9-]*\.myshopify\.com$/;
  return shopRegex.test(shop);
}

/**
 * Verify HMAC signature from Shopify
 * Per Shopify OAuth docs
 */
function verifyHmac(query, secret) {
  const { hmac, signature, ...params } = query;
  
  // Sort and stringify params
  const message = Object.keys(params)
    .sort()
    .map(key => `${key}=${Array.isArray(params[key]) ? params[key].join(',') : params[key]}`)
    .join('&');
  
  const generatedHmac = crypto
    .createHmac('sha256', secret)
    .update(message)
    .digest('hex');
  
  // Use timing-safe comparison to prevent timing attacks
  try {
    return crypto.timingSafeEqual(
      Buffer.from(hmac, 'hex'),
      Buffer.from(generatedHmac, 'hex')
    );
  } catch (e) {
    return false;
  }
}

/**
 * Start OAuth flow
 * GET /api/auth?shop=mystore.myshopify.com
 * 
 * Shopify OAuth Reference:
 * https://shopify.dev/docs/apps/auth/oauth/getting-started
 */
router.get('/', (req, res) => {
  const { shop } = req.query;
  
  if (!isValidShop(shop)) {
    return res.status(400).json({ error: 'Invalid shop parameter' });
  }

  // Generate nonce for state parameter (CSRF protection)
  const nonce = crypto.randomBytes(16).toString('hex');
  req.session.state = nonce;
  req.session.shop = shop;

  const redirectUri = `${SHOPIFY_HOST}/api/auth/callback`;
  
  // Build authorization URL per Shopify docs
  const authUrl = new URL(`https://${shop}/admin/oauth/authorize`);
  authUrl.searchParams.set('client_id', SHOPIFY_API_KEY);
  authUrl.searchParams.set('scope', SHOPIFY_SCOPES);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('state', nonce);
  // grant_options[] for offline access (default, persists token)
  authUrl.searchParams.set('grant_options[]', 'per-user');

  res.redirect(authUrl.toString());
});

/**
 * OAuth callback
 * GET /api/auth/callback
 * 
 * Shopify will redirect here with:
 * - code: authorization code to exchange for access token
 * - hmac: signature to verify request authenticity
 * - shop: the shop domain
 * - state: nonce we provided
 * - timestamp: request timestamp
 */
router.get('/callback', async (req, res) => {
  const { shop, code, state, hmac, timestamp } = req.query;

  // 1. Verify shop domain
  if (!isValidShop(shop)) {
    return res.status(400).json({ error: 'Invalid shop parameter' });
  }

  // 2. Verify state (CSRF protection)
  if (!state || state !== req.session.state) {
    return res.status(403).json({ error: 'State mismatch - possible CSRF attack' });
  }

  // 3. Verify HMAC signature
  if (!verifyHmac(req.query, SHOPIFY_API_SECRET)) {
    return res.status(403).json({ error: 'HMAC validation failed' });
  }

  // 4. Verify timestamp is recent (within 5 minutes)
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - parseInt(timestamp)) > 300) {
    return res.status(403).json({ error: 'Request timestamp too old' });
  }

  try {
    // 5. Exchange authorization code for access token
    const tokenResponse = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({
        client_id: SHOPIFY_API_KEY,
        client_secret: SHOPIFY_API_SECRET,
        code,
      }),
    });

    if (!tokenResponse.ok) {
      const error = await tokenResponse.text();
      console.error('Token exchange failed:', error);
      return res.status(500).json({ error: 'Failed to exchange token' });
    }

    const tokenData = await tokenResponse.json();
    const { access_token, scope } = tokenData;

    if (!access_token) {
      return res.status(500).json({ error: 'No access token received' });
    }

    // 6. Save/update shop in database
    const result = await pool.query(`
      INSERT INTO shops (shopify_domain, access_token)
      VALUES ($1, $2)
      ON CONFLICT (shopify_domain) 
      DO UPDATE SET access_token = $2, updated_at = NOW()
      RETURNING id
    `, [shop, access_token]);

    // 7. Set session
    req.session.shop = shop;
    req.session.accessToken = access_token;
    req.session.shopId = result.rows[0].id;

    // 8. Clear the state nonce
    delete req.session.state;

    // 9. Redirect to app dashboard
    res.redirect('/dashboard');

  } catch (error) {
    console.error('OAuth error:', error);
    res.status(500).json({ error: 'Authentication failed' });
  }
});

/**
 * Verify webhook HMAC
 * For future webhook implementation
 */
router.post('/webhook/verify', express.raw({ type: 'application/json' }), (req, res, next) => {
  const hmac = req.get('X-Shopify-Hmac-Sha256');
  const body = req.body;
  
  const generatedHmac = crypto
    .createHmac('sha256', SHOPIFY_API_SECRET)
    .update(body)
    .digest('base64');
  
  if (hmac !== generatedHmac) {
    return res.status(401).json({ error: 'Invalid webhook signature' });
  }
  
  next();
});

/**
 * Get current session
 * GET /api/auth/session
 */
router.get('/session', async (req, res) => {
  const { shop, accessToken } = req.session;

  if (!shop || !accessToken) {
    return res.status(401).json({ authenticated: false });
  }

  try {
    // Verify token is still valid by making a simple API call
    const verifyResponse = await fetch(`https://${shop}/admin/api/2025-01/shop.json`, {
      headers: {
        'X-Shopify-Access-Token': accessToken,
        'Content-Type': 'application/json'
      }
    });

    if (!verifyResponse.ok) {
      // Token invalid, clear session
      req.session.destroy();
      return res.status(401).json({ authenticated: false, error: 'Token expired' });
    }

    const result = await pool.query(
      'SELECT id, shopify_domain, plan, created_at FROM shops WHERE shopify_domain = $1',
      [shop]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ authenticated: false });
    }

    const shopData = result.rows[0];

    // Get usage for current month
    const month = new Date().toISOString().slice(0, 7);
    const usageResult = await pool.query(
      'SELECT angles_discovered, copies_generated FROM usage WHERE shop_id = $1 AND month = $2',
      [shopData.id, month]
    );

    const usage = usageResult.rows[0] || { angles_discovered: 0, copies_generated: 0 };

    res.json({
      authenticated: true,
      shop: {
        id: shopData.id,
        domain: shopData.shopify_domain,
        plan: shopData.plan,
        createdAt: shopData.created_at,
      },
      usage,
      limits: getPlanLimits(shopData.plan),
    });

  } catch (error) {
    console.error('Session error:', error);
    res.status(500).json({ error: 'Failed to get session' });
  }
});

/**
 * Logout
 * POST /api/auth/logout
 */
router.post('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to logout' });
    }
    res.json({ success: true });
  });
});

/**
 * Get plan limits
 */
function getPlanLimits(plan) {
  const limits = {
    free: {
      angles_per_month: 3,
      copies_per_month: 15,
      video_scripts: false,
      teleprompter: false,
    },
    starter: {
      angles_per_month: 30,
      copies_per_month: -1, // unlimited
      video_scripts: true,
      teleprompter: true,
    },
    pro: {
      angles_per_month: -1, // unlimited
      copies_per_month: -1,
      video_scripts: true,
      teleprompter: true,
    },
  };
  return limits[plan] || limits.free;
}

module.exports = router;
