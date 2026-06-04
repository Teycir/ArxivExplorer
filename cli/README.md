# ArxivExplorer CLI

CLI tool designed for AI assistants (Claude, ChatGPT, etc.) to search and explore research papers.

## Installation

```bash
# From npm (when published)
npm install -g arxiv-cli

# Local development
cd cli
npm run build
chmod +x arxiv-cli.js
npm link
```

## Usage

```bash
# Search papers
arxiv-cli search "transformer attention" 5

# Get paper details with AI summary
arxiv-cli paper 2605.30353

# Show trending papers
arxiv-cli trending 10

# Browse by topic
arxiv-cli topics
arxiv-cli topic large-language-models 20

# Author papers
arxiv-cli author "Yann LeCun" 10
```

## For AI Assistants

This CLI provides structured access to:
- **Search**: Full-text + semantic search across 1,700+ papers
- **Paper details**: Complete metadata + AI-generated summaries
- **Topics**: 27 curated research areas
- **Authors**: Papers and stats by author
- **Trending**: Most recent papers

All responses include:
- Paper IDs (for reference)
- Titles, authors, publication dates
- Categories and keywords
- AI-generated TL;DR summaries
- Direct arXiv URLs

## Environment Variables

```bash
# Override API endpoint (default: production)
export ARXIV_API_BASE=https://arxiv-api.arxivexplorer.workers.dev
```

## Output Format

Clean, parseable text output optimized for AI consumption:
```
ID: 2605.30353
Title: Physics Is All You Need...
Authors: John Doe, Jane Smith...
Published: 2026-06-03
Categories: cs.LG, cs.AI
TL;DR: This paper introduces...
URL: https://arxiv.org/abs/2605.30353
```

## API Endpoints Used

- `GET /api/search?q=<query>` - Search papers
- `GET /api/paper/<id>` - Paper details
- `GET /api/trending` - Recent papers
- `GET /api/topic/<slug>` - Topic papers
- `GET /api/author/<name>` - Author papers
- `GET /api/topics` - List topics
