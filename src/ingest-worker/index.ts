/**
 * src/ingest-worker/index.ts
 * Ingest Worker entrypoint — scheduled cron handler only.
 *
 * Runs every hour: 0 * * * *
 */

import type { Env } from '../shared/types';
import { runIngestionPipeline } from './pipeline';
import { updateCitations } from './update-citations';

export default {
  async scheduled(
    _event: ScheduledEvent,
    env: Env,
    _ctx: ExecutionContext
  ): Promise<void> {
    const startedAt = new Date().toISOString();
    console.info(`[ingest-worker] Cron triggered at ${startedAt}`);

    let status: 'ok' | 'error' = 'error';
    let errorMessage: string | undefined;

    try {
      const result = await runIngestionPipeline(env);
      console.info('[ingest-worker] Pipeline complete:', JSON.stringify(result));

      const citationResult = await updateCitations(env);
      console.info('[ingest-worker] Citations updated:', JSON.stringify(citationResult));

      status = 'ok';
    } catch (err) {
      errorMessage = String(err);
      console.error('[ingest-worker] Pipeline failed with unhandled error:', err);
      throw err;
    } finally {
      try {
        await env.CACHE.put('kv:health:cron_last_run', JSON.stringify({
          started_at: startedAt,
          finished_at: new Date().toISOString(),
          status,
          ...(errorMessage ? { error: errorMessage } : {}),
        }), { expirationTtl: 90000 }); // ~25h
      } catch (kvErr) {
        console.warn('[ingest-worker] Finally: failed to write cron health key:', kvErr);
      }
    }
  },

  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/trigger') {
      console.info('[ingest-worker] Manual trigger via HTTP');
      try {
        const result = await runIngestionPipeline(env);
        return new Response(JSON.stringify({ ok: true, result }), {
          headers: { 'Content-Type': 'application/json' },
        });
      } catch (err) {
        return new Response(JSON.stringify({ ok: false, error: String(err) }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    return new Response(
      JSON.stringify({ error: 'This worker only responds to cron triggers or /trigger' }),
      { status: 404, headers: { 'Content-Type': 'application/json' } }
    );
  },
};
