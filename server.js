require('dotenv').config();
const express = require('express');
const session = require('express-session');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const path = require('path');

// Database
const { initDB, healthCheck: dbHealthCheck, closePool } = require('./src/config/database');

// Routes
const authRoutes = require('./src/routes/auth');
const productRoutes = require('./src/routes/products');
const angleRoutes = require('./src/routes/angles');
const generateRoutes = require('./src/routes/generate');
const billingRoutes = require('./src/routes/billing');

const app = express();

// Trust proxy
app.set('trust proxy', 1);

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.shopify.com"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "https:", "blob:"],
      connectSrc: ["'self'", "https://openrouter.ai"],
      frameAncestors: ["'self'", "https://*.myshopify.com", "https://admin.shopify.com"],
    },
  },
  crossOriginEmbedderPolicy: false,
}));

app.use(compression());
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
app.use(cors({
  origin: (origin, callback) => {
    if (!origin || 
        origin.endsWith('.myshopify.com') || 
        origin.includes('admin.shopify.com') ||
        origin === process.env.SHOPIFY_HOST) {
      callback(null, true);
    } else {
      callback(null, false);
    }
  },
  credentials: true
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Session (memory store for now - upgrade to Redis later for scale)
app.use(session({
  secret: process.env.SESSION_SECRET || 'adangle-dev-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { 
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: 'none',
    maxAge: 24 * 60 * 60 * 1000,
  },
  name: 'adangle.sid',
}));

// Static files
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: process.env.NODE_ENV === 'production' ? '1d' : 0,
  etag: true,
}));

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/products', productRoutes);
app.use('/api/angles', angleRoutes);
app.use('/api/generate', generateRoutes);
app.use('/api/billing', billingRoutes);

// Health check
app.get('/health', async (req, res) => {
  try {
    const dbHealth = await dbHealthCheck();
    res.json({ 
      status: 'ok', 
      timestamp: new Date().toISOString(),
      database: dbHealth.connected,
    });
  } catch (e) {
    res.json({ 
      status: 'degraded', 
      timestamp: new Date().toISOString(),
      error: e.message,
    });
  }
});

// SPA fallback
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'API endpoint not found' });
  }
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Error handling
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(err.status || 500).json({ error: 'Internal server error' });
});

// Start server
const PORT = process.env.PORT || 3000;

async function startServer() {
  try {
    await initDB();
    console.log('✅ Database initialized');
    
    app.listen(PORT, () => {
      console.log(`
🎯 AdAngle AI Server Started
   URL: http://localhost:${PORT}
   Environment: ${process.env.NODE_ENV || 'development'}
      `);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();

module.exports = app;
// Force rebuild Sun Mar 15 04:06:05 PM UTC 2026
