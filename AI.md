# arXiv Explorer — Automated Access Policy

arXiv Explorer is for **human visitors**. Automated access by AI agents is **not
permitted**.

## What is not permitted

- AI agents and assistants fetching pages or calling the API on a user's behalf
- AI-training, retrieval-augmented-generation (RAG) and summarization crawlers
- SEO scrapers and bulk or scheduled clients
- Any use of the JSON API under `/api/`. It only backs this site's own pages and
  is not a public interface.

## How it is enforced

- `robots.txt` disallows known AI and SEO crawlers from `/` entirely, and every
  group disallows `/api/`.
- `/ai.txt` and `/llms.txt` state this policy.
- Both workers answer known crawlers (GPTBot, ClaudeBot, ChatGPT-User,
  PerplexityBot, Bytespider, CCBot, SemrushBot, AhrefsBot, and others) with
  `403` before any rendering or database work.
- Per-IP rate limits and a daily request breaker apply to everyone.

The reason is practical: the site runs on the Cloudflare Workers Free plan, which
allows 100,000 requests/day per account, and crawler traffic alone has exhausted
it. See [SECURITY.md](SECURITY.md#bot-and-quota-guards).

## If you need the data

- Paper metadata comes from arXiv. Use arXiv's official API
  (`export.arxiv.org`, <https://info.arxiv.org/help/api/index.html>) or its bulk
  data (<https://info.arxiv.org/help/bulk_data.html>).
- To request an export of this index, open an issue:
  <https://github.com/Teycir/ArxivExplorer/issues>

## For people

Open the site in a browser. Search, topics, authors and paper pages are all
available without login. Summaries are AI-generated from abstracts and are not
peer-reviewed.

## GitHub Repository

<https://github.com/Teycir/ArxivExplorer>

## License

BSL 1.1 (Business Source License 1.1)
