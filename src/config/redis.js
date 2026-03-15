/**
 * Redis Configuration
 * Used for: Sessions, Job Queue, Caching
 * 
 * For $5M+ scale: Redis Cluster or Redis Sentinel for HA
 */

const Redis = require('ioredis');

// Connection options with retry logic
const redisOptions = {
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT) || 6379,
  password: process.env.REDIS_PASSWORD || undefined,
  db: parseInt(process.env.REDIS_DB) || 0,
  
  // Connection retry
  retryStrategy: (times) => {
    if (times > 10) {
      console.error('Redis: Max retries reached, giving up');
      return null;
    }
    const delay = Math.min(times * 100, 3000);
    console.log(`Redis: Retrying connection in ${delay}ms...`);
    return delay;
  },
  
  // Performance
  enableReadyCheck: true,
  maxRetriesPerRequest: 3,
  
  // TLS for production (Railway, Upstash, etc.)
  ...(process.env.REDIS_TLS === 'true' && { tls: {} }),
};

// Parse REDIS_URL if provided (common in PaaS)
let redis;
if (process.env.REDIS_URL) {
  redis = new Redis(process.env.REDIS_URL, {
    maxRetriesPerRequest: 3,
    retryStrategy: redisOptions.retryStrategy,
  });
} else {
  redis = new Redis(redisOptions);
}

// Event handlers
redis.on('connect', () => {
  console.log('✅ Redis connected');
});

redis.on('error', (err) => {
  console.error('❌ Redis error:', err.message);
});

redis.on('close', () => {
  console.log('⚠️ Redis connection closed');
});

/**
 * Cache wrapper with automatic JSON serialization
 */
const cache = {
  async get(key) {
    const value = await redis.get(key);
    if (!value) return null;
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  },

  async set(key, value, ttlSeconds = 3600) {
    const serialized = typeof value === 'string' ? value : JSON.stringify(value);
    if (ttlSeconds) {
      await redis.setex(key, ttlSeconds, serialized);
    } else {
      await redis.set(key, serialized);
    }
  },

  async del(key) {
    await redis.del(key);
  },

  async exists(key) {
    return await redis.exists(key);
  },

  // Rate limiting helper
  async rateLimit(key, limit, windowSeconds) {
    const current = await redis.incr(key);
    if (current === 1) {
      await redis.expire(key, windowSeconds);
    }
    return {
      allowed: current <= limit,
      current,
      limit,
      remaining: Math.max(0, limit - current),
    };
  },
};

module.exports = { redis, cache, redisOptions };
