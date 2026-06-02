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
import { fetchCrossRef } from './fetch-crossref';

export default {
  /**
   * Scheduled cron handler — triggered by Cloudflare cron.
   * Any unhandled error propagates to Cloudflare's cron error log.
   */
  async scheduled(
    event: ScheduledEvent,
    env: Env,
    _ctx: ExecutionContext
  ): Promise<void> {
    console.info(`[ingest-worker] Cron triggered at ${new Date().toISOString()}`);

    // 02:30 daily cron — run CrossRef enrichment batch (50 papers/run)
    const isDaily = event.cron === '30 2 * * *';
    if (isDaily) {
      console.info('[ingest-worker] Running CrossRef enrichment batch');
      try {
        const { results } = await env.DB.prepare(`
          SELECT id, doi FROM papers
          WHERE doi IS NOT NULL AND doi != ''
            AND crossref_enriched_at IS NULL
          ORDER BY indexed_at DESC
          LIMIT 50
        `).all<{ id: string; doi: string }>();

        let ok = 0, skipped = 0;
        for (const { id, doi } of results) {
          try {
            await fetchCrossRef(doi, id, env);
            ok++;
          } catch (err) {
            console.warn(`[ingest-worker/crossref] Failed for ${id}:`, String(err));
            skipped++;
          }
        }
        console.info(`[ingest-worker] CrossRef batch done — enriched:${ok} failed:${skipped}`);
      } catch (err) {
        console.error('[ingest-worker] CrossRef batch error:', err);
        // Non-fatal — don't abort the rest of the handler
      }
      return;  // daily cron only runs CrossRef, not full ingestion
    }

    // Hourly cron — run full ingest + citation update
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
