#!/bin/bash

# Heroku Status Check Script for Strudel
# Usage: ./scripts/heroku-status.sh [APP_NAME]

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

APP_NAME="${1:-strudel-dygy}"

echo -e "${BLUE}📊 Heroku Status for: ${APP_NAME}${NC}"
echo ""

# Check if Heroku CLI is installed
if ! command -v heroku &> /dev/null; then
    echo -e "${RED}❌ Error: Heroku CLI is not installed${NC}"
    exit 1
fi

# Check if logged into Heroku
if ! heroku auth:whoami &> /dev/null; then
    echo -e "${RED}❌ Error: Not logged into Heroku${NC}"
    exit 1
fi

# App info
echo -e "${BLUE}🏷️  App Information:${NC}"
heroku apps:info --app="$APP_NAME"
echo ""

# Process status
echo -e "${BLUE}⚙️  Process Status:${NC}"
heroku ps --app="$APP_NAME"
echo ""

# Recent releases
echo -e "${BLUE}📦 Recent Releases:${NC}"
heroku releases --num=5 --app="$APP_NAME"
echo ""

# Config vars (without sensitive values)
echo -e "${BLUE}🔧 Config Variables:${NC}"
heroku config --app="$APP_NAME" | grep -E "^[A-Z_]+" | sed 's/:.*/: [HIDDEN]/'
echo ""

# Recent logs
echo -e "${BLUE}📋 Recent Logs (last 20 lines):${NC}"
heroku logs --num=20 --app="$APP_NAME"
echo ""

# Health check
APP_URL=$(heroku apps:info --app="$APP_NAME" | grep "Web URL" | awk '{print $3}')
if [ -n "$APP_URL" ]; then
    echo -e "${BLUE}🏥 Health Check:${NC}"
    if curl -s --max-time 10 "$APP_URL" > /dev/null; then
        echo -e "${GREEN}✅ App is responding${NC}"
    else
        echo -e "${RED}❌ App is not responding${NC}"
    fi
    echo -e "${BLUE}🌐 URL: ${APP_URL}${NC}"
fi