const express = require('express');
const crypto = require('crypto');
const { pool } = require('../config/database');

const router = express.Router();

/**
 * Verify Shopify webhook HMAC signature
 */
function verifyWebhook(req, res, next) {
  const hmac = req.get('X-Shopify-Hmac-Sha256');
  const secret = process.env.SHOPIFY_CLIENT_SECRET;
  
  if (!hmac || !secret) {
    console.log('Webhook verification failed: missing HMAC or secret');
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  // Get raw body
  const body = req.rawBody || JSON.stringify(req.body);
  
  const hash = crypto
    .createHmac('sha256', secret)
    .update(body, 'utf8')
    .digest('base64');
  
  const valid = crypto.timingSafeEqual(
    Buffer.from(hash),
    Buffer.from(hmac)
  );
  
  if (!valid) {
    console.log('Webhook verification failed: invalid HMAC');
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  next();
}

/**
 * GDPR: Customer data request
 * POST /api/webhooks/customers/data_request
 */
router.post('/customers/data_request', verifyWebhook, (req, res) => {
  console.log('Webhook: Customer data request received');
  
  // We don't store customer data, only product data
  res.status(200).json({ 
    message: 'AdAngle AI does not store customer personal data. Only product information is stored.' 
  });
});

/**
 * GDPR: Customer data erasure (redact)
 * POST /api/webhooks/customers/redact
 */
router.post('/customers/redact', verifyWebhook, (req, res) => {
  console.log('Webhook: Customer redact request received');
  
  // We don't store customer data, nothing to delete
  res.status(200).json({ 
    message: 'No customer data to delete. AdAngle AI only stores product information.' 
  });
});

/**
 * GDPR: Shop data erasure (when app is uninstalled)
 * POST /api/webhooks/shop/redact
 */
router.post('/shop/redact', verifyWebhook, async (req, res) => {
  console.log('Webhook: Shop redact request received');
  
  try {
    const { shop_domain } = req.body;
    
    if (shop_domain) {
      // Delete all shop data
      const shopResult = await pool.query(
        'SELECT id FROM shops WHERE shopify_domain = $1',
        [shop_domain]
      );
      
      if (shopResult.rows.length > 0) {
        const shopId = shopResult.rows[0].id;
        
        // Delete in order (foreign key constraints)
        await pool.query('DELETE FROM copies WHERE angle_id IN (SELECT id FROM angles WHERE product_id IN (SELECT id FROM products WHERE shop_id = $1))', [shopId]);
        await pool.query('DELETE FROM angles WHERE product_id IN (SELECT id FROM products WHERE shop_id = $1)', [shopId]);
        await pool.query('DELETE FROM products WHERE shop_id = $1', [shopId]);
        await pool.query('DELETE FROM usage WHERE shop_id = $1', [shopId]);
        await pool.query('DELETE FROM shops WHERE id = $1', [shopId]);
        
        console.log(`Shop data deleted for: ${shop_domain}`);
      }
    }
    
    res.status(200).json({ message: 'Shop data deleted successfully' });
  } catch (error) {
    console.error('Shop redact error:', error);
    res.status(200).json({ message: 'Acknowledged' });
  }
});

/**
 * App uninstalled webhook
 * POST /api/webhooks/app/uninstalled
 */
router.post('/app/uninstalled', verifyWebhook, async (req, res) => {
  console.log('Webhook: App uninstalled');
  
  try {
    const shopDomain = req.get('X-Shopify-Shop-Domain');
    
    if (shopDomain) {
      await pool.query(
        'UPDATE shops SET access_token = NULL WHERE shopify_domain = $1',
        [shopDomain]
      );
      console.log(`App uninstalled for: ${shopDomain}`);
    }
    
    res.status(200).json({ message: 'Acknowledged' });
  } catch (error) {
    console.error('Uninstall webhook error:', error);
    res.status(200).json({ message: 'Acknowledged' });
  }
});

module.exports = router;
