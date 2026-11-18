export async function GET() {
  const content = `# ai.txt
# arXiv Explorer is for human visitors. Automated AI access is not permitted.
User-Agent: *
Disallow: *

# This covers AI agents, AI-training and RAG crawlers, scrapers and bulk clients,
# for training, summarization, retrieval-augmented generation or question
# answering. It includes the JSON API under /api/, which only backs this site's
# own pages. Known crawlers are disallowed in /robots.txt and receive HTTP 403.
#
# Paper metadata originates from arXiv. For programmatic access, use arXiv's own
# API (export.arxiv.org) or its bulk data: https://info.arxiv.org/help/bulk_data.html
#
# To request an export of this index, open an issue:
# https://github.com/Teycir/ArxivExplorer/issues
`;

  return new Response(content, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=86400',
    },
  });
}
