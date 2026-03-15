/**
 * Shopify API Service
 * Handles all interactions with Shopify stores
 * 
 * API Reference: https://shopify.dev/docs/api/admin-rest/2025-01
 */

const API_VERSION = '2025-01';

/**
 * Make authenticated request to Shopify Admin API
 */
async function shopifyFetch(shop, accessToken, endpoint, options = {}) {
  const url = `https://${shop}/admin/api/${API_VERSION}${endpoint}`;
  
  const response = await fetch(url, {
    ...options,
    headers: {
      'X-Shopify-Access-Token': accessToken,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      ...options.headers,
    },
  });

  // Handle rate limiting
  if (response.status === 429) {
    const retryAfter = response.headers.get('Retry-After') || 2;
    await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
    return shopifyFetch(shop, accessToken, endpoint, options);
  }

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Shopify API error (${response.status}): ${error}`);
  }

  return response.json();
}

/**
 * Get all products from a shop
 * Reference: https://shopify.dev/docs/api/admin-rest/2025-01/resources/product#get-products
 */
async function getProducts(shop, accessToken, options = {}) {
  const params = new URLSearchParams({
    limit: options.limit || 50,
    status: 'active',
    fields: 'id,title,body_html,product_type,tags,images,variants',
    ...options.params,
  });

  const data = await shopifyFetch(
    shop, 
    accessToken, 
    `/products.json?${params.toString()}`
  );
  
  // Transform products to our format
  return data.products.map(product => ({
    shopify_product_id: product.id.toString(),
    title: product.title,
    description: stripHtml(product.body_html || ''),
    price: parseFloat(product.variants[0]?.price || 0),
    compare_at_price: parseFloat(product.variants[0]?.compare_at_price || 0) || null,
    image_url: product.images[0]?.src || null,
    category: product.product_type || null,
    tags: product.tags,
    data: product,
  }));
}

/**
 * Get single product details
 * Reference: https://shopify.dev/docs/api/admin-rest/2025-01/resources/product#get-products-product-id
 */
async function getProduct(shop, accessToken, productId) {
  const data = await shopifyFetch(
    shop, 
    accessToken, 
    `/products/${productId}.json`
  );
  
  const product = data.product;
  
  return {
    shopify_product_id: product.id.toString(),
    title: product.title,
    description: stripHtml(product.body_html || ''),
    price: parseFloat(product.variants[0]?.price || 0),
    compare_at_price: parseFloat(product.variants[0]?.compare_at_price || 0) || null,
    image_url: product.images[0]?.src || null,
    category: product.product_type || null,
    tags: product.tags,
    variants: product.variants,
    data: product,
  };
}

/**
 * Get shop details
 * Reference: https://shopify.dev/docs/api/admin-rest/2025-01/resources/shop
 */
async function getShop(shop, accessToken) {
  const data = await shopifyFetch(shop, accessToken, '/shop.json');
  return data.shop;
}

/**
 * Create recurring application charge (subscription)
 * Reference: https://shopify.dev/docs/api/admin-rest/2025-01/resources/recurringapplicationcharge
 */
async function createSubscription(shop, accessToken, plan) {
  const plans = {
    starter: { name: 'AdAngle Starter', price: 29.00 },
    pro: { name: 'AdAngle Pro', price: 79.00 },
  };

  const selectedPlan = plans[plan];
  if (!selectedPlan) throw new Error('Invalid plan');

  const data = await shopifyFetch(
    shop, 
    accessToken, 
    '/recurring_application_charges.json',
    {
      method: 'POST',
      body: JSON.stringify({
        recurring_application_charge: {
          name: selectedPlan.name,
          price: selectedPlan.price,
          return_url: `${process.env.SHOPIFY_HOST}/api/billing/confirm?plan=${plan}`,
          trial_days: 7,
          test: process.env.NODE_ENV !== 'production',
        },
      }),
    }
  );

  return data.recurring_application_charge;
}

/**
 * Get subscription status
 */
async function getSubscriptionStatus(shop, accessToken) {
  const data = await shopifyFetch(
    shop, 
    accessToken, 
    '/recurring_application_charges.json'
  );

  const activeCharge = data.recurring_application_charges?.find(
    charge => charge.status === 'active'
  );

  return activeCharge || null;
}

/**
 * Activate a subscription charge
 * Required when status is 'accepted'
 */
async function activateSubscription(shop, accessToken, chargeId) {
  const data = await shopifyFetch(
    shop, 
    accessToken, 
    `/recurring_application_charges/${chargeId}/activate.json`,
    { method: 'POST' }
  );

  return data.recurring_application_charge;
}

/**
 * Cancel/delete a subscription charge
 */
async function cancelSubscription(shop, accessToken, chargeId) {
  await shopifyFetch(
    shop, 
    accessToken, 
    `/recurring_application_charges/${chargeId}.json`,
    { method: 'DELETE' }
  );

  return true;
}

/**
 * Register webhooks
 * Reference: https://shopify.dev/docs/api/admin-rest/2025-01/resources/webhook
 */
async function registerWebhooks(shop, accessToken, webhooks) {
  const results = [];
  
  for (const webhook of webhooks) {
    try {
      const data = await shopifyFetch(
        shop, 
        accessToken, 
        '/webhooks.json',
        {
          method: 'POST',
          body: JSON.stringify({
            webhook: {
              topic: webhook.topic,
              address: webhook.address,
              format: 'json',
            },
          }),
        }
      );
      results.push({ topic: webhook.topic, success: true, id: data.webhook.id });
    } catch (error) {
      results.push({ topic: webhook.topic, success: false, error: error.message });
    }
  }
  
  return results;
}

/**
 * Strip HTML tags from string
 */
function stripHtml(html) {
  if (!html) return '';
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

module.exports = {
  shopifyFetch,
  getProducts,
  getProduct,
  getShop,
  createSubscription,
  getSubscriptionStatus,
  activateSubscription,
  cancelSubscription,
  registerWebhooks,
  stripHtml,
  API_VERSION,
};
