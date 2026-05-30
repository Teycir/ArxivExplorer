#!/bin/bash
set -e

echo "▶ Building..."
npx opennextjs-cloudflare build

echo "▶ Deploying as Worker..."
npx wrangler deploy --config wrangler.jsonc

echo "✓ Done"
