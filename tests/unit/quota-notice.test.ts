/**
 * tests/unit/quota-notice.test.ts
 *
 * Regression guards for the "silent outage" failure mode of the September 2026
 * D1 quota incident: the API answered 503 + `degraded: true`, but every page
 * flattened that into an empty state ("0 papers", "No papers", a bare
 * "Index Stats" pill) or — worse — a real 404 on /topic/*.
 *
 * Source-scanning assertions (no bindings, no network), same style as
 * api-hardening.test.ts.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8');

/** Strip comments so doc text that *mentions* notFound() can't false-fail us. */
const stripComments = (s: string): string =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('quota-exhaustion surfacing', () => {
  const api = read('helper/api.ts');

  it('apiFetch turns 503 + degraded:true into a typed QuotaExhaustedError', () => {
    const src = stripComments(api);
    assert.match(src, /class QuotaExhaustedError extends Error/);
    assert.match(src, /res\.status === 503 && degraded/);
    assert.match(src, /throw new QuotaExhaustedError\(/);
  });

  it('apiFetch treats an EMPTY degraded 200 (search fail-soft) as quota exhaustion', () => {
    const src = stripComments(api);
    assert.match(src, /data\.degraded === true/);
    assert.match(src, /data\.papers\.length === 0/);
  });

  it('does NOT treat a degraded response that still has papers as an error', () => {
    // Partial results must survive: the guard has to require papers.length === 0.
    const src = stripComments(api);
    const guard = src.slice(src.indexOf('data.degraded === true'));
    assert.match(guard.slice(0, 200), /length === 0/);
  });

  it('every page that calls notFound() on an API failure checks isQuotaExhausted first', () => {
    // A quota outage is not a missing resource: notFound() serves a real 404 and
    // gets the URL de-indexed. Any page that both fetches from the API and can
    // call notFound() must reference isQuotaExhausted.
    const pages = [
      'app/topic/[slug]/page.tsx',
    ];
    for (const rel of pages) {
      // NOTE: deliberately NOT using stripComments() here — it mangles JSX
      // ({/* … */}) and strings containing "//", deleting real code.
      const src = read(rel);
      assert.match(src, /isQuotaExhausted/, `${rel} must handle quota exhaustion`);

      // Anchor on the PAGE COMPONENT, not the file: generateMetadata() also calls
      // getTopicPapers() and has its own (harmless) catch block earlier on.
      const component = src.indexOf('export default async function');
      assert.notEqual(component, -1, `${rel}: default page component not found`);
      const fromComponent = src.slice(component);

      const catchStart = fromComponent.indexOf('} catch (err) {');
      assert.notEqual(catchStart, -1, `${rel}: catch block in page component not found`);
      const afterCatch = fromComponent.slice(catchStart);

      const quotaAt = afterCatch.indexOf('isQuotaExhausted(err)');
      const notFoundAt = afterCatch.indexOf('notFound();');
      assert.notEqual(quotaAt, -1, `${rel}: no isQuotaExhausted(err) check in the API catch block`);
      assert.notEqual(notFoundAt, -1, `${rel}: no notFound() after the API catch block`);
      assert.ok(
        quotaAt < notFoundAt,
        `${rel}: quota check must come BEFORE notFound() inside the API catch block`
      );
    }
  });

  it('home, explore and search render <QuotaNotice> instead of an empty state', () => {
    for (const rel of ['app/page.tsx', 'app/explore/page.tsx', 'app/search/page.tsx']) {
      const src = read(rel);
      assert.match(src, /isQuotaExhausted/, `${rel} must detect quota exhaustion`);
      assert.match(src, /<QuotaNotice/, `${rel} must render <QuotaNotice>`);
    }
  });

  it('QuotaNotice states the reset time (00:00 UTC) so users know when it recovers', () => {
    const src = read('app/components/QuotaNotice.tsx');
    assert.match(src, /00:00 UTC/);
    assert.match(src, /role="status"/);
  });
});
