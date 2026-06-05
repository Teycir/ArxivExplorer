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
    console.info(`[ingest-worker] Cron triggered at ${new Date().toISOString()}`);
    try {
      const result = await runIngestionPipeline(env);
      console.info('[ingest-worker] Pipeline complete:', JSON.stringify(result));

      const citationResult = await updateCitations(env);
      console.info('[ingest-worker] Citations updated:', JSON.stringify(citationResult));
    } catch (err) {
      console.error('[ingest-worker] Pipeline failed with unhandled error:', err);
      throw err;
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
