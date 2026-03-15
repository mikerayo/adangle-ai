const OpenAI = require('openai');

const openrouter = new OpenAI({
  baseURL: 'https://openrouter.ai/api/v1',
  apiKey: process.env.OPENROUTER_API_KEY,
  defaultHeaders: {
    'HTTP-Referer': process.env.SHOPIFY_HOST,
    'X-Title': 'AdAngle AI',
  },
});

// Models for different tasks
const MODELS = {
  discovery: 'anthropic/claude-3.5-sonnet',      // Best reasoning for angle discovery
  creative: 'anthropic/claude-3.5-sonnet',       // Creative copy
  structured: 'openai/gpt-4o',                   // Structured output
  fast: 'meta-llama/llama-3.1-70b-instruct',    // Fast variations
  cheap: 'mistralai/mixtral-8x7b-instruct',     // Cheap variations
};

/**
 * Generate with specific model
 */
async function generate(model, prompt, options = {}) {
  try {
    const response = await openrouter.chat.completions.create({
      model: model,
      messages: [{ role: 'user', content: prompt }],
      temperature: options.temperature || 0.8,
      max_tokens: options.maxTokens || 2000,
    });
    return response.choices[0].message.content;
  } catch (error) {
    console.error(`Error with model ${model}:`, error.message);
    throw error;
  }
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
7. TARGET_DEMO: Facebook targeting suggestion

RULES:
- Each angle must be COMPLETELY different
- Think about different USE CASES
- Think about different BUYING MOMENTS (self-purchase, gift, urgent need)
- Include at least 1 COMPARISON angle (vs expensive alternative)
- Include at least 1 SKEPTIC angle (for non-believers)
- Include at least 1 SOCIAL PROOF angle
- Include at least 1 TRANSFORMATION angle
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
      "emotion": "...",
      "target_demo": "..."
    }
  ]
}

Generate exactly 10 angles. Output ONLY valid JSON.`;

  const response = await generate(MODELS.discovery, prompt, { temperature: 0.9 });
  
  try {
    // Extract JSON from response
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
- NO ALL CAPS except for emphasis

OUTPUT ONLY THE AD COPY TEXT, nothing else.`;

  const styles = [
    { name: 'storytelling', instruction: '\n\nSTYLE: Personal story format. Start with "I" and share a transformation journey.' },
    { name: 'problem-solution', instruction: '\n\nSTYLE: Problem-solution format. Start by agitating the problem, then present the solution.' },
    { name: 'comparison', instruction: '\n\nSTYLE: Comparison format. Compare to expensive alternatives (chiropractor, gym, etc.).' },
    { name: 'social-proof', instruction: '\n\nSTYLE: Social proof format. Reference what others are doing/saying.' },
    { name: 'urgency', instruction: '\n\nSTYLE: Urgency format. Create FOMO without being pushy.' },
  ];

  const modelAssignments = [
    MODELS.creative,   // storytelling
    MODELS.structured, // problem-solution
    MODELS.creative,   // comparison
    MODELS.fast,       // social-proof
    MODELS.cheap,      // urgency
  ];

  // Generate all 5 copies in parallel
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
        content: `Error generating: ${err.message}`,
        error: true
      }))
  );

  const copies = await Promise.all(promises);
  return copies;
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
(Relatable problem statement + visual suggestion)

[SOLUTION - 8-18 seconds]
(Introduce product + show it + key benefit)

[PROOF - 18-25 seconds]
(Result/transformation + how it feels)

[CTA - 25-30 seconds]
(Soft call to action)

Make it feel NATURAL, not scripted. Like talking to a friend.
Include parenthetical directions for actions/expressions.
NO medical claims.

OUTPUT THE SCRIPT ONLY.`;

  const script = await generate(MODELS.structured, prompt, { temperature: 0.8 });
  return script;
}

module.exports = {
  generate,
  discoverAngles,
  generateCopies,
  generateVideoScript,
  MODELS
};
