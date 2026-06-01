/**
 * src/ingest-worker/tfidf.ts
 * TF-IDF + cosine similarity engine for the ingest worker.
 * Zero dependencies — runs inside a Cloudflare Worker isolate.
 *
 * Used by compute-related.ts to populate related_papers at ingest time,
 * so the API never needs to compute anything — it just reads D1.
 */

// ─── Stop-words ─────────────────────────────────────────────────────────────

const STOP = new Set([
  'a','an','the','and','or','but','in','on','at','to','for','of','with',
  'by','from','is','are','was','were','be','been','being','have','has',
  'had','do','does','did','will','would','could','should','may','might',
  'this','that','these','those','it','its','we','our','they','their',
  'i','my','you','your','he','his','she','her','as','if','not','no',
  'so','such','than','then','when','where','which','who','how','what',
  'all','also','can','into','more','other','there','through','up','about',
  'out','over','after','under','each','same','while','during','based',
  'using','used','use','paper','show','shows','present','propose','proposed',
  'method','methods','approach','work','results','result','both','however',
  'first','second','third','new','two','three','one','well','further',
  'without','between','within','across','per','via','et','al',
]);

// ─── Tokenise ────────────────────────────────────────────────────────────────

function tokenise(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[-/]/g, ' ')
    .replace(/[^a-z0-9\s]/g, '')
    .split(/\s+/)
    .filter(t => t.length > 2 && !STOP.has(t));
}

// ─── TF map for a single document ───────────────────────────────────────────

export type TfMap = Map<string, number>;

export function buildTf(text: string): TfMap {
  const tokens = tokenise(text);
  const tf: TfMap = new Map();
  for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
  const len = tokens.length || 1;
  for (const [k, v] of tf) tf.set(k, v / len);
  return tf;
}

// ─── IDF across a corpus ─────────────────────────────────────────────────────

export type IdfMap = Map<string, number>;

export function buildIdf(corpus: TfMap[]): IdfMap {
  const N = corpus.length;
  const df: Map<string, number> = new Map();
  for (const tf of corpus) {
    for (const term of tf.keys()) {
      df.set(term, (df.get(term) ?? 0) + 1);
    }
  }
  const idf: IdfMap = new Map();
  for (const [term, freq] of df) {
    idf.set(term, Math.log((N + 1) / (freq + 1)) + 1); // smoothed
  }
  return idf;
}

// ─── TF-IDF vector ───────────────────────────────────────────────────────────

function tfidfVec(tf: TfMap, idf: IdfMap): Map<string, number> {
  const vec: Map<string, number> = new Map();
  for (const [term, tfVal] of tf) {
    const idfVal = idf.get(term);
    if (idfVal) vec.set(term, tfVal * idfVal);
  }
  return vec;
}

// ─── Cosine similarity ───────────────────────────────────────────────────────

function cosine(a: Map<string, number>, b: Map<string, number>): number {
  let dot = 0, normA = 0, normB = 0;
  for (const [t, va] of a) { normA += va * va; const vb = b.get(t); if (vb) dot += va * vb; }
  for (const [, vb] of b) normB += vb * vb;
  return normA && normB ? dot / (Math.sqrt(normA) * Math.sqrt(normB)) : 0;
}

// ─── Public API ──────────────────────────────────────────────────────────────

export interface CorpusEntry {
  id: string;
  tf: TfMap;
}

export interface SimilarDoc {
  id: string;
  score: number;
  rank: number;
}

/**
 * Given a query TF map and a pre-built corpus, return the top-K most similar
 * documents (query document must be excluded by the caller passing queryId).
 */
export function findSimilar(
  queryId: string,
  queryTf: TfMap,
  corpus: CorpusEntry[],
  topK = 8,
): SimilarDoc[] {
  const idf = buildIdf(corpus.map(c => c.tf));
  const queryVec = tfidfVec(queryTf, idf);

  const scored: Array<{ id: string; score: number }> = [];
  for (const entry of corpus) {
    if (entry.id === queryId) continue;
    const score = cosine(queryVec, tfidfVec(entry.tf, idf));
    if (score > 0) scored.push({ id: entry.id, score });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK).map((s, i) => ({ id: s.id, score: s.score, rank: i + 1 }));
}
