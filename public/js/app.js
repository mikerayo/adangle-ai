// AdAngle AI - Dark Premium UI

const API_BASE = window.location.origin;

// State
const state = {
  currentPage: 'dashboard',
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
  },
  showAddModal: false,
  stats: {
    products: 0,
    angles: 0,
    copies: 0,
  }
};

// Utils
function getShop() {
  const params = new URLSearchParams(window.location.search);
  return params.get('shop') || 's7ddqj-0v.myshopify.com';
}

function escapeHtml(text) {
  if (!text) return '';
  return String(text).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// API
async function apiGet(endpoint) {
  const res = await fetch(`${API_BASE}${endpoint}?shop=${getShop()}`);
  return res.json();
}

async function apiPost(endpoint, data) {
  const res = await fetch(`${API_BASE}${endpoint}?shop=${getShop()}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  return res.json();
}

// Render
function render() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="app-container">
      ${renderNav()}
      <main class="main-content">
        ${renderPage()}
      </main>
    </div>
    ${renderToasts()}
    ${state.showAddModal ? renderAddModal() : ''}
  `;
}

function renderNav() {
  return `
    <nav class="top-nav">
      <div class="nav-logo">
        <div class="nav-logo-icon">🎯</div>
        <span>AdAngle</span>
      </div>
      <div class="nav-links">
        <a class="nav-link ${state.currentPage === 'dashboard' ? 'active' : ''}" onclick="navigate('dashboard')">Dashboard</a>
        <a class="nav-link ${state.currentPage === 'products' ? 'active' : ''}" onclick="navigate('products')">Products</a>
      </div>
      <div class="nav-actions">
        <span style="color: var(--text-secondary); font-size: 13px;">Free Plan</span>
      </div>
    </nav>
  `;
}

function renderPage() {
  switch (state.currentPage) {
    case 'dashboard': return renderDashboard();
    case 'products': return renderProducts();
    case 'product': return renderProductDetail();
    case 'generate': return renderGenerate();
    default: return renderDashboard();
  }
}

function renderDashboard() {
  const topProduct = state.products[0];
  
  return `
    <div class="page-header">
      <h1 class="page-title">Dashboard</h1>
      <p class="page-subtitle">Your ad performance at a glance</p>
    </div>
    
    <div class="bento-grid">
      <div class="bento-card stat-card">
        <span class="stat-label">Products</span>
        <span class="stat-value blue">${state.stats.products}</span>
      </div>
      
      <div class="bento-card stat-card">
        <span class="stat-label">Angles Discovered</span>
        <span class="stat-value pink">${state.stats.angles}</span>
      </div>
      
      <div class="bento-card stat-card">
        <span class="stat-label">Copies Generated</span>
        <span class="stat-value purple">${state.stats.copies}</span>
      </div>
      
      <div class="bento-card stat-card">
        <span class="stat-label">Plan</span>
        <span class="stat-value green" style="font-size: 28px;">Free</span>
      </div>
      
      ${topProduct ? `
        <div class="bento-card span-2" style="cursor: pointer;" onclick="selectProduct(${topProduct.id})">
          <div class="product-card-large">
            <img src="${topProduct.image_url || 'https://via.placeholder.com/120'}" class="product-image-large" alt="">
            <div class="product-info-large">
              <h3>${escapeHtml(topProduct.title)}</h3>
              <div class="product-meta">
                <span>$${topProduct.price}</span>
                <span>•</span>
                <span>${topProduct.angles_discovered || 0} angles</span>
              </div>
              <button class="btn btn-secondary btn-sm" style="margin-top: 12px;">
                View Angles →
              </button>
            </div>
          </div>
        </div>
      ` : `
        <div class="bento-card span-2">
          <div class="empty-state" style="padding: 20px;">
            <p style="color: var(--text-secondary);">No products yet</p>
            <button class="btn btn-primary btn-sm" onclick="navigate('products')">Add Product</button>
          </div>
        </div>
      `}
      
      <div class="bento-card span-2">
        <h3 style="font-size: 16px; font-weight: 600; margin-bottom: 16px;">Quick Actions</h3>
        <div style="display: flex; gap: 12px; flex-wrap: wrap;">
          <button class="btn btn-secondary" onclick="navigate('products')">📦 View Products</button>
          <button class="btn btn-secondary" onclick="state.showAddModal = true; render();">➕ Add Product</button>
        </div>
      </div>
    </div>
  `;
}

function renderProducts() {
  if (state.loading.products) {
    return `<div class="loading"><div class="loading-spinner"></div> Loading products...</div>`;
  }
  
  return `
    <div class="page-header" style="display: flex; justify-content: space-between; align-items: center;">
      <div>
        <h1 class="page-title">Products</h1>
        <p class="page-subtitle">${state.products.length} products loaded</p>
      </div>
      <button class="btn btn-primary" onclick="state.showAddModal = true; render();">+ Add Product</button>
    </div>
    
    ${state.products.length === 0 ? `
      <div class="empty-state">
        <div class="empty-icon">📦</div>
        <h2>No Products Yet</h2>
        <p>Add your first product to start discovering winning ad angles</p>
        <button class="btn btn-primary" onclick="state.showAddModal = true; render();">+ Add Product</button>
      </div>
    ` : `
      <div class="products-grid">
        ${state.products.map(p => `
          <div class="product-card" onclick="selectProduct(${p.id})">
            <img src="${p.image_url || 'https://via.placeholder.com/280x180'}" class="product-card-image" alt="">
            <div class="product-card-body">
              <div class="product-card-title">${escapeHtml(p.title)}</div>
              <div class="product-card-price">$${p.price}</div>
              <div class="product-card-angles">${p.angles_discovered || 0} angles discovered</div>
            </div>
          </div>
        `).join('')}
      </div>
    `}
  `;
}

function renderProductDetail() {
  const p = state.selectedProduct;
  if (!p) return `<div class="loading"><div class="loading-spinner"></div> Loading...</div>`;
  
  return `
    <a class="back-link" onclick="navigate('products')">← Back to Products</a>
    
    <div class="generate-header">
      <img src="${p.image_url || 'https://via.placeholder.com/80'}" class="generate-product-image" alt="">
      <div class="generate-info">
        <h1>${escapeHtml(p.title)}</h1>
        <p style="color: var(--text-secondary);">$${p.price}</p>
      </div>
      <button class="btn btn-primary" onclick="discoverAngles(${p.id})" style="margin-left: auto;" ${state.loading.angles ? 'disabled' : ''}>
        ${state.loading.angles ? '⏳ Discovering...' : '🔍 Discover Angles'}
      </button>
    </div>
    
    ${state.loading.angles ? `
      <div class="loading"><div class="loading-spinner"></div> AI is analyzing your product...</div>
    ` : state.angles.length === 0 ? `
      <div class="empty-state">
        <div class="empty-icon">🎯</div>
        <h2>No Angles Yet</h2>
        <p>Click "Discover Angles" to find winning ad angles for this product</p>
      </div>
    ` : `
      <h2 class="section-title">🎯 ${state.angles.length} Sales Angles</h2>
      <div class="angles-grid">
        ${state.angles.map(a => `
          <div class="angle-card">
            <div class="angle-header">
              <span class="angle-name">${escapeHtml(a.name)}</span>
              <span class="angle-emotion">${escapeHtml(a.emotion)}</span>
            </div>
            <div class="angle-hook">"${escapeHtml(a.hook)}"</div>
            <div class="angle-details">
              <div class="angle-detail">
                <span class="angle-detail-label">Audience</span>
                ${escapeHtml(a.audience)}
              </div>
              <div class="angle-detail">
                <span class="angle-detail-label">Pain Point</span>
                ${escapeHtml(a.pain_point)}
              </div>
            </div>
            <div class="angle-actions">
              <button class="btn btn-primary btn-sm" onclick="generateCopies(${a.id})">Generate Copies</button>
              <button class="btn btn-secondary btn-sm" onclick="generateScript(${a.id})">Video Script</button>
            </div>
          </div>
        `).join('')}
      </div>
    `}
  `;
}

function renderGenerate() {
  const p = state.selectedProduct;
  const a = state.selectedAngle;
  
  if (!p || !a) return `<div class="loading">Loading...</div>`;
  
  return `
    <a class="back-link" onclick="navigate('product')">← Back to ${escapeHtml(p.title)}</a>
    
    <div class="generate-header">
      <img src="${p.image_url || 'https://via.placeholder.com/80'}" class="generate-product-image" alt="">
      <div class="generate-info">
        <h1>${escapeHtml(p.title)}</h1>
        <p class="generate-angle">Angle: ${escapeHtml(a.name)}</p>
      </div>
    </div>
    
    ${state.loading.copies ? `
      <div class="loading"><div class="loading-spinner"></div> AI is generating copies...</div>
    ` : `
      ${state.copies.length > 0 ? `
        <h2 class="section-title">📝 Generated Ad Copies</h2>
        <div class="copies-container">
          ${state.copies.map((c, i) => `
            <div class="copy-card">
              <div class="copy-header">
                <span class="copy-style">${escapeHtml(c.style)}</span>
                <button class="btn btn-ghost btn-sm" onclick="copyToClipboard(${i})">📋 Copy</button>
              </div>
              <div class="copy-content">${escapeHtml(c.content)}</div>
            </div>
          `).join('')}
        </div>
      ` : ''}
      
      ${state.videoScript ? `
        <h2 class="section-title" style="margin-top: 32px;">🎬 Video Script</h2>
        <div class="script-card">
          <div style="display: flex; justify-content: space-between; margin-bottom: 16px;">
            <span style="color: var(--accent-blue); font-size: 13px; font-weight: 600;">30-SECOND UGC SCRIPT</span>
            <button class="btn btn-ghost btn-sm" onclick="copyScript()">📋 Copy</button>
          </div>
          <pre class="script-content">${escapeHtml(state.videoScript.content || state.videoScript)}</pre>
        </div>
      ` : ''}
      
      ${!state.copies.length && !state.videoScript ? `
        <div class="empty-state">
          <p>Select an action to generate content</p>
        </div>
      ` : ''}
    `}
  `;
}

function renderAddModal() {
  return `
    <div class="modal-overlay" onclick="closeModal()">
      <div class="modal" onclick="event.stopPropagation()">
        <div class="modal-header">
          <h2>Add Product</h2>
          <button class="modal-close" onclick="closeModal()">×</button>
        </div>
        <div class="modal-body">
          <div class="form-group">
            <label>Store Domain</label>
            <input type="text" id="store-url" class="input" placeholder="yourstore.myshopify.com">
            <small style="color: var(--text-muted); font-size: 12px; margin-top: 4px; display: block;">
              Enter any Shopify store to import all products
            </small>
          </div>
          <button class="btn btn-primary" onclick="importFromStore()" style="width: 100%;">
            📦 Import All Products
          </button>
          
          <div style="text-align: center; margin: 20px 0; color: var(--text-muted); font-size: 13px;">
            — or add manually —
          </div>
          
          <div class="form-group">
            <label>Product Name</label>
            <input type="text" id="product-title" class="input" placeholder="Product name">
          </div>
          <div class="form-group">
            <label>Description</label>
            <textarea id="product-description" class="input" rows="2" placeholder="Describe your product..."></textarea>
          </div>
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
            <div class="form-group">
              <label>Price</label>
              <input type="number" id="product-price" class="input" placeholder="39.99">
            </div>
            <div class="form-group">
              <label>Compare Price</label>
              <input type="number" id="product-compare" class="input" placeholder="79.99">
            </div>
          </div>
          <button class="btn btn-secondary" onclick="addProductManually()" style="width: 100%;">
            Add Manually
          </button>
        </div>
      </div>
    </div>
  `;
}

function renderToasts() {
  return '<div id="toast-container" class="toast-container"></div>';
}

// Actions
async function loadProducts() {
  state.loading.products = true;
  render();
  
  try {
    const data = await apiGet('/api/products');
    state.products = data.products || [];
    state.stats.products = state.products.length;
    state.stats.angles = state.products.reduce((sum, p) => sum + (p.angles_discovered || 0), 0);
  } catch (e) {
    console.error('Load products error:', e);
    state.products = [];
  }
  
  state.loading.products = false;
  render();
}

async function selectProduct(id) {
  const product = state.products.find(p => p.id === id);
  state.selectedProduct = product;
  state.angles = [];
  state.currentPage = 'product';
  render();
  
  // Load angles for this product
  try {
    const data = await apiGet(`/api/products/${id}`);
    if (data.angles) {
      state.angles = data.angles;
    }
  } catch (e) {
    console.error('Load angles error:', e);
  }
  
  render();
}

async function discoverAngles(productId) {
  state.loading.angles = true;
  render();
  
  try {
    const data = await apiPost('/api/angles/discover', { productId });
    if (data.angles) {
      state.angles = data.angles;
      state.stats.angles += data.angles.length;
      showToast(`Discovered ${data.angles.length} angles!`, 'success');
    } else {
      showToast(data.error || 'Failed to discover angles', 'error');
    }
  } catch (e) {
    showToast('Failed to discover angles', 'error');
  }
  
  state.loading.angles = false;
  render();
}

async function generateCopies(angleId) {
  const angle = state.angles.find(a => a.id === angleId);
  state.selectedAngle = angle;
  state.copies = [];
  state.videoScript = null;
  state.currentPage = 'generate';
  state.loading.copies = true;
  render();
  
  try {
    const data = await apiPost('/api/generate/copies', { angleId });
    if (data.copies) {
      state.copies = data.copies;
      state.stats.copies += data.copies.length;
      showToast(`Generated ${data.copies.length} ad copies!`, 'success');
    } else {
      showToast(data.error || 'Failed to generate copies', 'error');
    }
  } catch (e) {
    showToast('Failed to generate copies', 'error');
  }
  
  state.loading.copies = false;
  render();
}

async function generateScript(angleId) {
  const angle = state.angles.find(a => a.id === angleId);
  state.selectedAngle = angle;
  state.copies = [];
  state.videoScript = null;
  state.currentPage = 'generate';
  state.loading.copies = true;
  render();
  
  try {
    const data = await apiPost('/api/generate/video-script', { angleId });
    if (data.script) {
      state.videoScript = data.script;
      showToast('Video script generated!', 'success');
    } else {
      showToast(data.error || 'Failed to generate script', 'error');
    }
  } catch (e) {
    showToast('Failed to generate script', 'error');
  }
  
  state.loading.copies = false;
  render();
}

async function importFromStore() {
  const storeInput = document.getElementById('store-url');
  const store = storeInput?.value?.trim();
  
  if (!store) {
    showToast('Please enter a store domain', 'error');
    return;
  }
  
  showToast('Importing products...', 'info');
  
  try {
    const data = await apiPost('/api/products/import-store', { store });
    if (data.success) {
      showToast(`Imported ${data.count} products!`, 'success');
      closeModal();
      loadProducts();
    } else {
      showToast(data.error || 'Import failed', 'error');
    }
  } catch (e) {
    showToast('Import failed', 'error');
  }
}

async function addProductManually() {
  const title = document.getElementById('product-title')?.value?.trim();
  const description = document.getElementById('product-description')?.value?.trim();
  const price = document.getElementById('product-price')?.value;
  const compare = document.getElementById('product-compare')?.value;
  
  if (!title) {
    showToast('Product name is required', 'error');
    return;
  }
  
  try {
    const data = await apiPost('/api/products', {
      title,
      description,
      price: parseFloat(price) || 0,
      compare_at_price: parseFloat(compare) || null,
    });
    
    if (data.product) {
      showToast('Product added!', 'success');
      closeModal();
      loadProducts();
    } else {
      showToast(data.error || 'Failed to add product', 'error');
    }
  } catch (e) {
    showToast('Failed to add product', 'error');
  }
}

function navigate(page) {
  state.currentPage = page;
  if (page === 'products') {
    loadProducts();
  }
  render();
}

function closeModal() {
  state.showAddModal = false;
  render();
}

function copyToClipboard(index) {
  const copy = state.copies[index];
  if (copy) {
    navigator.clipboard.writeText(copy.content);
    showToast('Copied to clipboard!', 'success');
  }
}

function copyScript() {
  const script = state.videoScript?.content || state.videoScript;
  if (script) {
    navigator.clipboard.writeText(script);
    showToast('Script copied!', 'success');
  }
}

function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;
  
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  
  setTimeout(() => toast.remove(), 3000);
}

// Init
async function init() {
  render();
  await loadProducts();
}

document.addEventListener('DOMContentLoaded', init);
