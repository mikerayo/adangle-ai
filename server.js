require('dotenv').config();
const express = require('express');
const session = require('express-session');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Allow Shopify iframe embedding
app.use((req, res, next) => {
  const shop = req.query.shop || req.session?.shop || '';
  // Allow embedding from Shopify admin
  res.setHeader('Content-Security-Policy', `frame-ancestors https://*.myshopify.com https://admin.shopify.com;`);
  res.removeHeader('X-Frame-Options');
  next();
});

// CORS - Allow all origins for Shopify iframe
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Accept, Authorization');
  
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});
// Capture raw body for webhook verification
app.use(express.json({
  verify: (req, res, buf) => {
    req.rawBody = buf.toString();
  }
}));
app.use(express.urlencoded({ extended: true }));

app.use(session({
  secret: process.env.SESSION_SECRET || 'dev-secret',
  resave: false,
  saveUninitialized: true,
  cookie: { 
    secure: false, // Set to false for now to debug
    httpOnly: true,
    sameSite: 'none',
    maxAge: 24 * 60 * 60 * 1000,
  },
}));

// Capture shop from query params (Shopify passes this)
app.use((req, res, next) => {
  if (req.query.shop) {
    req.session.shop = req.query.shop;
  }
  next();
});

// Static files
app.use(express.static(path.join(__dirname, 'public')));

// Health check
app.get('/health', async (req, res) => {
  try {
    const { pool } = require('./src/config/database');
    const result = await pool.query('SELECT NOW()');
    res.json({ status: 'ok', db: 'connected', time: result.rows[0].now });
  } catch (e) {
    res.json({ status: 'ok', db: 'error', error: e.message });
  }
});

// API Routes
app.use('/api/auth', require('./src/routes/auth'));
app.use('/api/products', require('./src/routes/products'));
app.use('/api/angles', require('./src/routes/angles'));
app.use('/api/generate', require('./src/routes/generate'));
app.use('/api/billing', require('./src/routes/billing'));
app.use('/api/webhooks', require('./src/routes/webhooks'));

// SPA fallback - serve index.html with shop context
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'Not found' });
  }
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start server
app.listen(PORT, '0.0.0.0', async () => {
  console.log(`🎯 AdAngle AI running on port ${PORT}`);
  
  // Init DB
  try {
    const { initDB } = require('./src/config/database');
    await initDB();
    console.log('✅ Database ready');
  } catch (e) {
    console.error('❌ DB error:', e.message);
  }
});
