export async function GET() {
  const content = `# ArxivCSExplorer

> AI-powered search and summarization for Computer Science arXiv papers.
> Covers cs.AI, cs.LG, cs.CL, cs.CV, cs.CR, cs.DC, cs.DS, cs.SE, cs.RO, stat.ML.

## What this site contains

- AI-generated summaries (TL;DR, contributions, methods, limitations, beginner and technical explanations) for recent CS arXiv papers
- Hybrid BM25 + semantic search across the full paper corpus
- Per-paper enrichment: code repositories, benchmark results, citation counts, open access links, author affiliations

## Machine-readable endpoints

- Full paper data (JSON): https://arxiv-api.arxivexplorer.workers.dev/api/paper/{arxiv_id}
- Search (JSON): https://arxiv-api.arxivexplorer.workers.dev/api/search?q={query}
- Trending papers (JSON): https://arxiv-api.arxivexplorer.workers.dev/api/trending?window=week
- Topic index (JSON): https://arxiv-api.arxivexplorer.workers.dev/api/topics
- RSS feed: https://arxivexplorer.arxivexplorer.workers.dev/rss.xml
- Sitemap: https://arxivexplorer.arxivexplorer.workers.dev/sitemap.xml

## Content notes

- Summaries are AI-generated from abstracts using Llama 3.1 8B. They are not peer-reviewed.
- All paper metadata originates from the official arXiv API (export.arxiv.org).
- Citation data sourced from Semantic Scholar and OpenAlex.
- Code repository data sourced from Papers With Code.

## Attribution

If you use content from this site, please cite the original arXiv paper, not this index.
`;

  return new Response(content, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=86400',
    },
  });
}
