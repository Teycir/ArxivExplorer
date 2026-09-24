/**
 * src/shared/ai-models.ts
 *
 * Keeps the list of Workers AI text models current, and runs calls through it
 * as a cascade. The algorithm, as specified by the maintainer:
 *
 *   1. Fetch the page that lists the current Workers AI models.
 *   2. Keep plain chat models (no reasoning / vision / LoRA-only / guard / coder).
 *   3. Compare with the list we stored. If it differs, REPLACE it with the new one.
 *   4. At call time try the models in order; if one fails, try the next.
 *
 * Why: model names were hard-coded in five places. When `llama-3.1-8b-instruct`
 * was retired (5028 "deprecated") every summary failed for 37 days.
 *
 * Safety rules:
 *   - A failed or suspicious refresh (fetch error, page layout changed, fewer
 *     than MIN_DISCOVERED models) NEVER overwrites a working stored list.
 *   - The refresh runs at most once per 24 h, so it costs ~1 KV write/day.
 *   - Only text-generation models are managed here. The EMBEDDING model is
 *     deliberately NOT: the Vectorize index is 768-dim bge-base-en-v1.5 and a
 *     different embedding model would silently corrupt semantic search.
 */

import {
  AllModelsFailedError,
  classifyAiError,
  clip,
  errMessage,
  logEvent,
  type AiAttempt,
  type AiErrorCode,
} from './ai-errors';

export const MODELS_INDEX_URL = 'https://developers.cloudflare.com/workers-ai/models/index.md';
export const MODELS_KV_KEY = 'kv:ai:text-models';
export const RECHECK_MS = 24 * 60 * 60 * 1000;
export const MIN_DISCOVERED = 2;

/** Tried first when present in the discovered list. */
export const PREFERRED_TEXT_MODELS: readonly string[] = ['@cf/meta/llama-3.1-8b-instruct-fp8'];

/** Used only until the first successful discovery (or if KV is unavailable). */
export const DEFAULT_TEXT_MODELS: readonly string[] = [
  '@cf/meta/llama-3.1-8b-instruct-fp8',
  '@cf/meta/llama-3.2-3b-instruct',
  '@cf/meta/llama-3.2-1b-instruct',
];

/** 8B is the size the 13-field summary prompt was validated against. */
const VALIDATED_SIZE_B = 8;

// ── 1–2. Fetch + parse the models page ───────────────────────────────────────

export interface ModelCard {
  name: string;          // short name on the page, e.g. "llama-3.1-8b-instruct-fp8"
  url: string;           // per-model page
  task: string | null;   // e.g. "Text Generation"
  flags: string[];       // trailing badges, e.g. ["Batch", "Reasoning"]
}

const TASKS = [
  'Text Generation', 'Text Embeddings', 'Text-to-Image', 'Text-to-Speech', 'Text Classification',
  'Automatic Speech Recognition', 'Image Classification', 'Image-to-Text', 'Translation',
];

const CARD_RE =
  /\[!\[[^\]]*? logo\]\([^)]*\)<h3>([^<]+)<\/h3>\s*([\s\S]*?)\]\((https:\/\/developers\.cloudflare\.com\/workers-ai\/models\/[^)\s]+)\)/g;

/** Trailing " - Badge" segments: short, no sentence punctuation. */
function tailFlags(body: string): string[] {
  const parts = body.split(' - ');
  const flags: string[] = [];
  while (parts.length > 1) {
    const last = parts[parts.length - 1]!.trim();
    if (last.length > 24 || /[.!?]/.test(last)) break;
    flags.unshift(last);
    parts.pop();
  }
  return flags;
}

export function parseModelsIndex(markdown: string): ModelCard[] {
  const cards: ModelCard[] = [];
  for (const m of markdown.matchAll(CARD_RE)) {
    const name = m[1]!.trim();
    const body = m[2]!.replace(/\s+/g, ' ').trim();
    const url = m[3]!;

    let task: string | null = null;
    let at = Infinity;
    for (const t of TASKS) {
      const i = body.indexOf(t);
      if (i !== -1 && i < at) { task = t; at = i; }
    }
    cards.push({ name, url, task, flags: tailFlags(body) });
  }
  return cards;
}

const EXCLUDED_FLAGS = new Set(['reasoning', 'vision', 'beta', 'partner', 'deprecated']);
// "-lora" suffix = a LoRA-only variant. (The page's "LoRA" badge on a normal
// model such as llama-3.2-3b-instruct only means it accepts adapters.)
const EXCLUDED_NAME = /(^|[-_.])(guard|coder?|embed\w*|rerank\w*)([-_.]|$)|-lora$/i;

export function selectTextCards(cards: readonly ModelCard[]): ModelCard[] {
  return cards.filter(c =>
    c.task === 'Text Generation' &&
    !c.flags.some(f => EXCLUDED_FLAGS.has(f.toLowerCase())) &&
    !EXCLUDED_NAME.test(c.name),
  );
}

/** The card shows a short name; the full `@cf/author/name` id is on its own page. */
export function pickModelId(card: ModelCard, pageText: string): string | null {
  const want = card.name.toLowerCase();
  const ids = pageText.match(/@cf\/[a-z0-9_.-]+\/[A-Za-z0-9_.-]+/g) ?? [];
  return ids.find(id => id.split('/').pop()!.toLowerCase() === want) ?? null;
}

// ── Ranking ──────────────────────────────────────────────────────────────────

export function paramSizeB(id: string): number | null {
  const tail = id.split('/').pop() ?? id;
  const m = /(?<![a-z0-9.])(\d+(?:\.\d+)?)b(?![a-z0-9])/i.exec(tail);
  return m ? Number(m[1]) : null;
}

function sizeDistance(id: string): number {
  const s = paramSizeB(id);
  return s == null ? Infinity : Math.abs(Math.log(s / VALIDATED_SIZE_B));
}

/**
 * Preferred models first; the rest ordered by closeness to the validated 8B
 * size (cheap enough for the neuron budget, capable enough for the JSON
 * schema); unknown sizes last. Deterministic: same input, same order.
 */
export function rankModels(ids: readonly string[], preferred: readonly string[] = PREFERRED_TEXT_MODELS): string[] {
  const unique = [...new Set(ids)];
  const first = preferred.filter(p => unique.includes(p));
  const rest = unique
    .filter(id => !first.includes(id))
    .map((id, i) => ({ id, i, d: sizeDistance(id) }))
    .sort((a, b) => (a.d - b.d) || (a.i - b.i))
    .map(x => x.id);
  return [...first, ...rest];
}

// ── Discovery ────────────────────────────────────────────────────────────────

export type FetchText = (url: string) => Promise<string>;

const defaultFetchText: FetchText = async (url) => {
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000), headers: { Accept: 'text/markdown' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
};

export class DiscoveryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DiscoveryError';
  }
}

export async function discoverTextModels(fetchText: FetchText = defaultFetchText): Promise<string[]> {
  const cards = parseModelsIndex(await fetchText(MODELS_INDEX_URL));
  if (cards.length === 0) {
    throw new DiscoveryError('models page parsed to 0 cards (page layout changed?)');
  }

  const ids: string[] = [];
  const unresolved: string[] = [];
  for (const card of selectTextCards(cards)) {
    try {
      const page = await fetchText(`${card.url.replace(/\/?$/, '/')}index.md`);
      const id = pickModelId(card, page);
      if (id) ids.push(id); else unresolved.push(card.name);
    } catch {
      unresolved.push(card.name);
    }
  }
  if (unresolved.length > 0) logEvent('warn', 'ai_models_unresolved', { names: unresolved });

  if (ids.length < MIN_DISCOVERED) {
    throw new DiscoveryError(`only ${ids.length} usable model(s) found (need at least ${MIN_DISCOVERED})`);
  }
  return rankModels(ids);
}

// ── 3. Compare with stored list, replace if different ────────────────────────

export interface StoredModelList {
  models: string[];
  checked_at: string;   // last time the page was compared
  changed_at: string;   // last time the list actually changed
  source: 'page';
}

export type RefreshStatus = 'skipped_recent' | 'unchanged' | 'updated' | 'failed';
export interface RefreshOutcome {
  status: RefreshStatus;
  models: string[];
  error?: string;
}

export function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

async function readStored(kv: KVNamespace): Promise<StoredModelList | null> {
  try {
    const raw = await kv.get(MODELS_KV_KEY, 'text');
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<StoredModelList>;
    if (
      !Array.isArray(v.models) || v.models.length === 0 ||
      v.models.some(m => typeof m !== 'string') ||
      typeof v.checked_at !== 'string'
    ) {
      logEvent('warn', 'ai_models_stored_invalid', { key: MODELS_KV_KEY });
      return null;
    }
    return {
      models: v.models,
      checked_at: v.checked_at,
      changed_at: typeof v.changed_at === 'string' ? v.changed_at : v.checked_at,
      source: 'page',
    };
  } catch (err) {
    logEvent('warn', 'ai_models_kv_read_failed', { error: clip(errMessage(err)) });
    return null;
  }
}

/**
 * Compares the live page with the stored list (at most once per 24 h) and
 * replaces the stored list when they differ. Never throws; a failed refresh
 * keeps whatever list was already working.
 */
export async function refreshTextModels(
  kv: KVNamespace,
  opts: { fetchText?: FetchText; now?: () => number; force?: boolean } = {},
): Promise<RefreshOutcome> {
  const now = opts.now ?? Date.now;
  const stored = await readStored(kv);
  const current = stored?.models ?? [...DEFAULT_TEXT_MODELS];

  if (stored && !opts.force && now() - Date.parse(stored.checked_at) < RECHECK_MS) {
    return { status: 'skipped_recent', models: current };
  }

  let discovered: string[];
  try {
    discovered = await discoverTextModels(opts.fetchText);
  } catch (err) {
    logEvent('error', 'ai_models_refresh_failed', {
      error: clip(errMessage(err)),
      keeping: current,
      keeping_source: stored ? 'kv' : 'default',
    });
    return { status: 'failed', models: current, error: errMessage(err) };
  }

  const nowIso = new Date(now()).toISOString();
  const unchanged = stored !== null && sameList(stored.models, discovered);
  const record: StoredModelList = unchanged
    ? { ...stored, checked_at: nowIso }
    : { models: discovered, checked_at: nowIso, changed_at: nowIso, source: 'page' };

  if (!unchanged) {
    const before = stored?.models ?? [];
    logEvent('info', 'ai_models_changed', {
      before: stored ? before : null,
      after: discovered,
      added: discovered.filter(m => !before.includes(m)),
      removed: before.filter(m => !discovered.includes(m)),
    });
  }

  try {
    await kv.put(MODELS_KV_KEY, JSON.stringify(record));
  } catch (err) {
    // The discovered list is still returned and used by this run.
    logEvent('error', 'ai_models_kv_write_failed', { error: clip(errMessage(err)) });
  }

  memo = null;
  return { status: unchanged ? 'unchanged' : 'updated', models: discovered };
}

// ── 4. Use the list: cascade ─────────────────────────────────────────────────

let memo: { at: number; models: string[]; source: 'kv' | 'default' } | null = null;
const MEMO_MS = 10 * 60 * 1000;
const warnedConfigured = new Set<string>();

/**
 * The ordered models to try. `configured` (e.g. env.SUMMARY_MODEL) is moved to
 * the front only if it is still in the current list, so a stale config value
 * can never re-introduce a retired model.
 */
export async function getTextModelCascade(
  kv: KVNamespace | undefined,
  configured?: string,
  now: () => number = Date.now,
): Promise<{ models: string[]; source: 'kv' | 'default' }> {
  let base = memo;
  if (!base || now() - base.at >= MEMO_MS) {
    const stored = kv ? await readStored(kv) : null;
    base = { at: now(), models: stored?.models ?? [...DEFAULT_TEXT_MODELS], source: stored ? 'kv' : 'default' };
    memo = base;
  }

  let models = base.models;
  if (configured) {
    if (models.includes(configured)) {
      models = [configured, ...models.filter(m => m !== configured)];
    } else if (!warnedConfigured.has(configured)) {
      warnedConfigured.add(configured);
      logEvent('warn', 'ai_model_configured_unavailable', {
        configured,
        using: models,
        hint: 'SUMMARY_MODEL is not in the current model list; ignoring it. Remove it from wrangler config.',
      });
    }
  }
  return { models, source: base.source };
}

const dead = new Map<string, { code: AiErrorCode; at: number }>();
const DEAD_MS = 60 * 60 * 1000;
const lastExhaustedLog = new Map<string, number>();
const EXHAUSTED_LOG_EVERY_MS = 5 * 60 * 1000;

/** Test hook: clears all per-isolate state. */
export function resetAiModelState(): void {
  memo = null;
  dead.clear();
  lastExhaustedLog.clear();
  warnedConfigured.clear();
}

/**
 * Calls `call(model)` for each model in order until one succeeds. A model that
 * reports it is retired (5028) or missing is skipped for the rest of this
 * isolate's life, so the NEXT paper pays nothing for it. Account-wide quota
 * exhaustion stops the cascade early (every model would fail identically).
 *
 * Throws AllModelsFailedError, whose message lists every model and its reason.
 */
export async function runCascade<T>(
  label: string,
  models: readonly string[],
  call: (model: string) => Promise<T>,
  opts: { now?: () => number } = {},
): Promise<{ value: T; model: string; attempts: AiAttempt[] }> {
  const now = opts.now ?? Date.now;
  const attempts: AiAttempt[] = [];

  for (const model of models) {
    const d = dead.get(model);
    if (d && now() - d.at < DEAD_MS) {
      attempts.push({ model, code: d.code, message: 'skipped: reported unavailable earlier in this isolate', ms: 0 });
      continue;
    }

    const t0 = now();
    try {
      const value = await call(model);
      if (attempts.length > 0) {
        logEvent('warn', 'ai_cascade_recovered', {
          label, model, after: attempts.map(a => `${a.model}:${a.code}`),
        });
      }
      return { value, model, attempts };
    } catch (err) {
      const code = classifyAiError(err);
      const attempt: AiAttempt = { model, code, message: clip(errMessage(err)), ms: now() - t0 };
      attempts.push(attempt);
      logEvent('warn', 'ai_model_failed', { label, model, code, message: attempt.message, ms: attempt.ms });

      if (code === 'model_deprecated' || code === 'model_not_found') {
        dead.set(model, { code, at: now() });
      }
      if (code === 'quota_exhausted') break;
    }
  }

  const failure = new AllModelsFailedError(label, attempts);
  const last = lastExhaustedLog.get(label);
  if (last === undefined || now() - last >= EXHAUSTED_LOG_EVERY_MS) {
    lastExhaustedLog.set(label, now());
    logEvent('error', 'ai_cascade_exhausted', {
      label,
      codes: attempts.map(a => `${a.model}:${a.code}`),
      message: clip(failure.message, 600),
    });
  }
  throw failure;
}
