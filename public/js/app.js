/**
 * AdAngle AI - Frontend Application
 * Premium UI for Shopify Ad Copy Generation
 */

// ============================================
// State Management
// ============================================

const state = {
  authenticated: false,
  shop: null,
  usage: null,
  limits: null,
  products: [],
  selectedProduct: null,
  angles: [],
  selectedAngle: null,
  copies: [],
  videoScript: null,
  loading: {
    products: false,
    angles: false,
    copies: false,
    script: false,
  },
  currentPage: 'dashboard',
  teleprompterActive: false,
  teleprompterText: '',
};

// ============================================
// API Functions
// ============================================

const api = {
  async get(endpoint) {
    const res = await fetch(`/api${endpoint}`);
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  },

  async post(endpoint, data) {
    const res = await fetch(`/api${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const error = await res.json();
      throw new Error(error.error || 'Request failed');
    }
    return res.json();
  },

  // Auth
  async getSession() {
    return this.get('/auth/session');
  },

  // Products
  async getProducts() {
    return this.get('/products');
  },

  async getProduct(id) {
    return this.get(`/products/${id}`);
  },

  // Angles
  async discoverAngles(productId) {
    return this.post('/angles/discover', { productId });
  },

  async getAngles(productId) {
    return this.get(`/angles/${productId}`);
  },

  // Generate
  async generateCopies(angleId) {
    return this.post('/generate/copies', { angleId });
  },

  async generateVideoScript(angleId) {
    return this.post('/generate/video-script', { angleId });
  },

  async getCopies(angleId) {
    return this.get(`/generate/copies/${angleId}`);
  },

  // Billing
  async getBillingStatus() {
    return this.get('/billing/status');
  },

  async subscribe(plan) {
    return this.post('/billing/subscribe', { plan });
  },
};

// ============================================
// Render Functions
// ============================================

function render() {
  const app = document.getElementById('app');
  
  if (!state.authenticated) {
    app.innerHTML = renderLoginPage();
    return;
  }
  
  app.innerHTML = `
    <div class="app-container">
      ${renderSidebar()}
      <main class="main-content">
        ${renderHeader()}
        <div class="main-body">
          ${renderPage()}
        </div>
      </main>
    </div>
    ${renderToasts()}
    ${state.teleprompterActive ? renderTeleprompter() : ''}
  `;
  
  attachEventListeners();
}

function renderLoginPage() {
  return `
    <div style="min-height: 100vh; display: flex; align-items: center; justify-content: center; background: linear-gradient(135deg, #6366F1 0%, #10B981 100%);">
      <div class="card" style="width: 100%; max-width: 400px; margin: 20px;">
        <div class="card-body" style="text-align: center; padding: 48px 32px;">
          <div style="font-size: 48px; margin-bottom: 16px;">🎯</div>
          <h1 style="font-size: 24px; font-weight: 700; margin-bottom: 8px;">AdAngle AI</h1>
          <p style="color: var(--gray-500); margin-bottom: 32px;">Find the perfect angle to sell any product</p>
          <a href="/api/auth?shop=${getShopFromUrl()}" class="btn btn-primary btn-lg w-full">
            Connect Shopify Store
          </a>
          <p style="margin-top: 24px; font-size: 14px; color: var(--gray-400);">
            Trusted by 5,000+ Shopify merchants
          </p>
        </div>
      </div>
    </div>
  `;
}

function renderSidebar() {
  return `
    <aside class="sidebar">
      <div class="sidebar-header">
        <a href="#" class="sidebar-logo" onclick="navigate('dashboard')">
          <div class="sidebar-logo-icon">🎯</div>
          <span class="sidebar-logo-text">AdAngle AI</span>
        </a>
      </div>
      
      <nav class="sidebar-nav">
        <div class="nav-section">
          <div class="nav-section-title">Main</div>
          <a class="nav-item ${state.currentPage === 'dashboard' ? 'active' : ''}" onclick="navigate('dashboard')">
            <span class="nav-item-icon">📊</span>
            Dashboard
          </a>
          <a class="nav-item ${state.currentPage === 'products' ? 'active' : ''}" onclick="navigate('products')">
            <span class="nav-item-icon">📦</span>
            Products
          </a>
          <a class="nav-item ${state.currentPage === 'angles' ? 'active' : ''}" onclick="navigate('angles')">
            <span class="nav-item-icon">🎯</span>
            My Angles
          </a>
        </div>
        
        <div class="nav-section">
          <div class="nav-section-title">Tools</div>
          <a class="nav-item ${state.currentPage === 'teleprompter' ? 'active' : ''}" onclick="navigate('teleprompter')">
            <span class="nav-item-icon">🎬</span>
            Teleprompter
          </a>
        </div>
        
        <div class="nav-section">
          <div class="nav-section-title">Account</div>
          <a class="nav-item ${state.currentPage === 'billing' ? 'active' : ''}" onclick="navigate('billing')">
            <span class="nav-item-icon">💳</span>
            Billing
          </a>
        </div>
      </nav>
      
      <div class="sidebar-footer">
        <div class="plan-badge ${state.shop?.plan === 'pro' ? 'pro' : ''}">
          <span>${state.shop?.plan === 'free' ? '🆓' : state.shop?.plan === 'starter' ? '⭐' : '👑'}</span>
          <span>${state.shop?.plan?.toUpperCase() || 'FREE'} Plan</span>
        </div>
      </div>
    </aside>
  `;
}

function renderHeader() {
  const titles = {
    dashboard: 'Dashboard',
    products: 'Your Products',
    angles: 'Discovered Angles',
    product: state.selectedProduct?.title || 'Product',
    generate: 'Generate Copy',
    billing: 'Billing & Plans',
    teleprompter: 'Teleprompter',
  };
  
  return `
    <header class="main-header">
      <h1 class="page-title">${titles[state.currentPage] || 'AdAngle AI'}</h1>
      <div class="flex items-center gap-4">
        <span class="text-sm text-gray-500">${state.shop?.domain || ''}</span>
      </div>
    </header>
  `;
}

function renderPage() {
  switch (state.currentPage) {
    case 'dashboard':
      return renderDashboard();
    case 'products':
      return renderProducts();
    case 'product':
      return renderProductDetail();
    case 'generate':
      return renderGenerate();
    case 'billing':
      return renderBilling();
    case 'teleprompter':
      return renderTeleprompterSetup();
    default:
      return renderDashboard();
  }
}

function renderDashboard() {
  return `
    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-label">Products Analyzed</div>
        <div class="stat-value primary">${state.products.filter(p => p.angles_discovered > 0).length}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Angles Discovered</div>
        <div class="stat-value">${state.usage?.angles_discovered || 0}</div>
        ${state.limits?.angles_per_month > 0 ? `<div class="text-sm text-gray-400">of ${state.limits.angles_per_month} this month</div>` : ''}
      </div>
      <div class="stat-card">
        <div class="stat-label">Copies Generated</div>
        <div class="stat-value">${state.usage?.copies_generated || 0}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Current Plan</div>
        <div class="stat-value">${state.shop?.plan?.toUpperCase() || 'FREE'}</div>
      </div>
    </div>
    
    <div class="card">
      <div class="card-header">
        <h2 class="card-title">Quick Start</h2>
      </div>
      <div class="card-body">
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 24px;">
          <div style="text-align: center; padding: 24px;">
            <div style="font-size: 48px; margin-bottom: 16px;">1️⃣</div>
            <h3 style="font-weight: 600; margin-bottom: 8px;">Select a Product</h3>
            <p style="color: var(--gray-500); font-size: 14px;">Choose any product from your Shopify store</p>
          </div>
          <div style="text-align: center; padding: 24px;">
            <div style="font-size: 48px; margin-bottom: 16px;">2️⃣</div>
            <h3 style="font-weight: 600; margin-bottom: 8px;">Discover Angles</h3>
            <p style="color: var(--gray-500); font-size: 14px;">AI finds 10 unique ways to sell your product</p>
          </div>
          <div style="text-align: center; padding: 24px;">
            <div style="font-size: 48px; margin-bottom: 16px;">3️⃣</div>
            <h3 style="font-weight: 600; margin-bottom: 8px;">Generate Copy</h3>
            <p style="color: var(--gray-500); font-size: 14px;">Get 5 ad variations for each angle</p>
          </div>
        </div>
        <div style="text-align: center; margin-top: 24px;">
          <button class="btn btn-primary btn-lg" onclick="navigate('products')">
            🚀 Get Started
          </button>
        </div>
      </div>
    </div>
  `;
}

function renderProducts() {
  if (state.loading.products) {
    return `
      <div class="products-grid">
        ${[1,2,3,4,5,6].map(() => `
          <div class="product-card">
            <div class="product-image"><div class="skeleton" style="width: 100%; height: 100%;"></div></div>
            <div class="product-info">
              <div class="skeleton" style="height: 20px; width: 80%; margin-bottom: 8px;"></div>
              <div class="skeleton" style="height: 16px; width: 40%;"></div>
            </div>
          </div>
        `).join('')}
      </div>
    `;
  }
  
  if (state.products.length === 0) {
    return `
      <div class="empty-state">
        <div class="empty-state-icon">📦</div>
        <h2 class="empty-state-title">No Products Found</h2>
        <p class="empty-state-description">Add products to your Shopify store to start discovering sales angles.</p>
      </div>
    `;
  }
  
  return `
    <div class="products-grid">
      ${state.products.map(product => `
        <div class="product-card" onclick="selectProduct('${product.shopify_product_id}')">
          <div class="product-image">
            ${product.image_url 
              ? `<img src="${product.image_url}" alt="${product.title}">`
              : '<div style="display: flex; align-items: center; justify-content: center; height: 100%; font-size: 48px;">📦</div>'
            }
          </div>
          <div class="product-info">
            <h3 class="product-title">${product.title}</h3>
            <div class="product-price">
              <span class="product-price-current">$${product.price}</span>
              ${product.compare_at_price ? `<span class="product-price-compare">$${product.compare_at_price}</span>` : ''}
            </div>
            <div class="product-angles-badge ${product.angles_discovered > 0 ? '' : 'empty'}">
              ${product.angles_discovered > 0 
                ? `✨ ${product.angles_discovered} angles discovered`
                : '🔍 No angles yet'
              }
            </div>
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

function renderProductDetail() {
  const product = state.selectedProduct;
  if (!product) return '';
  
  return `
    <div class="flex gap-6" style="margin-bottom: 32px;">
      <div style="width: 120px; height: 120px; border-radius: 12px; overflow: hidden; background: var(--gray-100);">
        ${product.image_url 
          ? `<img src="${product.image_url}" alt="${product.title}" style="width: 100%; height: 100%; object-fit: cover;">`
          : '<div style="display: flex; align-items: center; justify-content: center; height: 100%; font-size: 48px;">📦</div>'
        }
      </div>
      <div style="flex: 1;">
        <h2 style="font-size: 1.5rem; font-weight: 700; margin-bottom: 8px;">${product.title}</h2>
        <div class="product-price" style="margin-bottom: 16px;">
          <span class="product-price-current" style="font-size: 1.5rem;">$${product.price}</span>
          ${product.compare_at_price ? `<span class="product-price-compare">$${product.compare_at_price}</span>` : ''}
        </div>
        <button class="btn btn-primary" onclick="discoverAngles('${product.shopify_product_id}')" ${state.loading.angles ? 'disabled' : ''}>
          ${state.loading.angles ? '⏳ Discovering...' : '🎯 Discover Sales Angles'}
        </button>
      </div>
    </div>
    
    ${state.angles.length > 0 ? `
      <h3 style="font-size: 1.25rem; font-weight: 600; margin-bottom: 16px;">
        🎯 ${state.angles.length} Sales Angles Discovered
      </h3>
      <div class="angles-grid">
        ${state.angles.map(angle => `
          <div class="angle-card ${state.selectedAngle?.id === angle.id ? 'selected' : ''}" onclick="selectAngle(${angle.id})">
            <div class="angle-header">
              <span class="angle-name">${angle.name}</span>
              <span class="angle-emotion">${angle.emotion}</span>
            </div>
            <div class="angle-audience">👤 ${angle.audience}</div>
            <div class="angle-hook">"${angle.hook}"</div>
            <div class="angle-actions">
              <button class="btn btn-primary btn-sm" onclick="event.stopPropagation(); generateCopies(${angle.id})">
                ✨ Generate Copy
              </button>
              <button class="btn btn-secondary btn-sm" onclick="event.stopPropagation(); generateScript(${angle.id})">
                🎬 Video Script
              </button>
            </div>
          </div>
        `).join('')}
      </div>
    ` : `
      <div class="empty-state">
        <div class="empty-state-icon">🎯</div>
        <h2 class="empty-state-title">No Angles Discovered Yet</h2>
        <p class="empty-state-description">Click "Discover Sales Angles" to find 10 unique ways to sell this product.</p>
      </div>
    `}
  `;
}

function renderGenerate() {
  const angle = state.selectedAngle;
  if (!angle) return '';
  
  return `
    <button class="btn btn-ghost mb-4" onclick="navigate('product')">
      ← Back to Angles
    </button>
    
    <div class="card mb-6">
      <div class="card-body">
        <div class="flex items-center gap-4 mb-4">
          <span class="angle-emotion">${angle.emotion}</span>
          <h2 style="font-size: 1.25rem; font-weight: 700;">${angle.name}</h2>
        </div>
        <p style="color: var(--gray-600); margin-bottom: 8px;">👤 ${angle.audience}</p>
        <div class="angle-hook">"${angle.hook}"</div>
      </div>
    </div>
    
    <div class="flex gap-4 mb-6">
      <button class="btn btn-primary" onclick="generateCopies(${angle.id})" ${state.loading.copies ? 'disabled' : ''}>
        ${state.loading.copies ? '⏳ Generating...' : '✨ Generate 5 Ad Copies'}
      </button>
      <button class="btn btn-secondary" onclick="generateScript(${angle.id})" ${state.loading.script ? 'disabled' : ''}>
        ${state.loading.script ? '⏳ Creating...' : '🎬 Video Script'}
      </button>
    </div>
    
    ${state.copies.length > 0 ? `
      <h3 style="font-size: 1.125rem; font-weight: 600; margin-bottom: 16px;">Generated Ad Copies</h3>
      <div class="copies-container">
        ${state.copies.map((copy, i) => `
          <div class="copy-card">
            <div class="copy-header">
              <div class="copy-style">
                <span class="copy-style-badge">${copy.style}</span>
                <span class="copy-model">${copy.model_used?.split('/').pop() || 'AI'}</span>
              </div>
              <button class="btn btn-ghost btn-sm" onclick="copyToClipboard(\`${escapeHtml(copy.content)}\`)">
                📋 Copy
              </button>
            </div>
            <div class="copy-content">${escapeHtml(copy.content)}</div>
          </div>
        `).join('')}
      </div>
    ` : ''}
    
    ${state.videoScript ? `
      <h3 style="font-size: 1.125rem; font-weight: 600; margin: 24px 0 16px;">Video Script</h3>
      <div class="script-container">
        <div class="script-header">
          <span class="script-title">🎬 30-Second UGC Script</span>
          <div class="flex gap-2">
            <button class="btn btn-ghost btn-sm" style="color: white;" onclick="copyToClipboard(\`${escapeHtml(state.videoScript.content)}\`)">
              📋 Copy
            </button>
            <button class="btn btn-primary btn-sm" onclick="openTeleprompter(\`${escapeHtml(state.videoScript.content)}\`)">
              📱 Teleprompter
            </button>
          </div>
        </div>
        <div class="script-content">${escapeHtml(state.videoScript.content)}</div>
      </div>
    ` : ''}
  `;
}

function renderBilling() {
  return `
    <div class="stats-grid mb-8">
      <div class="stat-card">
        <div class="stat-label">Current Plan</div>
        <div class="stat-value primary">${state.shop?.plan?.toUpperCase() || 'FREE'}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Angles This Month</div>
        <div class="stat-value">${state.usage?.angles_discovered || 0}${state.limits?.angles_per_month > 0 ? ` / ${state.limits.angles_per_month}` : ''}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Copies Generated</div>
        <div class="stat-value">${state.usage?.copies_generated || 0}</div>
      </div>
    </div>
    
    <h2 style="font-size: 1.5rem; font-weight: 700; text-align: center; margin-bottom: 8px;">Choose Your Plan</h2>
    <p style="text-align: center; color: var(--gray-500); margin-bottom: 32px;">Scale your ad creation with the right plan for you</p>
    
    <div class="pricing-grid">
      <div class="pricing-card ${state.shop?.plan === 'free' ? 'popular' : ''}">
        ${state.shop?.plan === 'free' ? '<div class="pricing-popular-badge">Current</div>' : ''}
        <h3 class="pricing-name">Free</h3>
        <div class="pricing-price">$0<span>/month</span></div>
        <p class="pricing-description">Perfect for trying out</p>
        <div class="pricing-features">
          <div class="pricing-feature"><span class="pricing-feature-icon">✅</span> 3 angle discoveries/month</div>
          <div class="pricing-feature"><span class="pricing-feature-icon">✅</span> 15 copies/month</div>
          <div class="pricing-feature"><span class="pricing-feature-icon">❌</span> Video scripts</div>
          <div class="pricing-feature"><span class="pricing-feature-icon">❌</span> Teleprompter</div>
        </div>
        <button class="btn btn-outline w-full" disabled>Current Plan</button>
      </div>
      
      <div class="pricing-card ${state.shop?.plan === 'starter' ? 'popular' : ''}">
        ${state.shop?.plan === 'starter' ? '<div class="pricing-popular-badge">Current</div>' : ''}
        <h3 class="pricing-name">Starter</h3>
        <div class="pricing-price">$29<span>/month</span></div>
        <p class="pricing-description">For growing stores</p>
        <div class="pricing-features">
          <div class="pricing-feature"><span class="pricing-feature-icon">✅</span> 30 angle discoveries/month</div>
          <div class="pricing-feature"><span class="pricing-feature-icon">✅</span> Unlimited copies</div>
          <div class="pricing-feature"><span class="pricing-feature-icon">✅</span> Video scripts</div>
          <div class="pricing-feature"><span class="pricing-feature-icon">✅</span> Teleprompter</div>
        </div>
        <button class="btn ${state.shop?.plan === 'starter' ? 'btn-outline' : 'btn-primary'} w-full" 
                onclick="subscribe('starter')" ${state.shop?.plan === 'starter' ? 'disabled' : ''}>
          ${state.shop?.plan === 'starter' ? 'Current Plan' : 'Upgrade to Starter'}
        </button>
      </div>
      
      <div class="pricing-card ${state.shop?.plan === 'pro' ? 'popular' : ''}">
        ${state.shop?.plan !== 'pro' ? '<div class="pricing-popular-badge">Most Popular</div>' : '<div class="pricing-popular-badge">Current</div>'}
        <h3 class="pricing-name">Pro</h3>
        <div class="pricing-price">$79<span>/month</span></div>
        <p class="pricing-description">For serious sellers</p>
        <div class="pricing-features">
          <div class="pricing-feature"><span class="pricing-feature-icon">✅</span> Unlimited angle discoveries</div>
          <div class="pricing-feature"><span class="pricing-feature-icon">✅</span> Unlimited copies</div>
          <div class="pricing-feature"><span class="pricing-feature-icon">✅</span> Video scripts</div>
          <div class="pricing-feature"><span class="pricing-feature-icon">✅</span> Teleprompter</div>
          <div class="pricing-feature"><span class="pricing-feature-icon">✅</span> Priority support</div>
        </div>
        <button class="btn ${state.shop?.plan === 'pro' ? 'btn-outline' : 'btn-success'} w-full"
                onclick="subscribe('pro')" ${state.shop?.plan === 'pro' ? 'disabled' : ''}>
          ${state.shop?.plan === 'pro' ? 'Current Plan' : 'Upgrade to Pro'}
        </button>
      </div>
    </div>
  `;
}

function renderTeleprompterSetup() {
  return `
    <div class="card">
      <div class="card-header">
        <h2 class="card-title">🎬 Teleprompter Mode</h2>
      </div>
      <div class="card-body">
        <p style="color: var(--gray-600); margin-bottom: 24px;">
          Paste your script below or generate one from an angle, then use teleprompter mode to record your UGC video.
        </p>
        <textarea 
          id="teleprompter-input"
          style="width: 100%; min-height: 200px; padding: 16px; border: 2px solid var(--gray-200); border-radius: 8px; font-size: 16px; line-height: 1.6; resize: vertical;"
          placeholder="Paste your video script here..."
        >${state.teleprompterText}</textarea>
        <div style="margin-top: 16px;">
          <button class="btn btn-primary btn-lg" onclick="startTeleprompter()">
            ▶️ Start Teleprompter
          </button>
        </div>
      </div>
    </div>
  `;
}

function renderTeleprompter() {
  return `
    <div class="teleprompter-overlay">
      <div class="teleprompter-controls">
        <button class="btn btn-secondary" onclick="adjustSpeed(-0.5)">🐢 Slower</button>
        <span style="color: white; font-weight: 600;">Speed: <span id="teleprompter-speed">2</span>x</span>
        <button class="btn btn-secondary" onclick="adjustSpeed(0.5)">🐇 Faster</button>
        <button class="btn btn-primary" onclick="toggleTeleprompter()">⏯️ Play/Pause</button>
        <button class="btn btn-ghost" style="color: white;" onclick="closeTeleprompter()">✕ Close</button>
      </div>
      <div class="teleprompter-content">
        <div class="teleprompter-text" id="teleprompter-text">
          ${escapeHtml(state.teleprompterText)}
        </div>
      </div>
    </div>
  `;
}

function renderToasts() {
  return `<div class="toast-container" id="toast-container"></div>`;
}

// ============================================
// Actions
// ============================================

async function init() {
  try {
    const session = await api.getSession();
    if (session.authenticated) {
      state.authenticated = true;
      state.shop = session.shop;
      state.usage = session.usage;
      state.limits = session.limits;
      await loadProducts();
    }
  } catch (e) {
    console.log('Not authenticated');
  }
  render();
}

function navigate(page) {
  state.currentPage = page;
  
  if (page === 'products' && state.products.length === 0) {
    loadProducts();
  }
  
  render();
}

async function loadProducts() {
  state.loading.products = true;
  render();
  
  try {
    const data = await api.getProducts();
    state.products = data.products;
  } catch (e) {
    showToast('Failed to load products', 'error');
  }
  
  state.loading.products = false;
  render();
}

async function selectProduct(productId) {
  state.loading.angles = true;
  state.currentPage = 'product';
  render();
  
  try {
    const data = await api.getProduct(productId);
    state.selectedProduct = data.product;
    state.angles = data.angles;
  } catch (e) {
    showToast('Failed to load product', 'error');
  }
  
  state.loading.angles = false;
  render();
}

async function discoverAngles(productId) {
  state.loading.angles = true;
  render();
  
  try {
    const data = await api.discoverAngles(productId);
    state.angles = data.angles;
    state.usage.angles_discovered++;
    showToast(`🎯 ${data.angles.length} sales angles discovered!`, 'success');
  } catch (e) {
    showToast(e.message || 'Failed to discover angles', 'error');
  }
  
  state.loading.angles = false;
  render();
}

function selectAngle(angleId) {
  state.selectedAngle = state.angles.find(a => a.id === angleId);
  state.copies = [];
  state.videoScript = null;
  state.currentPage = 'generate';
  render();
}

async function generateCopies(angleId) {
  state.loading.copies = true;
  state.selectedAngle = state.angles.find(a => a.id === angleId);
  state.currentPage = 'generate';
  render();
  
  try {
    const data = await api.generateCopies(angleId);
    state.copies = data.copies;
    showToast('✨ 5 ad copies generated!', 'success');
  } catch (e) {
    showToast(e.message || 'Failed to generate copies', 'error');
  }
  
  state.loading.copies = false;
  render();
}

async function generateScript(angleId) {
  state.loading.script = true;
  state.selectedAngle = state.angles.find(a => a.id === angleId);
  state.currentPage = 'generate';
  render();
  
  try {
    const data = await api.generateVideoScript(angleId);
    state.videoScript = data.script;
    showToast('🎬 Video script created!', 'success');
  } catch (e) {
    showToast(e.message || 'Failed to generate script', 'error');
  }
  
  state.loading.script = false;
  render();
}

async function subscribe(plan) {
  try {
    const data = await api.subscribe(plan);
    if (data.confirmationUrl) {
      window.location.href = data.confirmationUrl;
    }
  } catch (e) {
    showToast('Failed to start subscription', 'error');
  }
}

function copyToClipboard(text) {
  navigator.clipboard.writeText(text).then(() => {
    showToast('📋 Copied to clipboard!', 'success');
  });
}

function openTeleprompter(text) {
  state.teleprompterText = text;
  state.teleprompterActive = true;
  render();
}

function startTeleprompter() {
  const input = document.getElementById('teleprompter-input');
  if (input && input.value.trim()) {
    state.teleprompterText = input.value;
    state.teleprompterActive = true;
    render();
  } else {
    showToast('Please enter a script first', 'error');
  }
}

function closeTeleprompter() {
  state.teleprompterActive = false;
  render();
}

let teleprompterPlaying = false;
let teleprompterSpeed = 2;
let teleprompterPosition = 0;
let teleprompterInterval = null;

function toggleTeleprompter() {
  teleprompterPlaying = !teleprompterPlaying;
  
  if (teleprompterPlaying) {
    teleprompterInterval = setInterval(() => {
      teleprompterPosition += teleprompterSpeed;
      const el = document.getElementById('teleprompter-text');
      if (el) {
        el.style.transform = `translateY(-${teleprompterPosition}px)`;
      }
    }, 50);
  } else {
    clearInterval(teleprompterInterval);
  }
}

function adjustSpeed(delta) {
  teleprompterSpeed = Math.max(0.5, Math.min(5, teleprompterSpeed + delta));
  const el = document.getElementById('teleprompter-speed');
  if (el) el.textContent = teleprompterSpeed;
}

function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;
  
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  
  setTimeout(() => toast.remove(), 4000);
}

// ============================================
// Utilities
// ============================================

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML.replace(/'/g, "\\'").replace(/"/g, '\\"');
}

function getShopFromUrl() {
  const params = new URLSearchParams(window.location.search);
  return params.get('shop') || '';
}

function attachEventListeners() {
  // Add any dynamic event listeners here
}

// ============================================
// Initialize
// ============================================

document.addEventListener('DOMContentLoaded', init);
