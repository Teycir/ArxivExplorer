#!/bin/bash
set -e

# Release workflow: bump version -> CHANGELOG entry -> THIS SCRIPT (deploy + verify) -> git push.

echo "▶ Pre-flight: version / CHANGELOG sync..."
npm test -- version-sync

echo "▶ Building Next.js app..."
npx opennextjs-cloudflare build

echo "▶ Deploying API worker..."
npx wrangler deploy --config wrangler.api.toml

echo "▶ Deploying Next.js app worker..."
npx wrangler deploy --config wrangler.jsonc

echo "▶ Verifying the deploy..."
bash scripts/verify-deploy.sh

echo "✓ Done — now commit and git push."
