const express = require('express');
const https = require('https');
const { pool } = require('../config/database');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

const APP_URL = process.env.SHOPIFY_HOST || 'https://adangle-ai-production.up.railway.app';

/**
 * Plans configuration
 */
const PLANS = {
  trial: {
    name: 'AdAngle Trial',
    price: 1.00,
    trialDays: 0,
    interval: 'EVERY_30_DAYS',
    copies: 10,
    angles: 3,
    models: ['mixtral'],
    autoUpgrade: 'starter',
  },
  starter: {
    name: 'AdAngle Starter',
    price: 19.00,
    trialDays: 0,
    interval: 'EVERY_30_DAYS',
    copies: 50,
    angles: 10,
    models: ['mixtral'],
    videoScripts: false,
  },
  pro: {
    name: 'AdAngle Pro',
    price: 49.00,
    trialDays: 0,
    interval: 'EVERY_30_DAYS',
    copies: -1, // unlimited
    angles: 50,
    models: ['claude', 'gpt4o', 'llama'],
    videoScripts: true,
  },
  unlimited: {
    name: 'AdAngle Unlimited',
    price: 99.00,
    trialDays: 0,
    interval: 'EVERY_30_DAYS',
    copies: -1,
    angles: -1,
    models: ['claude', 'gpt4o', 'llama', 'mixtral'],
    videoScripts: true,
    priority: true,
  },
};

/**
 * HTTPS request helper
 */
function shopifyRequest(shop, accessToken, path, method = 'GET', body = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: shop,
      path: `/admin/api/2024-01${path}`,
      method,
      headers: {
        'X-Shopify-Access-Token': accessToken,
        'Content-Type': 'application/json',
      },
    };
    
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
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

/**
 * Get billing status
 * GET /api/billing/status
 */
router.get('/status', authMiddleware, async (req, res) => {
  try {
    const { shopId, plan } = req.shopify;
    
    // Get usage
    const month = new Date().toISOString().slice(0, 7);
    const usageResult = await pool.query(
      'SELECT angles_discovered, copies_generated FROM usage WHERE shop_id = $1 AND month = $2',
      [shopId, month]
    );
    const usage = usageResult.rows[0] || { angles_discovered: 0, copies_generated: 0 };
    
    const planConfig = PLANS[plan] || PLANS.starter;
    
    res.json({
      currentPlan: plan,
      planDetails: planConfig,
      usage,
      plans: PLANS,
    });
    
  } catch (error) {
    console.error('Billing status error:', error);
    res.status(500).json({ error: 'Failed to get billing status' });
  }
});

/**
 * Subscribe to a plan
 * POST /api/billing/subscribe
 */
router.post('/subscribe', authMiddleware, async (req, res) => {
  try {
    const { shop, accessToken, shopId } = req.shopify;
    const { plan } = req.body;
    
    console.log('Subscribe request:', { shop, plan, hasToken: !!accessToken });
    
    if (!PLANS[plan]) {
      return res.status(400).json({ error: 'Invalid plan' });
    }
    
    // Check if we have a real access token
    if (!accessToken || accessToken === 'embedded') {
      return res.status(401).json({ 
        error: 'OAuth required',
        authUrl: `${APP_URL}/api/auth?shop=${shop}`,
        message: 'Please reinstall the app to enable billing'
      });
    }
    
    const selectedPlan = PLANS[plan];
    
    // Create recurring charge via Shopify
    const chargeData = {
      recurring_application_charge: {
        name: selectedPlan.name,
        price: selectedPlan.price,
        return_url: `${APP_URL}/api/billing/confirm?shop=${shop}&plan=${plan}`,
        test: process.env.NODE_ENV !== 'production',
      }
    };
    
    console.log('Creating charge:', chargeData);
    
    const response = await shopifyRequest(
      shop, 
      accessToken, 
      '/recurring_application_charges.json',
      'POST',
      chargeData
    );
    
    console.log('Shopify response:', response.status, response.data);
    
    if (response.status !== 201 && response.status !== 200) {
      console.error('Charge creation failed:', response.data);
      return res.status(500).json({ 
        error: 'Failed to create subscription',
        details: response.data
      });
    }
    
    const charge = response.data.recurring_application_charge;
    
    res.json({
      success: true,
      confirmationUrl: charge.confirmation_url,
      chargeId: charge.id,
    });
    
  } catch (error) {
    console.error('Subscribe error:', error);
    res.status(500).json({ error: 'Subscription failed: ' + error.message });
  }
});

/**
 * Confirm subscription
 * GET /api/billing/confirm?charge_id=xxx&shop=xxx&plan=xxx
 */
router.get('/confirm', async (req, res) => {
  try {
    const { charge_id, shop, plan } = req.query;
    
    console.log('Confirm billing:', { charge_id, shop, plan });
    
    if (!charge_id || !shop) {
      return res.redirect(`/?shop=${shop}&error=missing_params`);
    }
    
    // Get access token from DB
    const shopResult = await pool.query(
      'SELECT id, access_token FROM shops WHERE shopify_domain = $1',
      [shop]
    );
    
    if (shopResult.rows.length === 0 || !shopResult.rows[0].access_token) {
      return res.redirect(`/?shop=${shop}&error=no_token`);
    }
    
    const { id: shopId, access_token: accessToken } = shopResult.rows[0];
    
    // Check charge status
    const response = await shopifyRequest(
      shop,
      accessToken,
      `/recurring_application_charges/${charge_id}.json`
    );
    
    console.log('Charge status:', response.status, response.data);
    
    if (response.status !== 200) {
      return res.redirect(`/?shop=${shop}&error=charge_not_found`);
    }
    
    const charge = response.data.recurring_application_charge;
    
    if (charge.status === 'active') {
      // Already active, update plan
      await pool.query(
        'UPDATE shops SET plan = $1 WHERE id = $2',
        [plan, shopId]
      );
      return res.redirect(`/?shop=${shop}&upgraded=${plan}`);
      
    } else if (charge.status === 'accepted') {
      // Need to activate
      const activateResponse = await shopifyRequest(
        shop,
        accessToken,
        `/recurring_application_charges/${charge_id}/activate.json`,
        'POST'
      );
      
      console.log('Activate response:', activateResponse.status);
      
      if (activateResponse.status === 200 || activateResponse.status === 201) {
        await pool.query(
          'UPDATE shops SET plan = $1 WHERE id = $2',
          [plan, shopId]
        );
        return res.redirect(`/?shop=${shop}&upgraded=${plan}`);
      } else {
        return res.redirect(`/?shop=${shop}&error=activation_failed`);
      }
      
    } else if (charge.status === 'declined') {
      return res.redirect(`/?shop=${shop}&error=declined`);
      
    } else {
      return res.redirect(`/?shop=${shop}&error=status_${charge.status}`);
    }
    
  } catch (error) {
    console.error('Confirm error:', error);
    res.redirect(`/?error=confirmation_failed`);
  }
});

/**
 * Cancel subscription
 * POST /api/billing/cancel
 */
router.post('/cancel', authMiddleware, async (req, res) => {
  try {
    const { shop, accessToken, shopId, plan } = req.shopify;
    
    if (plan === 'free') {
      return res.status(400).json({ error: 'Already on free plan' });
    }
    
    // List active charges
    const listResponse = await shopifyRequest(
      shop,
      accessToken,
      '/recurring_application_charges.json'
    );
    
    if (listResponse.status === 200) {
      const charges = listResponse.data.recurring_application_charges || [];
      const activeCharge = charges.find(c => c.status === 'active');
      
      if (activeCharge) {
        // Delete/cancel the charge
        await shopifyRequest(
          shop,
          accessToken,
          `/recurring_application_charges/${activeCharge.id}.json`,
          'DELETE'
        );
      }
    }
    
    // Downgrade to free
    await pool.query(
      'UPDATE shops SET plan = $1 WHERE id = $2',
      ['free', shopId]
    );
    
    res.json({ success: true, message: 'Subscription cancelled' });
    
  } catch (error) {
    console.error('Cancel error:', error);
    res.status(500).json({ error: 'Failed to cancel: ' + error.message });
  }
});

/**
 * Get available plans
 * GET /api/billing/plans
 */
router.get('/plans', (req, res) => {
  res.json({ plans: PLANS });
});

// NOTE: Testing endpoint removed for production
// If you need to test plans, uncomment the /set-plan route below
/*
router.post('/set-plan', async (req, res) => {
  const { shop, plan } = req.body;
  if (!shop || !plan) {
    return res.status(400).json({ error: 'shop and plan required' });
  }
  
  const validPlans = ['free', 'trial', 'starter', 'pro', 'unlimited'];
  if (!validPlans.includes(plan)) {
    return res.status(400).json({ error: 'Invalid plan' });
  }
  
  try {
    const result = await pool.query(
      'UPDATE shops SET plan = $1 WHERE shopify_domain = $2 RETURNING *',
      [plan, shop]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Shop not found' });
    }
    
    const shopId = result.rows[0].id;
    await pool.query('DELETE FROM usage WHERE shop_id = $1', [shopId]);
    
    res.json({ success: true, shop, plan, updated: result.rows[0], usageReset: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
*/

module.exports = router;

