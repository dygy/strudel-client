# Netlify Deployment Guide for Strudel

This guide explains how to deploy the Strudel live coding environment to Netlify.

## Prerequisites

- Node.js 20 or later
- pnpm 9 or later
- Netlify account
- Supabase project (for authentication and data storage)

## Quick Setup

### 1. Fork/Clone the Repository

```bash
git clone https://github.com/your-username/strudel-client.git
cd strudel-client
```

### 2. Install Dependencies

```bash
pnpm install
```

### 3. Build Packages

```bash
pnpm run build:packages
```

### 4. Test Local Build

```bash
pnpm run deploy:netlify
```

## Netlify Configuration

### Manual Deployment

1. **Connect to Netlify**
   - Go to [Netlify](https://netlify.com)
   - Click "Add new site" → "Import an existing project"
   - Connect your Git repository

2. **Build Settings**
   - **Base directory**: Leave empty (uses root)
   - **Build command**: `pnpm install && pnpm run build:packages && pnpm --filter website build:netlify`
   - **Publish directory**: `website/dist`
   - **Node version**: `20`

3. **Environment Variables**
   Set these in Netlify Dashboard → Site Settings → Environment Variables:
   ```
   PUBLIC_SUPABASE_URL=your_supabase_project_url
   PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
   SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key
   NODE_VERSION=20
   PNPM_VERSION=9
   ```

### Automated Deployment with GitHub Actions

The repository includes a GitHub Actions workflow (`.github/workflows/netlify-deploy.yml`) for automated deployments.

**Required GitHub Secrets:**
- `NETLIFY_AUTH_TOKEN`: Your Netlify personal access token
- `NETLIFY_SITE_ID`: Your Netlify site ID
- `PUBLIC_SUPABASE_URL`: Your Supabase project URL
- `PUBLIC_SUPABASE_ANON_KEY`: Your Supabase anonymous key
- `SUPABASE_SERVICE_ROLE_KEY`: Your Supabase service role key

## CLI Deployment

### Using Netlify CLI

1. **Install Netlify CLI**
   ```bash
   npm install -g netlify-cli
   ```

2. **Login to Netlify**
   ```bash
   netlify login
   ```

3. **Deploy**
   ```bash
   # Preview deployment
   ./scripts/deploy-netlify.sh
   
   # Production deployment
   ./scripts/deploy-netlify.sh --production
   ```

### Using pnpm Scripts

```bash
# Build for Netlify
pnpm run deploy:netlify

# Build and deploy to production
pnpm run deploy:netlify:prod
```

## Configuration Files

### `netlify.toml`
Main Netlify configuration file with:
- Build settings
- Environment variables
- Headers for security and CORS
- Redirects for API routes and OAuth
- Cache settings for static assets

### `astro.config.netlify.mjs`
Astro configuration specifically for Netlify with:
- Netlify adapter
- On-demand ISR caching
- Optimized build settings

## Key Features

### Audio Support
- Proper CORS headers for external audio samples
- MIDI permissions for Web Audio API
- Optimized caching for audio files (.wav, .mp3, .ogg)

### API Routes
- Automatic redirect from `/api/*` to Netlify Functions
- OAuth callback handling
- Supabase integration for authentication

### Performance
- Static asset caching (1 year for immutable assets)
- Audio sample caching (30 days)
- On-demand ISR for dynamic pages
- PWA support with service worker

### Security
- Security headers (X-Frame-Options, CSP, etc.)
- CORS configuration for external resources
- Proper OAuth redirect handling

## Troubleshooting

### Build Issues

1. **pnpm not found**
   - Ensure `PNPM_VERSION=9` is set in environment variables
   - Check that Node.js version is 20+

2. **Package build failures**
   - Run `pnpm run build:packages` locally to test
   - Check for TypeScript errors in packages

3. **Memory issues**
   - Large monorepo may need increased memory
   - Consider splitting builds or using build cache

### Runtime Issues

1. **Audio not working**
   - Check CORS headers in `netlify.toml`
   - Verify MIDI permissions are set correctly

2. **OAuth failures**
   - Verify Supabase environment variables
   - Check OAuth redirect URLs in Supabase dashboard
   - Ensure `/auth/callback` redirect is working

3. **API routes not working**
   - Check that redirects are properly configured
   - Verify Netlify Functions are being generated

## Performance Optimization

### Build Optimization
- Use `cacheOnDemandPages: true` for ISR
- Exclude large audio files from precaching
- Optimize bundle size with tree shaking

### Runtime Optimization
- Implement proper caching headers
- Use CDN for static assets
- Enable compression in Netlify

## Monitoring

### Build Monitoring
- Check Netlify build logs for errors
- Monitor build times and optimize if needed
- Set up build notifications

### Runtime Monitoring
- Use Netlify Analytics for performance insights
- Monitor Core Web Vitals
- Set up error tracking (Sentry, etc.)

## Support

For deployment issues:
1. Check Netlify build logs
2. Verify environment variables
3. Test local build with `pnpm run deploy:netlify`
4. Check Supabase configuration
5. Review CORS and security headers

For Strudel-specific issues, see the main project documentation.