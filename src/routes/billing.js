const express = require('express');
const { pool } = require('../config/database');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

/**
 * Shopify Billing API Reference:
 * https://shopify.dev/docs/apps/billing
 * 
 * For recurring charges (subscriptions):
 * https://shopify.dev/docs/api/admin-rest/2025-01/resources/recurringapplicationcharge
 */

const PLANS = {
  starter: {
    name: 'AdAngle Starter',
    price: 29.00,
    trialDays: 7,
    features: '30 angle discoveries, unlimited copies, video scripts'
  },
  pro: {
    name: 'AdAngle Pro',
    price: 79.00,
    trialDays: 7,
    features: 'Unlimited everything, priority support'
  }
};

/**
 * Get current billing status
 * GET /api/billing/status
 */
router.get('/status', authMiddleware, async (req, res) => {
  try {
    const { shopId, shop, accessToken } = req.shopify;

    // Get shop plan from our DB
    const shopResult = await pool.query(
      'SELECT plan, plan_expires_at FROM shops WHERE id = $1',
      [shopId]
    );
    const shopData = shopResult.rows[0];

    // Get current month usage
    const month = new Date().toISOString().slice(0, 7);
    const usageResult = await pool.query(
      'SELECT angles_discovered, copies_generated FROM usage WHERE shop_id = $1 AND month = $2',
      [shopId, month]
    );
    const usage = usageResult.rows[0] || { angles_discovered: 0, copies_generated: 0 };

    // Get active Shopify subscription
    let activeSubscription = null;
    try {
      const response = await fetch(
        `https://${shop}/admin/api/2025-01/recurring_application_charges.json`,
        {
          headers: {
            'X-Shopify-Access-Token': accessToken,
            'Content-Type': 'application/json',
          },
        }
      );

      if (response.ok) {
        const data = await response.json();
        activeSubscription = data.recurring_application_charges?.find(
          charge => charge.status === 'active'
        ) || null;
      }
    } catch (e) {
      console.error('Failed to fetch Shopify subscription:', e);
    }

    res.json({
      plan: shopData.plan,
      planExpiresAt: shopData.plan_expires_at,
      usage,
      limits: getPlanLimits(shopData.plan),
      subscription: activeSubscription,
      availablePlans: PLANS,
    });

  } catch (error) {
    console.error('Billing status error:', error);
    res.status(500).json({ error: 'Failed to get billing status' });
  }
});

/**
 * Create subscription (initiate upgrade)
 * POST /api/billing/subscribe
 * 
 * This creates a RecurringApplicationCharge in Shopify.
 * User must confirm on Shopify's page.
 */
router.post('/subscribe', authMiddleware, async (req, res) => {
  try {
    const { shop, accessToken } = req.shopify;
    const { plan } = req.body;

    if (!PLANS[plan]) {
      return res.status(400).json({ error: 'Invalid plan. Choose: starter or pro' });
    }

    const selectedPlan = PLANS[plan];

    // Create recurring charge via Shopify API
    // Reference: https://shopify.dev/docs/api/admin-rest/2025-01/resources/recurringapplicationcharge#post-recurring-application-charges
    const response = await fetch(
      `https://${shop}/admin/api/2025-01/recurring_application_charges.json`,
      {
        method: 'POST',
        headers: {
          'X-Shopify-Access-Token': accessToken,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          recurring_application_charge: {
            name: selectedPlan.name,
            price: selectedPlan.price,
            return_url: `${process.env.SHOPIFY_HOST}/api/billing/confirm?plan=${plan}`,
            trial_days: selectedPlan.trialDays,
            test: process.env.NODE_ENV !== 'production', // Use test charges in development
            // capped_amount and terms are optional for usage-based billing
          }
        }),
      }
    );

    if (!response.ok) {
      const error = await response.json();
      console.error('Shopify billing error:', error);
      return res.status(500).json({ error: 'Failed to create subscription' });
    }

    const data = await response.json();
    const charge = data.recurring_application_charge;

    // Return confirmation URL - user must visit this to approve
    res.json({
      success: true,
      chargeId: charge.id,
      confirmationUrl: charge.confirmation_url,
    });

  } catch (error) {
    console.error('Subscribe error:', error);
    res.status(500).json({ error: 'Failed to create subscription' });
  }
});

/**
 * Confirm subscription callback
 * GET /api/billing/confirm?charge_id=xxx&plan=xxx
 * 
 * Shopify redirects here after user approves/declines the charge.
 */
router.get('/confirm', async (req, res) => {
  try {
    const { charge_id, plan } = req.query;
    const { shop, accessToken } = req.session;

    if (!shop || !accessToken) {
      return res.redirect('/?error=session_expired');
    }

    if (!charge_id) {
      return res.redirect('/dashboard?error=no_charge_id');
    }

    // Verify the charge status with Shopify
    const response = await fetch(
      `https://${shop}/admin/api/2025-01/recurring_application_charges/${charge_id}.json`,
      {
        headers: {
          'X-Shopify-Access-Token': accessToken,
          'Content-Type': 'application/json',
        },
      }
    );

    if (!response.ok) {
      return res.redirect('/dashboard?error=charge_not_found');
    }

    const data = await response.json();
    const charge = data.recurring_application_charge;

    if (charge.status === 'active') {
      // Subscription approved! Activate it.
      
      // For charges that need activation (status === 'accepted'), 
      // you need to activate them:
      // POST /admin/api/2025-01/recurring_application_charges/{charge_id}/activate.json
      
      // But if already 'active', just update our database
      await pool.query(`
        UPDATE shops 
        SET plan = $1, updated_at = NOW()
        WHERE shopify_domain = $2
      `, [plan || determinePlanFromPrice(charge.price), shop]);

      res.redirect('/dashboard?upgraded=true');
      
    } else if (charge.status === 'accepted') {
      // Need to activate the charge
      const activateResponse = await fetch(
        `https://${shop}/admin/api/2025-01/recurring_application_charges/${charge_id}/activate.json`,
        {
          method: 'POST',
          headers: {
            'X-Shopify-Access-Token': accessToken,
            'Content-Type': 'application/json',
          },
        }
      );

      if (activateResponse.ok) {
        await pool.query(`
          UPDATE shops 
          SET plan = $1, updated_at = NOW()
          WHERE shopify_domain = $2
        `, [plan || determinePlanFromPrice(charge.price), shop]);

        res.redirect('/dashboard?upgraded=true');
      } else {
        res.redirect('/dashboard?error=activation_failed');
      }
      
    } else if (charge.status === 'declined') {
      res.redirect('/dashboard?error=declined');
      
    } else {
      // pending, expired, etc.
      res.redirect(`/dashboard?error=charge_status_${charge.status}`);
    }

  } catch (error) {
    console.error('Confirm billing error:', error);
    res.redirect('/dashboard?error=confirmation_failed');
  }
});

/**
 * Cancel subscription
 * POST /api/billing/cancel
 * 
 * Note: This cancels the subscription in Shopify and downgrades in our DB.
 * Per Shopify docs, deleting a charge cancels it.
 */
router.post('/cancel', authMiddleware, async (req, res) => {
  try {
    const { shopId, shop, accessToken, plan } = req.shopify;

    if (plan === 'free') {
      return res.status(400).json({ error: 'Already on free plan' });
    }

    // Find active subscription
    const listResponse = await fetch(
      `https://${shop}/admin/api/2025-01/recurring_application_charges.json`,
      {
        headers: {
          'X-Shopify-Access-Token': accessToken,
          'Content-Type': 'application/json',
        },
      }
    );

    if (!listResponse.ok) {
      return res.status(500).json({ error: 'Failed to fetch subscriptions' });
    }

    const listData = await listResponse.json();
    const activeCharge = listData.recurring_application_charges?.find(
      c => c.status === 'active'
    );

    if (activeCharge) {
      // Delete (cancel) the charge
      const deleteResponse = await fetch(
        `https://${shop}/admin/api/2025-01/recurring_application_charges/${activeCharge.id}.json`,
        {
          method: 'DELETE',
          headers: {
            'X-Shopify-Access-Token': accessToken,
          },
        }
      );

      if (!deleteResponse.ok && deleteResponse.status !== 404) {
        console.error('Failed to delete charge');
      }
    }

    // Downgrade to free in our database
    await pool.query(
      'UPDATE shops SET plan = $1, updated_at = NOW() WHERE id = $2',
      ['free', shopId]
    );

    res.json({ success: true, message: 'Subscription cancelled, downgraded to free plan' });

  } catch (error) {
    console.error('Cancel subscription error:', error);
    res.status(500).json({ error: 'Failed to cancel subscription' });
  }
});

/**
 * Webhook: Handle subscription updates from Shopify
 * POST /api/billing/webhook
 * 
 * Topics to subscribe to:
 * - app_subscriptions/update
 * - app_subscriptions/cancelled
 */
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const hmac = req.get('X-Shopify-Hmac-Sha256');
  const topic = req.get('X-Shopify-Topic');
  const shop = req.get('X-Shopify-Shop-Domain');
  
  // Verify webhook signature
  const crypto = require('crypto');
  const generatedHmac = crypto
    .createHmac('sha256', process.env.SHOPIFY_API_SECRET)
    .update(req.body)
    .digest('base64');
  
  if (hmac !== generatedHmac) {
    return res.status(401).json({ error: 'Invalid webhook signature' });
  }

  const payload = JSON.parse(req.body.toString());

  try {
    if (topic === 'app_subscriptions/update') {
      // Handle subscription status change
      const { app_subscription } = payload;
      const status = app_subscription?.status;
      
      if (status === 'CANCELLED' || status === 'EXPIRED') {
        await pool.query(
          'UPDATE shops SET plan = $1 WHERE shopify_domain = $2',
          ['free', shop]
        );
      }
    }

    res.status(200).json({ received: true });
    
  } catch (error) {
    console.error('Webhook processing error:', error);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

/**
 * Determine plan from price
 */
function determinePlanFromPrice(price) {
  const numPrice = parseFloat(price);
  if (numPrice >= 79) return 'pro';
  if (numPrice >= 29) return 'starter';
  return 'free';
}

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
      price: 0,
    },
    starter: {
      angles_per_month: 30,
      copies_per_month: -1,
      video_scripts: true,
      teleprompter: true,
      price: 29,
    },
    pro: {
      angles_per_month: -1,
      copies_per_month: -1,
      video_scripts: true,
      teleprompter: true,
      price: 79,
    },
  };
  return limits[plan] || limits.free;
}

module.exports = router;
