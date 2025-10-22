# 🚀 Strudel Deployment Guide

This guide covers deploying the Strudel website to various platforms, with a focus on Vercel.

## 📋 Table of Contents

- [Vercel Deployment](#vercel-deployment)
- [Manual Deployment](#manual-deployment)
- [Automated Deployment](#automated-deployment)
- [Environment Variables](#environment-variables)
- [Troubleshooting](#troubleshooting)

## 🌟 Vercel Deployment

Vercel is the recommended platform for deploying Strudel due to its excellent Astro support and global CDN.

### Prerequisites

1. **Vercel Account**: Sign up at [vercel.com](https://vercel.com)
2. **Vercel CLI**: Install globally with `npm install -g vercel`
3. **pnpm**: Install with `npm install -g pnpm`

### Quick Start

1. **Clone and Setup**:
   ```bash
   git clone <your-strudel-repo>
   cd strudel
   cd website
   pnpm install
   ```

2. **Deploy with Script**:
   ```bash
   # From the root directory
   ./scripts/deploy-vercel.sh          # Preview deployment
   ./scripts/deploy-vercel.sh --production  # Production deployment
   ```

3. **Manual Deployment**:
   ```bash
   cd website
   pnpm build
   vercel --prod  # For production
   vercel         # For preview
   ```

### Configuration

The `website/vercel.json` file contains optimized settings for Strudel:

- **Build Command**: `pnpm build`
- **Output Directory**: `dist`
- **Framework**: Astro
- **Security Headers**: Included for safety
- **Caching**: Optimized for PWA

### Custom Domain

1. Go to your Vercel dashboard
2. Select your Strudel project
3. Navigate to Settings → Domains
4. Add your custom domain (e.g., `mystrudel.com`)
5. Configure DNS as instructed by Vercel

## 🤖 Automated Deployment

### GitHub Actions

The included workflow (`.github/workflows/deploy-vercel.yml`) automatically deploys:

- **Preview deployments** for pull requests
- **Production deployments** for main branch pushes

#### Setup:

1. **Create Vercel Project**:
   ```bash
   cd website
   vercel
   # Follow the prompts to create a new project
   ```

2. **Get Project IDs**:
   ```bash
   # In your Vercel dashboard, go to Settings → General
   # Copy the Project ID and Team ID (Org ID)
   ```

3. **Add GitHub Secrets**:
   Go to your GitHub repository → Settings → Secrets and add:
   - `VERCEL_TOKEN`: Your Vercel token (from Vercel Settings → Tokens)
   - `VERCEL_ORG_ID`: Your team/organization ID
   - `VERCEL_PROJECT_ID`: Your project ID

4. **Trigger Deployment**:
   - Push to main branch for production
   - Create PR for preview deployment

### Other CI/CD Platforms

#### GitLab CI
```yaml
# .gitlab-ci.yml
deploy:
  image: node:18
  script:
    - npm install -g pnpm vercel
    - cd website
    - pnpm install
    - pnpm build
    - vercel --prod --token $VERCEL_TOKEN
  only:
    - main
```

#### Codeberg/Forgejo
The existing `.forgejo/workflows/deploy.yml` can be modified to use Vercel instead of rsync.

## 🔧 Environment Variables

### Required for Deployment

- `VERCEL_TOKEN`: Your Vercel authentication token
- `VERCEL_ORG_ID`: Your Vercel organization ID
- `VERCEL_PROJECT_ID`: Your Vercel project ID

### Optional Application Variables

Set these in Vercel dashboard → Settings → Environment Variables:

- `PUBLIC_SUPABASE_URL`: Supabase project URL (if using database features)
- `PUBLIC_SUPABASE_ANON_KEY`: Supabase anonymous key
- `ALGOLIA_APP_ID`: For search functionality
- `ALGOLIA_API_KEY`: Algolia search API key

## 🐛 Troubleshooting

### Common Issues

#### Build Failures

1. **Node Version**: Ensure Node.js 18+ is used
2. **Dependencies**: Run `pnpm install` in the website directory
3. **Memory**: Increase Node memory: `NODE_OPTIONS="--max-old-space-size=4096"`

#### Deployment Issues

1. **Authentication**: Verify `VERCEL_TOKEN` is valid
2. **Project ID**: Ensure `VERCEL_PROJECT_ID` matches your project
3. **Permissions**: Check team permissions in Vercel dashboard

#### Runtime Issues

1. **Audio Files**: Ensure audio samples are in `public/` directory
2. **CORS**: Check if external APIs need CORS configuration
3. **PWA**: Verify service worker is properly configured

### Debug Commands

```bash
# Check Vercel CLI version
vercel --version

# List Vercel projects
vercel list

# Check project status
vercel inspect <deployment-url>

# View deployment logs
vercel logs <deployment-url>
```

### Performance Optimization

1. **Audio Compression**: Compress audio samples before deployment
2. **Code Splitting**: Astro automatically handles this
3. **CDN**: Vercel's global CDN is automatically configured
4. **Caching**: Headers are optimized in `vercel.json`

## 📚 Additional Resources

- [Vercel Documentation](https://vercel.com/docs)
- [Astro Deployment Guide](https://docs.astro.build/en/guides/deploy/vercel/)
- [Strudel Documentation](https://strudel.cc)

## 🆘 Getting Help

If you encounter issues:

1. Check the [troubleshooting section](#troubleshooting)
2. Review Vercel deployment logs
3. Open an issue in the Strudel repository
4. Join the Strudel community Discord

---

Happy deploying! 🎵✨