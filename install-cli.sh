#!/bin/bash
# install-cli.sh - Quick install script for arxiv-cli

echo "📦 Installing ArxivExplorer CLI..."

cd cli
npm run build
chmod +x arxiv-cli.js

if command -v npm &> /dev/null; then
    npm link
    echo "✅ CLI installed globally as 'arxiv-cli'"
    echo ""
    echo "Try: arxiv-cli search \"transformer\" 5"
else
    echo "✅ CLI built successfully"
    echo ""
    echo "Run directly: node cli/arxiv-cli.js search \"transformer\" 5"
fi
