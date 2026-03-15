require('dotenv').config();
const express = require('express');
const session = require('express-session');
const RedisStore = require('connect-redis').default;
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const path = require('path');

// Config and services
const { initDB, healthCheck: dbHealthCheck, closePool } = require('./src/config/database');
const { redis, cache } = require('./src/config/redis');
const { startWorkers, getQueueStats } = require('./src/queues/aiQueue');

// Routes
const authRoutes = require('./src/routes/auth');
const productRoutes = require('./src/routes/products');
const angleRoutes = require('./src/routes/angles');
const generateRoutes = require('./src/routes/generate');
const billingRoutes = require('./src/routes/billing');

const app = express();

// Trust proxy for secure cookies behind reverse proxy
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

// ========================================
// SESSION CONFIGURATION - REDIS BACKED
// ========================================
// This is critical for scale - sessions survive restarts
// and work across multiple server instances

const redisStore = new RedisStore({
  client: redis,
  prefix: 'adangle:sess:',
  ttl: 86400, // 24 hours
});

app.use(session({
  store: redisStore,
  secret: process.env.SESSION_SECRET || 'adangle-dev-secret-change-in-production',
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

// ========================================
// RATE LIMITING (Redis-backed)
// ========================================

const rateLimiter = async (req, res, next) => {
  // Skip rate limiting for static assets
  if (!req.path.startsWith('/api/')) return next();
  
  const identifier = req.session?.shop || req.ip;
  const key = `ratelimit:${identifier}`;
  
  const { allowed, remaining } = await cache.rateLimit(key, 100, 60); // 100 req/min
  
  res.setHeader('X-RateLimit-Remaining', remaining);
  
  if (!allowed) {
    return res.status(429).json({ 
      error: 'Too many requests',
      retryAfter: 60,
    });
  }
  
  next();
};

app.use(rateLimiter);

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

// ========================================
// HEALTH & MONITORING ENDPOINTS
// ========================================

// Basic health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    version: '1.0.0',
  });
});

// Detailed health check (for monitoring/alerts)
app.get('/health/detailed', async (req, res) => {
  try {
    const [dbHealth, queueStats] = await Promise.all([
      dbHealthCheck(),
      getQueueStats(),
    ]);
    
    const redisHealth = redis.status === 'ready';
    
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      services: {
        database: dbHealth,
        redis: { 
          connected: redisHealth,
          status: redis.status,
        },
        queues: queueStats,
      },
    });
  } catch (error) {
    res.status(503).json({
      status: 'degraded',
      error: error.message,
    });
  }
});

// Queue stats (for admin dashboard)
app.get('/api/admin/queues', async (req, res) => {
  // TODO: Add admin auth
  const stats = await getQueueStats();
  res.json(stats);
});

// Shopify App Bridge host
app.get('/api/shopify/host', (req, res) => {
  res.json({ host: process.env.SHOPIFY_HOST });
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
  
  const message = process.env.NODE_ENV === 'production' 
    ? 'Internal server error' 
    : err.message;
  
  res.status(err.status || 500).json({ 
    error: message,
    ...(process.env.NODE_ENV !== 'production' && { stack: err.stack })
  });
});

// ========================================
// SERVER STARTUP
// ========================================

const PORT = process.env.PORT || 3000;
const WORKER_CONCURRENCY = parseInt(process.env.WORKER_CONCURRENCY) || 5;

async function startServer() {
  try {
    // 1. Initialize database
    await initDB();
    console.log('✅ Database initialized');
    
    // 2. Verify Redis connection
    await redis.ping();
    console.log('✅ Redis connected');
    
    // 3. Start AI workers (for async job processing)
    // In production, you might run workers in separate processes
    if (process.env.DISABLE_WORKERS !== 'true') {
      startWorkers(WORKER_CONCURRENCY);
    }
    
    // 4. Start HTTP server
    const server = app.listen(PORT, () => {
      console.log(`
🎯 =============================================
   AdAngle AI Server Started
   =============================================
   
   🌐 URL: http://localhost:${PORT}
   📦 Environment: ${process.env.NODE_ENV || 'development'}
   🔧 API Version: 2025-01
   👷 Workers: ${process.env.DISABLE_WORKERS === 'true' ? 'Disabled' : WORKER_CONCURRENCY}
   
   📋 Health Endpoints:
   - GET /health          - Basic health
   - GET /health/detailed - Full system status
   - GET /api/admin/queues - Queue stats
   
   🚀 Ready for scale: $5M MRR
   =============================================
      `);
    });

    // ========================================
    // GRACEFUL SHUTDOWN
    // ========================================
    
    const shutdown = async (signal) => {
      console.log(`\n${signal} received, shutting down gracefully...`);
      
      server.close(async () => {
        console.log('HTTP server closed');
        
        // Close Redis
        await redis.quit();
        console.log('Redis disconnected');
        
        // Close database pool
        await closePool();
        console.log('Database pool closed');
        
        process.exit(0);
      });
      
      // Force exit after 30 seconds
      setTimeout(() => {
        console.error('Forced shutdown after timeout');
        process.exit(1);
      }, 30000);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
    
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();

module.exports = app;
