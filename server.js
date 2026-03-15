require('dotenv').config();
const express = require('express');
const session = require('express-session');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware básico
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
  secret: process.env.SESSION_SECRET || 'dev-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { 
    secure: false,
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000,
  },
}));

// Static files
app.use(express.static(path.join(__dirname, 'public')));

// Health check - simple
app.get('/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// Test DB connection
app.get('/api/test-db', async (req, res) => {
  try {
    const { pool } = require('./src/config/database');
    const result = await pool.query('SELECT NOW()');
    res.json({ db: 'connected', time: result.rows[0].now });
  } catch (e) {
    res.json({ db: 'error', message: e.message });
  }
});

// API Routes (lazy load to avoid startup crash)
app.use('/api/auth', (req, res, next) => {
  const authRoutes = require('./src/routes/auth');
  authRoutes(req, res, next);
});

app.use('/api/products', (req, res, next) => {
  const routes = require('./src/routes/products');
  routes(req, res, next);
});

app.use('/api/angles', (req, res, next) => {
  const routes = require('./src/routes/angles');
  routes(req, res, next);
});

app.use('/api/generate', (req, res, next) => {
  const routes = require('./src/routes/generate');
  routes(req, res, next);
});

app.use('/api/billing', (req, res, next) => {
  const routes = require('./src/routes/billing');
  routes(req, res, next);
});

// SPA fallback
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'Not found' });
  }
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start immediately without waiting for DB
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🎯 AdAngle AI running on port ${PORT}`);
  
  // Init DB in background
  const { initDB } = require('./src/config/database');
  initDB()
    .then(() => console.log('✅ Database ready'))
    .catch(e => console.error('❌ DB init failed:', e.message));
});
