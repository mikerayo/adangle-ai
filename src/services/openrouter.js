/**
 * OpenRouter Service - Direct https (no SDK/fetch)
 */

const https = require('https');

const OPENROUTER_BASE = 'https://openrouter.ai/api/v1';

// Models for different tasks
const MODELS = {
  discovery: 'anthropic/claude-3.5-sonnet',
  creative: 'anthropic/claude-3.5-sonnet',
  structured: 'openai/gpt-4o',
  fast: 'meta-llama/llama-3.1-70b-instruct',
  cheap: 'mistralai/mixtral-8x7b-instruct',
};

// Models available per plan
const PLAN_MODELS = {
  free: ['mistralai/mixtral-8x7b-instruct'],
  trial: ['mistralai/mixtral-8x7b-instruct'],
  starter: ['mistralai/mixtral-8x7b-instruct'],
  pro: ['anthropic/claude-3.5-sonnet', 'openai/gpt-4o', 'meta-llama/llama-3.1-70b-instruct'],
  unlimited: ['anthropic/claude-3.5-sonnet', 'openai/gpt-4o', 'meta-llama/llama-3.1-70b-instruct', 'mistralai/mixtral-8x7b-instruct'],
};

// Plan features
const PLAN_FEATURES = {
  free: { angles: 10, languages: ['en'], hookVariations: 1, priority: false, bulk: false },
  trial: { angles: 10, languages: ['en'], hookVariations: 1, priority: false, bulk: false },
  starter: { angles: 10, languages: ['en'], hookVariations: 1, priority: false, bulk: false },
  pro: { angles: 10, languages: ['en', 'es'], hookVariations: 1, priority: false, bulk: false },
  unlimited: { angles: 20, languages: ['en', 'es', 'fr', 'de', 'it', 'pt', 'nl'], hookVariations: 5, priority: true, bulk: true },
};

function getPlanFeatures(plan) {
  return PLAN_FEATURES[plan] || PLAN_FEATURES.free;
}

function getModelsForPlan(plan) {
  return PLAN_MODELS[plan] || PLAN_MODELS.free;
}

function getDiscoveryModel(plan) {
  const models = getModelsForPlan(plan);
  // Use best available model for discovery
  if (models.includes('anthropic/claude-3.5-sonnet')) return 'anthropic/claude-3.5-sonnet';
  return models[0];
}

function getCopyModels(plan) {
  const models = getModelsForPlan(plan);
  // Return up to 5 models, repeating if needed
  const result = [];
  for (let i = 0; i < 5; i++) {
    result.push(models[i % models.length]);
  }
  return result;
}

/**
 * Generate with specific model
 */
async function generate(model, prompt, options = {}) {
  console.log(`[AI] Calling ${model}...`);
  
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: model,
      messages: [{ role: 'user', content: prompt }],
      temperature: options.temperature || 0.8,
      max_tokens: options.maxTokens || 2000,
    });

    const req = https.request({
      hostname: 'openrouter.ai',
      path: '/api/v1/chat/completions',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'HTTP-Referer': process.env.SHOPIFY_HOST || 'https://adangle.ai',
        'X-Title': 'AdAngle AI',
      },
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            const json = JSON.parse(data);
            console.log(`[AI] ${model} completed`);
            resolve(json.choices[0].message.content);
          } catch (e) {
            reject(new Error('Invalid JSON from OpenRouter'));
          }
        } else {
          console.error(`[AI] ${model} error:`, data);
          reject(new Error(`OpenRouter error ${res.statusCode}: ${data.substring(0, 200)}`));
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(60000, () => {
      req.destroy();
      reject(new Error('OpenRouter timeout'));
    });
    
    req.write(body);
    req.end();
  });
}

/**
 * Discover 10 sales angles for a product
 */
async function discoverAngles(product, plan = 'free', options = {}) {
  const model = getDiscoveryModel(plan);
  const features = getPlanFeatures(plan);
  const numAngles = features.angles;
  const language = options.language || 'en';
  
  console.log(`[AI] Using ${model} for discovery (plan: ${plan}, angles: ${numAngles}, lang: ${language})`);
  
  const prompt = `You are an expert marketer and consumer psychologist specializing in direct response advertising.

PRODUCT TO ANALYZE:
Name: ${product.title}
Description: ${product.description || 'No description provided'}
Price: $${product.price}${product.compare_at_price ? ` (was $${product.compare_at_price})` : ''}
Category: ${product.category || 'General'}

YOUR TASK: Discover 10 UNIQUE sales angles to sell this product. Each angle targets a DIFFERENT audience with a DIFFERENT pain point.

For each angle, provide:
1. NAME: A catchy internal name (e.g., "The Chiropractor Killer", "The Morning Struggle")
2. AUDIENCE: Specific demographic + situation (be precise)
3. PAIN_POINT: The specific problem they face
4. HOOK: The first sentence of the ad (must stop the scroll)
5. OBJECTION: What doubt this angle overcomes
6. EMOTION: Primary emotion it triggers (fear, hope, frustration, relief, etc.)

RULES:
- Each angle must be COMPLETELY different
- Think about different USE CASES
- Think about different BUYING MOMENTS (self-purchase, gift, urgent need)
- Include at least 1 COMPARISON angle (vs expensive alternative)
- Include at least 1 SKEPTIC angle (for non-believers)
- NO medical claims
- Focus on benefits, not features
${language !== 'en' ? `- OUTPUT IN ${language.toUpperCase()} LANGUAGE` : ''}

OUTPUT FORMAT (JSON):
{
  "angles": [
    {
      "name": "...",
      "audience": "...",
      "pain_point": "...",
      "hook": "...",
      "objection": "...",
      "emotion": "..."
    }
  ]
}

Generate exactly ${numAngles} angles. Output ONLY valid JSON.`;

  const maxTokens = numAngles > 10 ? 4000 : 2000;
  const response = await generate(model, prompt, { temperature: 0.9, maxTokens });
  
  try {
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    throw new Error('No JSON found in response');
  } catch (e) {
    console.error('Failed to parse angles:', e);
    return { angles: [], error: 'Failed to parse response' };
  }
}

/**
 * Generate 5 ad copies for a specific angle using multiple models
 */
async function generateCopies(product, angle, plan = 'free', options = {}) {
  const availableModels = getCopyModels(plan);
  const features = getPlanFeatures(plan);
  const language = options.language || 'en';
  console.log(`[AI] Using models for copies (plan: ${plan}, lang: ${language}):`, availableModels);
  
  const basePrompt = `You are a world-class direct response copywriter for Facebook/TikTok/Instagram ads.

PRODUCT:
${product.title}
Price: $${product.price}${product.compare_at_price ? ` (was $${product.compare_at_price})` : ''}
${product.description || ''}

SELECTED ANGLE:
Name: ${angle.name}
Target Audience: ${angle.audience}
Pain Point: ${angle.pain_point}
Hook to use: ${angle.hook}
Emotion to trigger: ${angle.emotion}
Objection to overcome: ${angle.objection}

WRITE ONE AD COPY following these rules:
- Start with a compelling hook (based on the angle)
- Length: 80-150 words
- Tone: conversational, authentic, NOT salesy
- Include social proof if possible
- End with a soft CTA
- NO medical claims
- NO excessive emojis (max 2-3)
${language !== 'en' ? `- WRITE IN ${language.toUpperCase()} LANGUAGE` : ''}

OUTPUT ONLY THE AD COPY TEXT, nothing else.`;

  const styles = [
    { name: 'storytelling', instruction: '\n\nSTYLE: Personal story format. Start with "I" and share a transformation journey.' },
    { name: 'problem-solution', instruction: '\n\nSTYLE: Problem-solution format. Start by agitating the problem, then present the solution.' },
    { name: 'comparison', instruction: '\n\nSTYLE: Comparison format. Compare to expensive alternatives.' },
    { name: 'social-proof', instruction: '\n\nSTYLE: Social proof format. Reference what others are doing/saying.' },
    { name: 'urgency', instruction: '\n\nSTYLE: Urgency format. Create FOMO without being pushy.' },
  ];

  const modelAssignments = availableModels;

  const promises = styles.map((style, index) => 
    generate(modelAssignments[index], basePrompt + style.instruction, { temperature: 0.85 })
      .then(content => ({
        style: style.name,
        model: modelAssignments[index],
        content: content.trim()
      }))
      .catch(err => ({
        style: style.name,
        model: modelAssignments[index],
        content: `Error: ${err.message}`,
        error: true
      }))
  );

  return Promise.all(promises);
}

/**
 * Generate video script for an angle
 */
async function generateVideoScript(product, angle) {
  const prompt = `You are a UGC content creator expert. Create a 30-second video script.

PRODUCT: ${product.title}
PRICE: $${product.price}
ANGLE: ${angle.name}
AUDIENCE: ${angle.audience}
HOOK: ${angle.hook}

Create a script with this EXACT structure:

[HOOK - 0-3 seconds]
(What to say + action/expression)

[PROBLEM - 3-8 seconds]  
(Relatable problem statement)

[SOLUTION - 8-18 seconds]
(Introduce product + key benefit)

[PROOF - 18-25 seconds]
(Result/transformation)

[CTA - 25-30 seconds]
(Soft call to action)

Make it feel NATURAL. Include directions for actions.
NO medical claims.

OUTPUT THE SCRIPT ONLY.`;

  return generate(MODELS.structured, prompt, { temperature: 0.8 });
}

/**
 * Generate hook variations (Unlimited only)
 */
async function generateHookVariations(product, angle, count = 5) {
  const prompt = `You are an expert copywriter. Generate ${count} different hook variations for this ad angle.

PRODUCT: ${product.title}
ANGLE: ${angle.name}
TARGET: ${angle.audience}
ORIGINAL HOOK: "${angle.hook}"

Generate ${count} COMPLETELY different hooks. Each should:
- Stop the scroll
- Be 1-2 sentences max
- Hit the same pain point from a different angle
- Use different emotional triggers

OUTPUT FORMAT (JSON):
{
  "hooks": [
    "Hook 1...",
    "Hook 2...",
    "Hook 3...",
    "Hook 4...",
    "Hook 5..."
  ]
}

Output ONLY valid JSON.`;

  const response = await generate(MODELS.creative, prompt, { temperature: 0.95 });
  
  try {
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    throw new Error('No JSON found');
  } catch (e) {
    console.error('Failed to parse hooks:', e);
    return { hooks: [angle.hook] };
  }
}

/**
 * Bulk discover angles for multiple products (Unlimited only)
 */
async function bulkDiscoverAngles(products, plan = 'unlimited') {
  const results = [];
  
  for (const product of products) {
    try {
      const { angles } = await discoverAngles(product, plan);
      results.push({ product: product.title, angles, success: true });
    } catch (e) {
      results.push({ product: product.title, error: e.message, success: false });
    }
  }
  
  return results;
}

module.exports = {
  generate,
  discoverAngles,
  generateCopies,
  generateVideoScript,
  generateHookVariations,
  bulkDiscoverAngles,
  getModelsForPlan,
  getPlanFeatures,
  MODELS,
  PLAN_MODELS,
  PLAN_FEATURES
};
