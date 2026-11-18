/**
 * tests/unit/attack-log.test.ts
 *
 * Pins the Analytics Engine record layout: blob order is the query contract
 * used by docs/attack-logging.md, so a reorder would silently break every
 * saved SQL query.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { logAttack, type AttackLogContext } from '../../log/attack-log.js';

interface Point {
  indexes?: string[];
  blobs?: string[];
  doubles?: number[];
}

function capture(): { context: AttackLogContext; points: Point[] } {
  const points: Point[] = [];
  return {
    points,
    context: {
      env: { ATTACK_LOG: { writeDataPoint: (p: Point) => points.push(p) } },
      cf: { country: 'NL', asn: 14061, asOrganization: 'DIGITALOCEAN-ASN', colo: 'AMS' },
    },
  };
}

describe('attack log record layout', () => {
  it('writes ip/ua/path/asn/decision in the documented order', () => {
    const { context, points } = capture();
    logAttack(context, {
      decision: 'bot_burst',
      ip: '198.51.100.210',
      method: 'GET',
      path: '/search?q=llm',
      ua: 'python-requests/2.32',
      status: 403,
      score: 4,
      count: 61,
      ms: 12,
    });

    assert.equal(points.length, 1);
    const p = points[0]!;
    assert.deepEqual(p.indexes, ['198.51.100.210']);
    assert.deepEqual(p.blobs, [
      '198.51.100.210',
      'GET',
      '/search?q=llm',
      'python-requests/2.32',
      'NL',
      '14061',
      'DIGITALOCEAN-ASN',
      'AMS',
      'bot_burst',
    ]);
    assert.deepEqual(p.doubles, [403, 4, 61, 12]);
  });

  it('truncates oversized fields instead of dropping the point', () => {
    const { context, points } = capture();
    logAttack(context, {
      decision: 'bot_ua',
      ip: '203.0.113.9',
      method: 'GET',
      path: '/' + 'a'.repeat(2000),
      ua: 'x'.repeat(2000),
      status: 403,
    });

    const p = points[0]!;
    assert.equal(p.blobs?.[2]?.length, 300);
    assert.equal(p.blobs?.[3]?.length, 200);
  });

  it('never throws when the binding is missing', () => {
    assert.doesNotThrow(() =>
      logAttack(null, {
        decision: 'ok_sample',
        ip: '',
        method: 'GET',
        path: '/',
        ua: '',
        status: 200,
      })
    );
    assert.doesNotThrow(() =>
      logAttack({ env: {} }, {
        decision: 'rate_429',
        ip: '203.0.113.9',
        method: 'GET',
        path: '/',
        ua: 'curl/8',
        status: 429,
      })
    );
  });
});
