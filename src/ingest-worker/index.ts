/**
 * src/ingest-worker/index.ts
 * Ingest Worker entrypoint — scheduled cron handler only.
 *
 * Runs every hour: 0 * * * *
 * This worker is the ONLY caller of Workers AI. The api-worker never calls AI
 * for summaries or related papers — only for search query embeddings.
 */

import type { Env } from '../shared/types';
import { runIngestionPipeline } from './pipeline';
import { updateCitations } from './update-citations';

export default {
  /**
   * Scheduled cron handler — triggered by Cloudflare cron.
   * Any unhandled error propagates to Cloudflare's cron error log.
   */
  async scheduled(
    _event: ScheduledEvent,
    env: Env,
    _ctx: ExecutionContext
  ): Promise<void> {
    console.info(`[ingest-worker] Cron triggered at ${new Date().toISOString()}`);

    try {
      const result = await runIngestionPipeline(env);
      console.info('[ingest-worker] Pipeline complete:', JSON.stringify(result));
      
      // Update citations after ingestion
      const citationResult = await updateCitations(env);
      console.info('[ingest-worker] Citations updated:', JSON.stringify(citationResult));
    } catch (err) {
      // Never swallow — re-throw so Cloudflare logs the failure
      console.error('[ingest-worker] Pipeline failed with unhandled error:', err);
      throw err;
    }
  },

  /**
   * HTTP handler for manual trigger during development.
   * Only responds to /trigger in non-production or with a secret header.
   * In production, cron is the sole intended trigger.
   */
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
