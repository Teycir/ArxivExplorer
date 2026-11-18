# ArxivExplorer CLI

CLI client for a person's own terminal, to search and explore research papers.

> **Not for AI agents or automated use.** The JSON API behind this CLI only backs
> the arXiv Explorer site and is not a public interface. AI agents, scrapers,
> scheduled jobs and bulk queries are not permitted and are rate limited. For
> programmatic access to paper data, use arXiv's own API (`export.arxiv.org`) or
> bulk data. See [AI.md](../AI.md).

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

## What it returns

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

Plain, parseable text output:
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
