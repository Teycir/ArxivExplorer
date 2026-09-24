/**
 * src/shared/ai-errors.ts
 *
 * One place that decides what an AI / infrastructure failure MEANS and how it is
 * logged, so that the next outage explains itself in the first log line.
 *
 * Why this exists (Aug–Sep 2026): every summary failed for 37 days because the
 * primary model was retired ("5028 ... was deprecated"). The cascade swallowed
 * that text into a per-model console.warn, the final error said only "All 4 AI
 * models exhausted", and the cron still reported status "ok". Finding the cause
 * meant reading code and probing Workers AI by hand.
 *
 * Rules enforced here:
 *   1. Every failure gets a stable CODE (not a free-text guess later).
 *   2. The thrown error carries the per-model reasons in its own message.
 *   3. Logs are one JSON object per line: greppable in `wrangler tail`,
 *      queryable in Workers Logs.
 *
 * Codes come from Workers AI's documented error numbers plus message patterns.
 * Only 5028 (deprecated model) has been verified against the live service
 * (2026-09-24); the others follow the documented text and fall back to
 * 'unknown', which is logged with the raw message so nothing is ever hidden.
 */

import { isD1QuotaError } from './db-budget';

export type AiErrorCode =
  | 'model_deprecated'  // 5028 — model retired; will never work again
  | 'model_not_found'   // model id does not exist (typo, or removed)
  | 'quota_exhausted'   // daily neuron allocation used up (account-wide)
  | 'rate_limited'      // 429 / capacity temporarily exceeded
  | 'timeout'           // request took too long
  | 'empty_response'    // model answered with nothing
  | 'bad_output'        // model answered, but not with usable JSON / fields
  | 'unknown';          // unclassified — raw message is always logged

/** Failures caused by the platform, not by the paper being processed. */
const INFRASTRUCTURE: ReadonlySet<AiErrorCode> = new Set<AiErrorCode>([
  'model_deprecated', 'model_not_found', 'quota_exhausted', 'rate_limited', 'timeout',
]);

export function isInfrastructureCode(code: AiErrorCode): boolean {
  return INFRASTRUCTURE.has(code);
}

/** The model answered but its output was unusable (bad JSON, missing fields). */
export class BadModelOutputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BadModelOutputError';
  }
}

export function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function clip(text: string, max = 300): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

export function classifyAiError(err: unknown): AiErrorCode {
  if (err instanceof BadModelOutputError) return 'bad_output';

  const msg = errMessage(err);
  if (/\b5028\b|was deprecated|has been deprecated/i.test(msg)) return 'model_deprecated';
  if (/\b5007\b|no such model|model not found|unknown model/i.test(msg)) return 'model_not_found';
  if (/\b4006\b|neurons|daily free allocation/i.test(msg)) return 'quota_exhausted';
  if (/\b3040\b|\b429\b|rate.?limit|too many requests|capacity/i.test(msg)) return 'rate_limited';
  if (
    (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) ||
    /timed? ?out|timeout|aborted/i.test(msg)
  ) return 'timeout';
  if (/empty response|returned empty/i.test(msg)) return 'empty_response';
  return 'unknown';
}

// ── Structured logging ───────────────────────────────────────────────────────

export type LogLevel = 'info' | 'warn' | 'error';

/**
 * One JSON object per line. `event` is a stable snake_case name to grep for
 * (e.g. `ai_model_failed`, `ai_models_changed`, `ingest_run`).
 */
export function logEvent(level: LogLevel, event: string, fields: Record<string, unknown> = {}): void {
  const line = JSON.stringify({ level, event, ...fields });
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.info(line);
}

// ── Cascade result types ─────────────────────────────────────────────────────

export interface AiAttempt {
  model: string;
  code: AiErrorCode;
  message: string;
  ms: number;
}

/**
 * Thrown when every model in the cascade failed. The message itself lists each
 * model and its reason, so a log line or a stored error is self-explanatory.
 */
export class AllModelsFailedError extends Error {
  readonly label: string;
  readonly attempts: readonly AiAttempt[];

  constructor(label: string, attempts: readonly AiAttempt[]) {
    super(AllModelsFailedError.describe(label, attempts));
    this.name = 'AllModelsFailedError';
    this.label = label;
    this.attempts = attempts;
  }

  static describe(label: string, attempts: readonly AiAttempt[]): string {
    if (attempts.length === 0) return `${label}: no models available to try`;
    const detail = attempts
      .map(a => `${a.model} → ${a.code}: ${clip(a.message, 140)}`)
      .join(' | ');
    return `${label}: all ${attempts.length} model(s) failed — ${detail}`;
  }

  /** The most common failure code across attempts (first wins a tie). */
  get dominantCode(): AiErrorCode {
    if (this.attempts.length === 0) return 'model_not_found';
    const counts = new Map<AiErrorCode, number>();
    for (const a of this.attempts) counts.set(a.code, (counts.get(a.code) ?? 0) + 1);
    let best: AiErrorCode = this.attempts[0]!.code;
    let bestN = 0;
    for (const [code, n] of counts) {
      if (n > bestN) { best = code; bestN = n; }
    }
    return best;
  }

  /** True when every attempt failed for a platform reason, not the input. */
  get isInfrastructure(): boolean {
    return this.attempts.every(a => isInfrastructureCode(a.code));
  }
}

// ── Per-paper failure ────────────────────────────────────────────────────────

export type FailureStage = 'embedding' | 'summary' | 'db_write';
export type FailureCode = AiErrorCode | 'd1_quota' | 'db_error';

/**
 * A single paper failing at a known stage. `reasonKey` ("summary:model_deprecated")
 * is what the run health record tallies, so one glance shows WHAT failed and WHY.
 */
export class PaperFailure extends Error {
  readonly paperId: string;
  readonly stage: FailureStage;
  readonly code: FailureCode;
  /** Set only when the cause was a whole-cascade failure; see isInfrastructure. */
  private readonly cascadeIsInfra: boolean | undefined;

  constructor(paperId: string, stage: FailureStage, cause: unknown) {
    const label = stage === 'embedding' ? 'Embedding' : stage === 'summary' ? 'Summary' : 'D1 summary write';
    super(`${label} failed for ${paperId}: ${errMessage(cause)}`);
    this.name = 'PaperFailure';
    this.paperId = paperId;
    this.stage = stage;
    this.code = PaperFailure.codeFor(stage, cause);
    this.cascadeIsInfra = cause instanceof AllModelsFailedError ? cause.isInfrastructure : undefined;
  }

  private static codeFor(stage: FailureStage, cause: unknown): FailureCode {
    if (stage === 'db_write') return isD1QuotaError(cause) ? 'd1_quota' : 'db_error';
    if (cause instanceof AllModelsFailedError) return cause.dominantCode;
    return classifyAiError(cause);
  }

  get reasonKey(): string {
    return `${this.stage}:${this.code}`;
  }

  /**
   * True when the paper is blameless: the platform failed (model retired, quota
   * spent, rate limit, timeout, D1 quota), not the paper's content. The retry
   * queue defers these WITHOUT consuming one of the paper's 3 attempts, so a
   * multi-day outage cannot retire healthy papers.
   */
  get isInfrastructure(): boolean {
    if (this.code === 'd1_quota') return true;
    if (this.code === 'db_error') return false;
    // A cascade is only blameless if EVERY model failed for a platform reason;
    // one bad_output among the attempts means the content itself is suspect.
    if (this.cascadeIsInfra !== undefined) return this.cascadeIsInfra;
    return isInfrastructureCode(this.code);
  }
}
