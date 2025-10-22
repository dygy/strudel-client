# 🚀 Quick Vercel Setup Guide

## Prerequisites

1. **Vercel Account**: Sign up at [vercel.com](https://vercel.com)
2. **Node.js**: Version 18 or higher
3. **Git**: For version control

## 🔧 Local Setup

### 1. Install Vercel CLI
```bash
npm install -g vercel
```

### 2. Login to Vercel
```bash
vercel login
```
Follow the prompts to authenticate with your Vercel account.

### 3. Test Deployment
```bash
# From the root directory
npm run deploy:vercel
```

## 🤖 Automated Deployment (GitHub Actions)

### 1. Get Vercel Tokens

1. Go to [Vercel Dashboard](https://vercel.com/dashboard)
2. Go to Settings → Tokens
3. Create a new token and copy it

### 2. Create Vercel Project

```bash
cd website
vercel
```
Follow the prompts to create a new project. Note the **Project ID** and **Org ID**.

### 3. Add GitHub Secrets

Go to your GitHub repository → Settings → Secrets and variables → Actions

Add these secrets:
- `VERCEL_TOKEN`: Your Vercel token
- `VERCEL_ORG_ID`: Your organization ID (from Vercel dashboard)
- `VERCEL_PROJECT_ID`: Your project ID (from Vercel dashboard)

### 4. Push to GitHub

The workflow will automatically deploy:
- **Preview deployments** for pull requests
- **Production deployments** for main branch pushes

## 🛠️ Troubleshooting

### "No existing credentials found"
```bash
vercel login
```

### "astro: command not found"
Make sure you're in the `website` directory and dependencies are installed:
```bash
cd website
npm install
```

### Build fails
Check that all dependencies are installed:
```bash
cd website
npm install
npm run build
```

### Authentication issues in CI
Verify your GitHub secrets are set correctly:
- `VERCEL_TOKEN`
- `VERCEL_ORG_ID` 
- `VERCEL_PROJECT_ID`

## 📋 Quick Commands

```bash
# Deploy to preview
npm run deploy:vercel

# Deploy to production
npm run deploy:vercel:prod

# Interactive deployment
npm run deploy

# Manual deployment
cd website
vercel --prod
```

## 🌐 Custom Domain

1. Go to Vercel Dashboard → Your Project → Settings → Domains
2. Add your custom domain
3. Configure DNS as instructed by Vercel

## 📚 Resources

- [Vercel Documentation](https://vercel.com/docs)
- [Astro Deployment Guide](https://docs.astro.build/en/guides/deploy/vercel/)
- [GitHub Actions Documentation](https://docs.github.com/en/actions)

---

Need help? Check the [DEPLOYMENT.md](./DEPLOYMENT.md) for more detailed instructions.