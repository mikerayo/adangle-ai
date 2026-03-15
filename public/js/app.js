/**
 * AdAngle AI - Frontend Application
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
  showAddProduct: false,
};

// Get shop from URL
function getShop() {
  const params = new URLSearchParams(window.location.search);
  return params.get('shop') || '';
}

// ============================================
// API Functions
// ============================================

const api = {
  async get(endpoint) {
    const shop = getShop();
    const sep = endpoint.includes('?') ? '&' : '?';
    const res = await fetch(`/api${endpoint}${sep}shop=${shop}`);
    if (!res.ok) {
      const text = await res.text();
      throw new Error(text);
    }
    return res.json();
  },

  async post(endpoint, data) {
    const shop = getShop();
    const res = await fetch(`/api${endpoint}?shop=${shop}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const error = await res.json().catch(() => ({ error: 'Request failed' }));
      throw new Error(error.error || 'Request failed');
    }
    return res.json();
  },
};

// ============================================
// Render Functions
// ============================================

function render() {
  const app = document.getElementById('app');
  if (!app) return;
  
  if (!state.authenticated) {
    app.innerHTML = renderLoginPage();
    return;
  }
  
  app.innerHTML = `
    <div class="app-layout">
      ${renderSidebar()}
      <main class="main-content">
        ${renderHeader()}
        <div class="main-body">
          ${renderPage()}
        </div>
      </main>
    </div>
    ${renderToasts()}
    ${state.showAddProduct ? renderAddProductModal() : ''}
  `;
  
  attachEventListeners();
}

function renderLoginPage() {
  return `
    <div style="min-height: 100vh; display: flex; align-items: center; justify-content: center; background: linear-gradient(135deg, #6366F1 0%, #10B981 100%);">
      <div style="background: white; border-radius: 16px; padding: 48px; text-align: center; max-width: 400px; margin: 20px; box-shadow: 0 20px 60px rgba(0,0,0,0.2);">
        <div style="font-size: 48px; margin-bottom: 16px;">🎯</div>
        <h1 style="font-size: 24px; font-weight: 700; margin-bottom: 8px; color: #111;">AdAngle AI</h1>
        <p style="color: #666; margin-bottom: 32px;">Find the perfect angle to sell any product</p>
        <p style="color: #999; font-size: 14px;">Please install this app from Shopify Admin</p>
      </div>
    </div>
  `;
}

function renderSidebar() {
  return `
    <aside class="sidebar">
      <div class="sidebar-header">
        <div class="logo">🎯 <span>AdAngle AI</span></div>
      </div>
      <nav class="sidebar-nav">
        <a class="nav-item ${state.currentPage === 'dashboard' ? 'active' : ''}" onclick="navigate('dashboard')">
          📊 Dashboard
        </a>
        <a class="nav-item ${state.currentPage === 'products' ? 'active' : ''}" onclick="navigate('products')">
          📦 Products
        </a>
        <a class="nav-item ${state.currentPage === 'teleprompter' ? 'active' : ''}" onclick="navigate('teleprompter')">
          🎬 Teleprompter
        </a>
      </nav>
      <div class="sidebar-footer">
        <div class="plan-badge">🆓 FREE Plan</div>
      </div>
    </aside>
  `;
}

function renderHeader() {
  return `
    <header class="header">
      <h1 class="page-title">${getPageTitle()}</h1>
      <div class="header-right">${state.shop?.domain || getShop()}</div>
    </header>
  `;
}

function getPageTitle() {
  const titles = {
    dashboard: 'Dashboard',
    products: 'Your Products',
    product: state.selectedProduct?.title || 'Product',
    generate: 'Generate Copy',
    teleprompter: 'Teleprompter',
  };
  return titles[state.currentPage] || 'AdAngle AI';
}

function renderPage() {
  switch (state.currentPage) {
    case 'dashboard': return renderDashboard();
    case 'products': return renderProducts();
    case 'product': return renderProductDetail();
    case 'generate': return renderGenerate();
    case 'teleprompter': return renderTeleprompterPage();
    default: return renderDashboard();
  }
}

function renderDashboard() {
  return `
    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-icon">📦</div>
        <div class="stat-value">${state.products.length}</div>
        <div class="stat-label">Products</div>
      </div>
      <div class="stat-card">
        <div class="stat-icon">🎯</div>
        <div class="stat-value">${state.usage?.angles_discovered || 0}</div>
        <div class="stat-label">Angles Discovered</div>
      </div>
      <div class="stat-card">
        <div class="stat-icon">✨</div>
        <div class="stat-value">${state.usage?.copies_generated || 0}</div>
        <div class="stat-label">Copies Generated</div>
      </div>
    </div>
    
    <div class="card">
      <div class="card-header">
        <h2>🚀 Quick Start</h2>
      </div>
      <div class="card-body">
        <div class="steps">
          <div class="step">
            <div class="step-number">1</div>
            <div class="step-content">
              <h3>Add a Product</h3>
              <p>Add products you want to create ads for</p>
            </div>
          </div>
          <div class="step">
            <div class="step-number">2</div>
            <div class="step-content">
              <h3>Discover Angles</h3>
              <p>AI finds 10 unique ways to sell your product</p>
            </div>
          </div>
          <div class="step">
            <div class="step-number">3</div>
            <div class="step-content">
              <h3>Generate Copy</h3>
              <p>Get 5 ad variations for each angle</p>
            </div>
          </div>
        </div>
        <button class="btn btn-primary btn-lg" onclick="navigate('products')" style="margin-top: 24px;">
          Get Started →
        </button>
      </div>
    </div>
  `;
}

function renderProducts() {
  return `
    <div class="products-header">
      <button class="btn btn-primary" onclick="showAddProductModal()">
        + Add Product
      </button>
    </div>
    
    ${state.loading.products ? `
      <div class="loading">Loading products...</div>
    ` : state.products.length === 0 ? `
      <div class="empty-state">
        <div class="empty-icon">📦</div>
        <h2>No Products Yet</h2>
        <p>Add your first product to start discovering sales angles</p>
        <button class="btn btn-primary" onclick="showAddProductModal()">
          + Add Product
        </button>
      </div>
    ` : `
      <div class="products-grid">
        ${state.products.map(p => `
          <div class="product-card" onclick="selectProduct(${p.id})">
            <div class="product-image">
              ${p.image_url ? `<img src="${p.image_url}" alt="${p.title}">` : '📦'}
            </div>
            <div class="product-info">
              <h3 class="product-title">${p.title}</h3>
              <div class="product-price">$${p.price || 0}</div>
              <div class="product-angles">
                ${p.angles_discovered > 0 ? `✨ ${p.angles_discovered} angles` : '🔍 No angles yet'}
              </div>
            </div>
          </div>
        `).join('')}
      </div>
    `}
  `;
}

function renderProductDetail() {
  const p = state.selectedProduct;
  if (!p) return '<div class="loading">Loading...</div>';
  
  return `
    <button class="btn btn-ghost" onclick="navigate('products')">← Back</button>
    
    <div class="product-detail">
      <div class="product-header">
        <div class="product-image-large">
          ${p.image_url ? `<img src="${p.image_url}" alt="${p.title}">` : '📦'}
        </div>
        <div class="product-info-large">
          <h2>${p.title}</h2>
          <div class="product-price-large">$${p.price || 0}</div>
          <p class="product-description">${p.description || 'No description'}</p>
          <button class="btn btn-primary btn-lg" onclick="discoverAngles(${p.id})" ${state.loading.angles ? 'disabled' : ''}>
            ${state.loading.angles ? '⏳ Discovering...' : '🎯 Discover Sales Angles'}
          </button>
        </div>
      </div>
    </div>
    
    ${state.angles.length > 0 ? `
      <h3 style="margin: 32px 0 16px;">🎯 ${state.angles.length} Sales Angles Discovered</h3>
      <div class="angles-grid">
        ${state.angles.map(a => `
          <div class="angle-card">
            <div class="angle-header">
              <span class="angle-name">${a.name}</span>
              <span class="angle-emotion">${a.emotion}</span>
            </div>
            <div class="angle-audience">👤 ${a.audience}</div>
            <div class="angle-hook">"${a.hook}"</div>
            <div class="angle-actions">
              <button class="btn btn-primary btn-sm" onclick="generateCopies(${a.id})">
                ✨ Generate Copy
              </button>
              <button class="btn btn-secondary btn-sm" onclick="generateScript(${a.id})">
                🎬 Script
              </button>
            </div>
          </div>
        `).join('')}
      </div>
    ` : ''}
  `;
}

function renderGenerate() {
  const a = state.selectedAngle;
  if (!a) return '';
  
  return `
    <button class="btn btn-ghost" onclick="navigate('product')">← Back to Angles</button>
    
    <div class="card" style="margin: 24px 0;">
      <div class="card-body">
        <div class="angle-detail">
          <span class="angle-emotion">${a.emotion}</span>
          <h2>${a.name}</h2>
          <p>👤 ${a.audience}</p>
          <p class="angle-hook">"${a.hook}"</p>
        </div>
      </div>
    </div>
    
    <div style="display: flex; gap: 12px; margin-bottom: 24px;">
      <button class="btn btn-primary" onclick="generateCopies(${a.id})" ${state.loading.copies ? 'disabled' : ''}>
        ${state.loading.copies ? '⏳ Generating...' : '✨ Generate 5 Ad Copies'}
      </button>
      <button class="btn btn-secondary" onclick="generateScript(${a.id})" ${state.loading.script ? 'disabled' : ''}>
        ${state.loading.script ? '⏳ Creating...' : '🎬 Video Script'}
      </button>
    </div>
    
    ${state.copies.length > 0 ? `
      <h3>Generated Ad Copies</h3>
      <div class="copies-list">
        ${state.copies.map(c => `
          <div class="copy-card">
            <div class="copy-header">
              <span class="copy-style">${c.style}</span>
              <button class="btn btn-ghost btn-sm" onclick="copyText(\`${escapeForJs(c.content)}\`)">📋 Copy</button>
            </div>
            <div class="copy-content">${escapeHtml(c.content)}</div>
          </div>
        `).join('')}
      </div>
    ` : ''}
    
    ${state.videoScript ? `
      <h3 style="margin-top: 24px;">🎬 Video Script</h3>
      <div class="script-card">
        <div class="script-header">
          <span>30-Second UGC Script</span>
          <div>
            <button class="btn btn-ghost btn-sm" onclick="copyText(\`${escapeForJs(state.videoScript.content || state.videoScript)}\`)">📋 Copy</button>
            <button class="btn btn-primary btn-sm" onclick="openTeleprompter(\`${escapeForJs(state.videoScript.content || state.videoScript)}\`)">📱 Teleprompter</button>
          </div>
        </div>
        <pre class="script-content">${escapeHtml(state.videoScript.content || state.videoScript)}</pre>
      </div>
    ` : ''}
  `;
}

function renderTeleprompterPage() {
  return `
    <div class="card">
      <div class="card-header">
        <h2>🎬 Teleprompter</h2>
      </div>
      <div class="card-body">
        <p style="color: #666; margin-bottom: 16px;">Paste your script and use teleprompter mode to record.</p>
        <textarea id="teleprompter-input" class="textarea" placeholder="Paste your script here..." rows="8">${state.teleprompterText}</textarea>
        <button class="btn btn-primary btn-lg" onclick="startTeleprompter()" style="margin-top: 16px;">
          ▶️ Start Teleprompter
        </button>
      </div>
    </div>
  `;
}

function renderAddProductModal() {
  return `
    <div class="modal-overlay" onclick="hideAddProductModal()">
      <div class="modal" onclick="event.stopPropagation()">
        <div class="modal-header">
          <h2>Add Product</h2>
          <button class="btn btn-ghost" onclick="hideAddProductModal()">✕</button>
        </div>
        <div class="modal-body">
          <div class="form-group">
            <label>Product Name *</label>
            <input type="text" id="product-title" class="input" placeholder="e.g., Back Stretcher">
          </div>
          <div class="form-group">
            <label>Description</label>
            <textarea id="product-description" class="textarea" rows="3" placeholder="Describe your product..."></textarea>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label>Price ($)</label>
              <input type="number" id="product-price" class="input" placeholder="29.99">
            </div>
            <div class="form-group">
              <label>Compare Price ($)</label>
              <input type="number" id="product-compare" class="input" placeholder="59.99">
            </div>
          </div>
          <div class="form-group">
            <label>Image URL</label>
            <input type="text" id="product-image" class="input" placeholder="https://...">
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" onclick="hideAddProductModal()">Cancel</button>
          <button class="btn btn-primary" onclick="addProduct()">Add Product</button>
        </div>
      </div>
    </div>
  `;
}

function renderToasts() {
  return '<div id="toast-container" class="toast-container"></div>';
}

// ============================================
// Actions
// ============================================

async function init() {
  const shop = getShop();
  
  if (shop) {
    state.authenticated = true;
    state.shop = { domain: shop, plan: 'free' };
    state.usage = { angles_discovered: 0, copies_generated: 0 };
    state.limits = { angles_per_month: 3, copies_per_month: 15 };
    
    render();
    
    // Register and load products in background
    api.get('/auth/register').catch(console.log);
    loadProducts().catch(console.log);
  } else {
    render();
  }
}

async function navigate(page) {
  state.currentPage = page;
  render();
  if (page === 'products') {
    await loadProducts();
  }
}

async function loadProducts() {
  console.log('loadProducts started');
  state.loading.products = true;
  render();
  
  try {
    const data = await api.get('/products');
    console.log('Products loaded:', data);
    state.products = data.products || [];
  } catch (e) {
    console.error('Load products error:', e);
    state.products = [];
  }
  
  state.loading.products = false;
  console.log('loadProducts finished, products:', state.products.length);
  render();
}

async function selectProduct(productId) {
  state.currentPage = 'product';
  state.loading.angles = true;
  render();
  
  try {
    const data = await api.get(`/products/${productId}`);
    state.selectedProduct = data.product;
    state.angles = data.angles || [];
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
    const data = await api.post('/angles/discover', { productId });
    state.angles = data.angles || [];
    showToast(`🎯 ${state.angles.length} sales angles discovered!`, 'success');
  } catch (e) {
    showToast(e.message || 'Failed to discover angles', 'error');
  }
  
  state.loading.angles = false;
  render();
}

async function generateCopies(angleId) {
  state.selectedAngle = state.angles.find(a => a.id === angleId);
  state.currentPage = 'generate';
  state.loading.copies = true;
  state.copies = [];
  render();
  
  try {
    const data = await api.post('/generate/copies', { angleId });
    state.copies = data.copies || [];
    showToast('✨ Ad copies generated!', 'success');
  } catch (e) {
    showToast(e.message || 'Failed to generate copies', 'error');
  }
  
  state.loading.copies = false;
  render();
}

async function generateScript(angleId) {
  state.selectedAngle = state.angles.find(a => a.id === angleId);
  state.currentPage = 'generate';
  state.loading.script = true;
  render();
  
  try {
    const data = await api.post('/generate/video-script', { angleId });
    state.videoScript = data.script;
    showToast('🎬 Video script created!', 'success');
  } catch (e) {
    showToast(e.message || 'Failed to generate script', 'error');
  }
  
  state.loading.script = false;
  render();
}

function showAddProductModal() {
  state.showAddProduct = true;
  render();
}

function hideAddProductModal() {
  state.showAddProduct = false;
  render();
}

async function addProduct() {
  const title = document.getElementById('product-title')?.value;
  const description = document.getElementById('product-description')?.value;
  const price = document.getElementById('product-price')?.value;
  const compare_at_price = document.getElementById('product-compare')?.value;
  const image_url = document.getElementById('product-image')?.value;
  
  if (!title) {
    showToast('Product name is required', 'error');
    return;
  }
  
  try {
    await api.post('/products', { title, description, price, compare_at_price, image_url });
    showToast('Product added!', 'success');
    hideAddProductModal();
    loadProducts();
  } catch (e) {
    showToast(e.message || 'Failed to add product', 'error');
  }
}

function copyText(text) {
  navigator.clipboard.writeText(text).then(() => {
    showToast('📋 Copied!', 'success');
  });
}

function openTeleprompter(text) {
  state.teleprompterText = text;
  state.currentPage = 'teleprompter';
  render();
}

function startTeleprompter() {
  const input = document.getElementById('teleprompter-input');
  if (input?.value) {
    state.teleprompterText = input.value;
    // Open fullscreen teleprompter
    const win = window.open('', '_blank');
    win.document.write(`
      <html>
      <head><title>Teleprompter</title></head>
      <body style="background:#000;color:#fff;font-size:32px;padding:40px;line-height:1.8;font-family:sans-serif;">
        <div id="text" style="transform:translateY(100vh);transition:transform 60s linear;">
          ${input.value.replace(/\n/g, '<br>')}
        </div>
        <script>
          setTimeout(() => document.getElementById('text').style.transform = 'translateY(-100%)', 100);
        </script>
      </body>
      </html>
    `);
  } else {
    showToast('Enter a script first', 'error');
  }
}

function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;
  
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  
  setTimeout(() => toast.remove(), 4000);
}

// ============================================
// Utilities
// ============================================

function escapeHtml(text) {
  if (!text) return '';
  return String(text).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function escapeForJs(text) {
  if (!text) return '';
  return String(text).replace(/\\/g,'\\\\').replace(/`/g,'\\`').replace(/\$/g,'\\$');
}

function attachEventListeners() {}

// ============================================
// Initialize
// ============================================

document.addEventListener('DOMContentLoaded', init);
