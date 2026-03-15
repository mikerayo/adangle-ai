/**
 * AI Job Queue
 * Handles async processing of AI requests for scale
 * 
 * Benefits:
 * - No timeouts on long AI requests
 * - Automatic retries on failure
 * - Rate limiting per shop
 * - Horizontal scaling (multiple workers)
 */

const { Queue, Worker, QueueEvents } = require('bullmq');
const { redis } = require('../config/redis');
const { discoverAnglesWithAI, generateCopiesWithAI, generateVideoScriptWithAI } = require('../services/openrouter');
const { pool } = require('../config/database');

// Queue configuration
const queueOptions = {
  connection: redis,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 2000,
    },
    removeOnComplete: {
      age: 3600, // Keep completed jobs for 1 hour
      count: 1000,
    },
    removeOnFail: {
      age: 24 * 3600, // Keep failed jobs for 24 hours
    },
  },
};

// Create queues
const angleQueue = new Queue('angle-discovery', queueOptions);
const copyQueue = new Queue('copy-generation', queueOptions);
const scriptQueue = new Queue('script-generation', queueOptions);

// Queue events for monitoring
const angleEvents = new QueueEvents('angle-discovery', { connection: redis });
const copyEvents = new QueueEvents('copy-generation', { connection: redis });

/**
 * Add angle discovery job
 */
async function queueAngleDiscovery(shopId, productId, productData) {
  const job = await angleQueue.add(
    'discover',
    { shopId, productId, productData },
    {
      jobId: `angles-${shopId}-${productId}-${Date.now()}`,
      priority: 1,
    }
  );
  return job;
}

/**
 * Add copy generation job
 */
async function queueCopyGeneration(shopId, angleId, angleData, productData) {
  const job = await copyQueue.add(
    'generate',
    { shopId, angleId, angleData, productData },
    {
      jobId: `copies-${shopId}-${angleId}-${Date.now()}`,
      priority: 2,
    }
  );
  return job;
}

/**
 * Add video script job
 */
async function queueVideoScript(shopId, angleId, angleData, productData) {
  const job = await scriptQueue.add(
    'generate',
    { shopId, angleId, angleData, productData },
    {
      jobId: `script-${shopId}-${angleId}-${Date.now()}`,
      priority: 3,
    }
  );
  return job;
}

/**
 * Get job status
 */
async function getJobStatus(queueName, jobId) {
  const queue = queueName === 'angles' ? angleQueue : 
                queueName === 'copies' ? copyQueue : scriptQueue;
  const job = await queue.getJob(jobId);
  
  if (!job) return null;
  
  const state = await job.getState();
  const progress = job.progress;
  
  return {
    id: job.id,
    state,
    progress,
    result: job.returnvalue,
    error: job.failedReason,
    attempts: job.attemptsMade,
    timestamp: job.timestamp,
  };
}

/**
 * Start workers (call this in server.js)
 */
function startWorkers(concurrency = 5) {
  // Angle Discovery Worker
  const angleWorker = new Worker(
    'angle-discovery',
    async (job) => {
      const { shopId, productId, productData } = job.data;
      
      job.updateProgress(10);
      
      // Call AI service
      const angles = await discoverAnglesWithAI(productData);
      
      job.updateProgress(80);
      
      // Save to database
      for (const angle of angles) {
        await pool.query(`
          INSERT INTO angles (shop_id, product_id, name, audience, pain_point, hook, objection, emotion)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        `, [shopId, productId, angle.name, angle.audience, angle.pain_point, angle.hook, angle.objection, angle.emotion]);
      }
      
      // Update usage
      await pool.query(`
        INSERT INTO usage (shop_id, month, angles_discovered)
        VALUES ($1, $2, 1)
        ON CONFLICT (shop_id, month)
        DO UPDATE SET angles_discovered = usage.angles_discovered + 1
      `, [shopId, new Date().toISOString().slice(0, 7)]);
      
      job.updateProgress(100);
      
      return { success: true, count: angles.length, angles };
    },
    { connection: redis, concurrency }
  );

  // Copy Generation Worker
  const copyWorker = new Worker(
    'copy-generation',
    async (job) => {
      const { shopId, angleId, angleData, productData } = job.data;
      
      job.updateProgress(10);
      
      // Generate copies with multiple models
      const copies = await generateCopiesWithAI(angleData, productData);
      
      job.updateProgress(80);
      
      // Save to database
      for (const copy of copies) {
        await pool.query(`
          INSERT INTO copies (angle_id, content, style, model_used)
          VALUES ($1, $2, $3, $4)
        `, [angleId, copy.content, copy.style, copy.model]);
      }
      
      // Update usage
      await pool.query(`
        INSERT INTO usage (shop_id, month, copies_generated)
        VALUES ($1, $2, $3)
        ON CONFLICT (shop_id, month)
        DO UPDATE SET copies_generated = usage.copies_generated + $3
      `, [shopId, new Date().toISOString().slice(0, 7), copies.length]);
      
      job.updateProgress(100);
      
      return { success: true, count: copies.length, copies };
    },
    { connection: redis, concurrency }
  );

  // Video Script Worker
  const scriptWorker = new Worker(
    'script-generation',
    async (job) => {
      const { shopId, angleId, angleData, productData } = job.data;
      
      job.updateProgress(10);
      
      const script = await generateVideoScriptWithAI(angleData, productData);
      
      job.updateProgress(80);
      
      // Save to database
      await pool.query(`
        INSERT INTO copies (angle_id, content, style, model_used)
        VALUES ($1, $2, 'video_script', $3)
      `, [angleId, script.content, script.model]);
      
      job.updateProgress(100);
      
      return { success: true, script };
    },
    { connection: redis, concurrency: 3 }
  );

  // Error handlers
  angleWorker.on('failed', (job, err) => {
    console.error(`Angle job ${job?.id} failed:`, err.message);
  });

  copyWorker.on('failed', (job, err) => {
    console.error(`Copy job ${job?.id} failed:`, err.message);
  });

  scriptWorker.on('failed', (job, err) => {
    console.error(`Script job ${job?.id} failed:`, err.message);
  });

  console.log(`✅ AI Workers started (concurrency: ${concurrency})`);

  return { angleWorker, copyWorker, scriptWorker };
}

/**
 * Get queue stats for monitoring
 */
async function getQueueStats() {
  const [angleStats, copyStats, scriptStats] = await Promise.all([
    angleQueue.getJobCounts(),
    copyQueue.getJobCounts(),
    scriptQueue.getJobCounts(),
  ]);

  return {
    angles: angleStats,
    copies: copyStats,
    scripts: scriptStats,
    total: {
      waiting: angleStats.waiting + copyStats.waiting + scriptStats.waiting,
      active: angleStats.active + copyStats.active + scriptStats.active,
      completed: angleStats.completed + copyStats.completed + scriptStats.completed,
      failed: angleStats.failed + copyStats.failed + scriptStats.failed,
    },
  };
}

module.exports = {
  angleQueue,
  copyQueue,
  scriptQueue,
  queueAngleDiscovery,
  queueCopyGeneration,
  queueVideoScript,
  getJobStatus,
  startWorkers,
  getQueueStats,
};
