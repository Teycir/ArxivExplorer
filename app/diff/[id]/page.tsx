/**
 * app/diff/[id]/page.tsx
 * Show revision history and diff for a paper (fetching dynamic versions from arXiv export API)
 */

import { notFound } from 'next/navigation';
import { Navbar } from '@/app/components/Navbar';
import { getPaper } from '@/helper/api';
import { RevisionsClient, type ArxivVersionData } from './RevisionsClient';

interface Props {
  params: Promise<{ id: string }>;
}

function decodeXmlEntities(str: string): string {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function parseArxivFeed(xml: string): ArxivVersionData[] {
  const entryRegex = /<entry>([\s\S]*?)<\/entry>/g;
  const entries: ArxivVersionData[] = [];
  let match;

  while ((match = entryRegex.exec(xml)) !== null) {
    const entryXml = match[1];
    if (!entryXml) continue;

    const idMatch = entryXml.match(/<id>[^<]*?abs\/([^<]+)<\/id>/);
    const idCapture = idMatch ? idMatch[1] : undefined;
    const fullId = idCapture ? idCapture.trim() : '';
    if (!fullId) continue;

    const versionMatch = fullId.match(/v(\d+)$/);
    const versionCapture = versionMatch ? versionMatch[1] : undefined;
    const versionNum = versionCapture ? parseInt(versionCapture, 10) : 1;

    const titleMatch = entryXml.match(/<title>([\s\S]*?)<\/title>/);
    const titleCapture = titleMatch ? titleMatch[1] : undefined;
    const title = titleCapture ? decodeXmlEntities(titleCapture.replace(/\s+/g, ' ').trim()) : '';

    const summaryMatch = entryXml.match(/<summary>([\s\S]*?)<\/summary>/);
    const summaryCapture = summaryMatch ? summaryMatch[1] : undefined;
    const abstract = summaryCapture ? decodeXmlEntities(summaryCapture.replace(/\s+/g, ' ').trim()) : '';

    const updatedMatch = entryXml.match(/<updated>([\s\S]*?)<\/updated>/);
    const updatedCapture = updatedMatch ? updatedMatch[1] : undefined;
    const submittedAt = updatedCapture ? updatedCapture.trim() : '';

    const commentMatch = entryXml.match(/<(?:arxiv:)?comment[^>]*?>([\s\S]*?)<\/(?:arxiv:)?comment>/);
    const commentCapture = commentMatch ? commentMatch[1] : undefined;
    const comment = commentCapture ? decodeXmlEntities(commentCapture.replace(/\s+/g, ' ').trim()) : '';

    const authorRegex = /<author>([\s\S]*?)<\/author>/g;
    const authors: string[] = [];
    let authorMatch;
    while ((authorMatch = authorRegex.exec(entryXml)) !== null) {
      const authorXml = authorMatch[1];
      if (!authorXml) continue;
      const nameMatch = authorXml.match(/<name>([\s\S]*?)<\/name>/);
      const nameCapture = nameMatch ? nameMatch[1] : undefined;
      if (nameCapture) {
        authors.push(decodeXmlEntities(nameCapture.replace(/\s+/g, ' ').trim()));
      }
    }

    entries.push({
      id: fullId,
      versionNum,
      title,
      abstract,
      submittedAt,
      comment,
      authors,
    });
  }

  return entries.sort((a, b) => a.versionNum - b.versionNum);
}

export default async function PaperDiffPage({ params }: Props) {
  const resolvedParams = await params;
  console.log('[diff/page] resolvedParams:', resolvedParams);
  const id = resolvedParams?.id;
  console.log('[diff/page] id:', id);
  if (!id) {
    console.error('[diff/page] No id in params!', { params: resolvedParams });
    notFound();
  }
  const decodedId = decodeURIComponent(id);

  // 1. Fetch paper metadata from our database/API
  let paper;
  try {
    paper = await getPaper(decodedId);
  } catch (err) {
    console.error(`[diff] Error loading paper ${decodedId}:`, err);
    notFound();
  }

  if (!paper) notFound();

  // 2. Fetch history from arXiv API and parse it
  const baseId = decodedId.replace(/v\d+$/, '');
  let versions: ArxivVersionData[] = [];
  let errorNotice: string | undefined = undefined;

  try {
    // Fetch latest version info first to get total version count
    const latestRes = await fetch(`https://export.arxiv.org/api/query?id_list=${encodeURIComponent(baseId)}`, {
      next: { revalidate: 3600 }
    });
    if (latestRes.ok) {
      const latestXml = await latestRes.text();
      const idMatch = latestXml.match(/<id>[^<]*?abs\/([^<]+)<\/id>/);
      const idCapture = idMatch ? idMatch[1] : undefined;
      
      if (idCapture) {
        const latestFullId = idCapture.trim();
        const verMatch = latestFullId.match(/v(\d+)$/);
        const verCapture = verMatch ? verMatch[1] : undefined;
        const totalVersions = verCapture ? parseInt(verCapture, 10) : 1;

        // Fetch details for all version numbers up to the latest version
        const idList = Array.from({ length: totalVersions }, (_, idx) => `${baseId}v${idx + 1}`).join(',');
        const allRes = await fetch(`https://export.arxiv.org/api/query?id_list=${encodeURIComponent(idList)}`, {
          next: { revalidate: 3600 }
        });
        if (allRes.ok) {
          const allXml = await allRes.text();
          versions = parseArxivFeed(allXml);
        } else {
          errorNotice = `Could not fetch detailed versions from arXiv API (HTTP ${allRes.status}).`;
        }
      } else {
        errorNotice = "Could not parse version suffix from arXiv API response.";
      }
    } else {
      errorNotice = `Could not query arXiv API (HTTP ${latestRes.status}).`;
    }
  } catch (err) {
    console.error(`[diff] Error fetching versions from arXiv for ${baseId}:`, err);
    errorNotice = "Connection to arXiv API failed. Please try again later.";
  }

  return (
    <div className="min-h-screen flex flex-col bg-black">
      <Navbar />
      <main className="flex-1 container mx-auto px-4 py-12 max-w-4xl">
        <RevisionsClient paper={paper} versions={versions} errorNotice={errorNotice} />
      </main>
    </div>
  );
}
