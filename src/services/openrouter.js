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
async function discoverAngles(product) {
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

Generate exactly 10 angles. Output ONLY valid JSON.`;

  const response = await generate(MODELS.discovery, prompt, { temperature: 0.9 });
  
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
async function generateCopies(product, angle) {
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

OUTPUT ONLY THE AD COPY TEXT, nothing else.`;

  const styles = [
    { name: 'storytelling', instruction: '\n\nSTYLE: Personal story format. Start with "I" and share a transformation journey.' },
    { name: 'problem-solution', instruction: '\n\nSTYLE: Problem-solution format. Start by agitating the problem, then present the solution.' },
    { name: 'comparison', instruction: '\n\nSTYLE: Comparison format. Compare to expensive alternatives.' },
    { name: 'social-proof', instruction: '\n\nSTYLE: Social proof format. Reference what others are doing/saying.' },
    { name: 'urgency', instruction: '\n\nSTYLE: Urgency format. Create FOMO without being pushy.' },
  ];

  const modelAssignments = [
    MODELS.creative,
    MODELS.structured,
    MODELS.creative,
    MODELS.fast,
    MODELS.cheap,
  ];

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

module.exports = {
  generate,
  discoverAngles,
  generateCopies,
  generateVideoScript,
  MODELS
};
