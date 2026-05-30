#!/bin/bash
set -e

echo "▶ Building Next.js app..."
npx opennextjs-cloudflare build

echo "▶ Deploying API worker..."
npx wrangler deploy --config wrangler.api.toml

echo "▶ Deploying Next.js app worker..."
npx wrangler deploy --config wrangler.jsonc

echo "✓ Done"
