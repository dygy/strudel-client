# Strudel Deployment Guide

This document describes the automated deployment process for the Strudel application.

## Available Deployment Targets

### Vercel (Primary)
- **Production**: `npm run deploy:vercel:prod`
- **Staging**: `npm run deploy:vercel`

### Heroku (Secondary)
- **Production**: `npm run deploy:heroku:prod`
- **Staging**: `npm run deploy:heroku`
- **Force Deploy**: `npm run deploy:heroku:force`

## Heroku Deployment

### Quick Start
```bash
# Deploy to staging
npm run deploy:heroku

# Deploy to production
npm run deploy:heroku:prod

# Check deployment status
npm run deploy:heroku:status

# View logs
npm run deploy:heroku:logs
```

### Deployment Process
The automated Heroku deployment script (`scripts/deploy-heroku.sh`) performs:

1. **Pre-deployment Checks**:
   - Verifies you're in the correct directory
   - Checks Heroku CLI installation and authentication
   - Warns about uncommitted changes
   - Ensures you're on the main branch for production

2. **Quality Assurance**:
   - Runs test suite
   - Builds all packages (`pnpm run build:packages`)
   - Commits any pending changes

3. **Deployment**:
   - Pushes to Heroku via Git
   - Monitors deployment progress
   - Performs health checks

4. **Post-deployment**:
   - Shows app status and URL
   - Optionally opens the app in browser

### Configuration

#### Environment Variables
The following environment variables are automatically set in the Docker build:

```dockerfile
ENV PUBLIC_SUPABASE_URL=https://iarlunyimplczudavrcl.supabase.co
ENV PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
ENV SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

#### Heroku App Configuration
- **App Name**: `strudel-dygy`
- **Stack**: Container (Docker)
- **Region**: EU
- **Custom Domain**: `strudel.dygy.app`
- **SSL**: Automatic (Let's Encrypt)

### Monitoring and Troubleshooting

#### Status Check
```bash
npm run deploy:heroku:status
```
Shows:
- App information and process status
- Recent releases
- Configuration variables (sanitized)
- Recent logs
- Health check results

#### Log Monitoring
```bash
npm run deploy:heroku:logs
```
Streams live logs from the Heroku application.

#### Manual Commands
```bash
# Check app status
heroku ps --app=strudel-dygy

# View recent releases
heroku releases --app=strudel-dygy

# Open app in browser
heroku open --app=strudel-dygy

# Access Heroku bash
heroku run bash --app=strudel-dygy
```

### Build Process

The Heroku build uses a custom Dockerfile (`Dockerfile.heroku`) that:

1. **Base Setup**:
   - Uses Node.js 24 Alpine
   - Installs pnpm package manager

2. **Dependencies**:
   - Copies package files and installs dependencies
   - Builds all workspace packages

3. **Environment Configuration**:
   - Sets Supabase credentials
   - Configures build-time variables

4. **Application Build**:
   - Runs `npm run build:heroku`
   - Uses Astro with Node.js adapter
   - Optimizes for production

5. **Runtime**:
   - Removes unnecessary files
   - Starts Node.js server on dynamic port

### Troubleshooting Common Issues

#### Build Failures
- **Out of Memory**: Build uses `--max-old-space-size=2048`
- **Package Issues**: Run `pnpm run build:packages` locally first
- **Environment Variables**: Check Dockerfile.heroku has all required vars

#### Runtime Issues
- **503 Errors**: Check if server is starting correctly in logs
- **API Failures**: Verify Supabase credentials are set
- **Authentication Issues**: Ensure OAuth callback URLs are configured

#### Deployment Issues
- **Git Push Fails**: Use `npm run deploy:heroku:force`
- **Heroku CLI Issues**: Run `heroku login` and verify authentication
- **App Not Found**: Check app name in scripts/deploy-heroku.sh

### Security Notes

- Supabase credentials are hardcoded in Dockerfile (they're public anyway)
- Service role key is required for server-side API operations
- All credentials are visible in Heroku config but not in logs
- SSL is automatically managed by Heroku

### Performance Optimization

- Docker multi-stage build reduces final image size
- Unnecessary files removed after build
- Node.js memory limit increased for build process
- Static assets served with proper caching headers

## Development Workflow

1. **Local Development**:
   ```bash
   pnpm dev
   ```

2. **Testing**:
   ```bash
   pnpm test
   pnpm run check
   ```

3. **Package Building**:
   ```bash
   pnpm run build:packages
   ```

4. **Deployment**:
   ```bash
   npm run deploy:heroku:prod
   ```

## Support

For deployment issues:
1. Check the logs: `npm run deploy:heroku:logs`
2. Verify status: `npm run deploy:heroku:status`
3. Review this documentation
4. Check Heroku dashboard: https://dashboard.heroku.com/apps/strudel-dygy