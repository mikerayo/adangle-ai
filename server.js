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
  res.setHeader('Content-Security-Policy', `frame-ancestors https://${shop} https://admin.shopify.com;`);
  res.removeHeader('X-Frame-Options');
  next();
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
  secret: process.env.SESSION_SECRET || 'dev-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { 
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: 'none',
    maxAge: 24 * 60 * 60 * 1000,
  },
}));

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

// SPA fallback
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
