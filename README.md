# 🎯 AdAngle AI

> Find the perfect angle to sell any product

AdAngle AI is a Shopify app that discovers multiple sales angles for your products and generates high-converting ad copy using AI.

## Features

- **🎯 Angle Discovery**: Automatically finds 10 unique sales angles for any product
- **✨ Multi-Model Generation**: Generates 5 ad copy variations using different AI models
- **🎬 Video Scripts**: Creates 30-second UGC video scripts
- **📱 Teleprompter**: Built-in teleprompter mode for recording videos
- **💳 Shopify Billing**: Seamless subscription management

## Tech Stack

- **Backend**: Node.js + Express
- **Frontend**: Vanilla JS + Custom CSS (Shopify Polaris-inspired)
- **Database**: PostgreSQL
- **AI**: OpenRouter (Claude, GPT-4, Llama, Mixtral)
- **Auth**: Shopify OAuth
- **Billing**: Shopify Billing API

## Quick Start

### 1. Prerequisites

- Node.js 18+
- PostgreSQL database
- Shopify Partners account
- OpenRouter API key

### 2. Setup

```bash
# Clone and install
cd adangle-ai
npm install

# Copy environment file
cp .env.example .env

# Edit .env with your credentials
```

### 3. Configure Shopify App

1. Go to [Shopify Partners](https://partners.shopify.com)
2. Create a new app
3. Set App URL: `https://your-domain.com`
4. Set Redirect URL: `https://your-domain.com/api/auth/callback`
5. Copy API Key and Secret to `.env`

### 4. Configure OpenRouter

1. Go to [OpenRouter](https://openrouter.ai)
2. Create account and get API key
3. Add to `.env`

### 5. Run

```bash
# Development
npm run dev

# Production
npm start
```

## Environment Variables

```env
# Shopify
SHOPIFY_API_KEY=your_api_key
SHOPIFY_API_SECRET=your_api_secret
SHOPIFY_SCOPES=read_products,read_content
SHOPIFY_HOST=https://your-app.com

# OpenRouter
OPENROUTER_API_KEY=your_key

# Database
DATABASE_URL=postgresql://...

# Session
SESSION_SECRET=random_secret

# App
PORT=3000
NODE_ENV=development
```

## Pricing Plans

| Plan | Price | Angles/Month | Copies | Video Scripts |
|------|-------|--------------|--------|---------------|
| Free | $0 | 3 | 15 | ❌ |
| Starter | $29 | 30 | Unlimited | ✅ |
| Pro | $79 | Unlimited | Unlimited | ✅ |

## API Endpoints

### Auth
- `GET /api/auth` - Start OAuth flow
- `GET /api/auth/callback` - OAuth callback
- `GET /api/auth/session` - Get current session

### Products
- `GET /api/products` - List all products
- `GET /api/products/:id` - Get product details

### Angles
- `POST /api/angles/discover` - Discover angles for product
- `GET /api/angles/:productId` - Get angles for product

### Generate
- `POST /api/generate/copies` - Generate ad copies
- `POST /api/generate/video-script` - Generate video script
- `GET /api/generate/copies/:angleId` - Get generated copies

### Billing
- `GET /api/billing/status` - Get billing status
- `POST /api/billing/subscribe` - Create subscription
- `GET /api/billing/confirm` - Confirm subscription

## Deployment

### Vercel

```bash
vercel deploy
```

### Railway

```bash
railway up
```

### Docker

```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY . .
EXPOSE 3000
CMD ["npm", "start"]
```

## License

MIT

---

Built with ❤️ for Shopify merchants
