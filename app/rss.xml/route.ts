/**
 * app/rss.xml/route.ts
 * RSS feed for recent papers with summaries.
 */

const API_BASE = process.env.API_BASE || process.env.NEXT_PUBLIC_API_BASE || '';
const BASE_URL = 'https://arxivexplorer.arxivexplorer.workers.dev';

export async function GET() {
  try {
    const res = await fetch(`${API_BASE}/api/trending?limit=20&window=week`, {
      headers: { 'User-Agent': 'ArxivExplorer-RSS/1.0' },
    });

    if (!res.ok) {
      return new Response('Failed to fetch papers', { status: 500 });
    }

    const papers = await res.json();
    const now = new Date().toUTCString();

    const items = papers
      .map((p: any) => {
        const title = escapeXml(p.title);
        const link = `${BASE_URL}/paper/${p.id}`;
        const description = escapeXml(p.summary?.tldr || p.abstract.slice(0, 200));
        const pubDate = new Date(p.publishedAt).toUTCString();
        const categories = (p.categories || []).map((c: string) => `<category>${escapeXml(c)}</category>`).join('');

        return `
    <item>
      <title>${title}</title>
      <link>${link}</link>
      <guid isPermaLink="true">${link}</guid>
      <description>${description}</description>
      <pubDate>${pubDate}</pubDate>
      ${categories}
    </item>`;
      })
      .join('');

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>arXiv Explorer - Recent Papers</title>
    <link>${BASE_URL}</link>
    <description>Latest research papers with AI-powered summaries</description>
    <language>en</language>
    <lastBuildDate>${now}</lastBuildDate>
    <atom:link href="${BASE_URL}/rss.xml" rel="self" type="application/rss+xml" />
    ${items}
  </channel>
</rss>`;

    return new Response(xml, {
      headers: {
        'Content-Type': 'application/xml; charset=utf-8',
        'Cache-Control': 'public, max-age=3600',
      },
    });
  } catch (err) {
    console.error('[rss] Error generating feed:', err);
    return new Response('Internal server error', { status: 500 });
  }
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
