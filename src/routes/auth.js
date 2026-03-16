const express = require('express');
const crypto = require('crypto');
const https = require('https');
const { pool } = require('../config/database');

const router = express.Router();

const SHOPIFY_API_KEY = process.env.SHOPIFY_API_KEY;
const SHOPIFY_API_SECRET = process.env.SHOPIFY_API_SECRET;
const SHOPIFY_SCOPES = 'read_products,write_products';
const APP_URL = process.env.SHOPIFY_HOST || 'https://adangle-ai-production.up.railway.app';

/**
 * Validate shop domain
 */
function isValidShop(shop) {
  if (!shop) return false;
  return /^[a-zA-Z0-9][a-zA-Z0-9-]*\.myshopify\.com$/.test(shop);
}

/**
 * Verify HMAC from Shopify
 */
function verifyHmac(query) {
  const { hmac, ...params } = query;
  if (!hmac) return false;
  
  const message = Object.keys(params)
    .sort()
    .map(key => `${key}=${params[key]}`)
    .join('&');
  
  const generatedHmac = crypto
    .createHmac('sha256', SHOPIFY_API_SECRET)
    .update(message)
    .digest('hex');
  
  try {
    return crypto.timingSafeEqual(
      Buffer.from(hmac, 'hex'),
      Buffer.from(generatedHmac, 'hex')
    );
  } catch {
    return false;
  }
}

/**
 * Make HTTPS request (helper)
 */
function httpsRequest(options, postData = null) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, data });
        }
      });
    });
    req.on('error', reject);
    if (postData) req.write(postData);
    req.end();
  });
}

/**
 * Step 1: Start OAuth - redirect to Shopify
 * GET /api/auth?shop=store.myshopify.com
 */
router.get('/', (req, res) => {
  const { shop } = req.query;
  
  if (!isValidShop(shop)) {
    return res.status(400).send('Invalid shop domain. Use: yourstore.myshopify.com');
  }
  
  // Generate nonce for CSRF protection
  const nonce = crypto.randomBytes(16).toString('hex');
  
  // Store nonce in session
  req.session.nonce = nonce;
  req.session.shop = shop;
  
  // Build auth URL
  const authUrl = `https://${shop}/admin/oauth/authorize?` +
    `client_id=${SHOPIFY_API_KEY}&` +
    `scope=${SHOPIFY_SCOPES}&` +
    `redirect_uri=${APP_URL}/api/auth/callback&` +
    `state=${nonce}`;
  
  console.log('OAuth redirect to:', authUrl);
  res.redirect(authUrl);
});

/**
 * Step 2: OAuth Callback - exchange code for token
 * GET /api/auth/callback?code=xxx&hmac=xxx&shop=xxx&state=xxx
 */
router.get('/callback', async (req, res) => {
  const { shop, code, state, hmac } = req.query;
  
  console.log('OAuth callback:', { shop, state, hasCode: !!code });
  
  // Verify shop
  if (!isValidShop(shop)) {
    return res.status(400).send('Invalid shop');
  }
  
  // Verify HMAC
  if (!verifyHmac(req.query)) {
    console.error('HMAC verification failed');
    return res.status(401).send('Invalid signature');
  }
  
  // Verify state (nonce)
  if (state !== req.session.nonce) {
    console.error('State mismatch:', state, req.session.nonce);
    return res.status(401).send('Invalid state');
  }
  
  try {
    // Exchange code for access token
    const postData = JSON.stringify({
      client_id: SHOPIFY_API_KEY,
      client_secret: SHOPIFY_API_SECRET,
      code: code,
    });
    
    const response = await httpsRequest({
      hostname: shop,
      path: '/admin/oauth/access_token',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
      },
    }, postData);
    
    console.log('Token exchange response:', response.status);
    
    if (response.status !== 200 || !response.data.access_token) {
      console.error('Token exchange failed:', response.data);
      return res.status(500).send('Failed to get access token');
    }
    
    const accessToken = response.data.access_token;
    console.log('Got access token for', shop);
    
    // Save to database
    await pool.query(`
      INSERT INTO shops (shopify_domain, access_token, plan)
      VALUES ($1, $2, 'free')
      ON CONFLICT (shopify_domain) 
      DO UPDATE SET access_token = $2
    `, [shop, accessToken]);
    
    // Store in session
    req.session.shop = shop;
    req.session.accessToken = accessToken;
    
    // Redirect to app
    const host = Buffer.from(`${shop}/admin`).toString('base64');
    res.redirect(`/?shop=${shop}&host=${host}`);
    
  } catch (error) {
    console.error('OAuth callback error:', error);
    res.status(500).send('Authentication failed');
  }
});

/**
 * Install endpoint - for App Store installs
 * GET /api/auth/install?shop=xxx
 */
router.get('/install', (req, res) => {
  const { shop } = req.query;
  
  if (!isValidShop(shop)) {
    return res.status(400).send(`
      <html>
        <body style="font-family: sans-serif; padding: 40px; text-align: center;">
          <h1>Install AdAngle AI</h1>
          <p>Enter your Shopify store domain:</p>
          <form action="/api/auth" method="GET">
            <input type="text" name="shop" placeholder="yourstore.myshopify.com" 
                   style="padding: 12px; font-size: 16px; width: 300px;">
            <button type="submit" style="padding: 12px 24px; font-size: 16px; cursor: pointer;">
              Install
            </button>
          </form>
        </body>
      </html>
    `);
  }
  
  // Start OAuth
  res.redirect(`/api/auth?shop=${shop}`);
});

/**
 * Check if shop has valid token
 * GET /api/auth/check?shop=xxx
 */
router.get('/check', async (req, res) => {
  const { shop } = req.query;
  
  if (!shop) {
    return res.json({ authenticated: false });
  }
  
  try {
    const result = await pool.query(
      'SELECT access_token FROM shops WHERE shopify_domain = $1',
      [shop]
    );
    
    if (result.rows.length === 0 || !result.rows[0].access_token || result.rows[0].access_token === 'embedded') {
      return res.json({ authenticated: false, needsAuth: true });
    }
    
    res.json({ authenticated: true });
  } catch (error) {
    res.json({ authenticated: false, error: error.message });
  }
});

module.exports = router;
