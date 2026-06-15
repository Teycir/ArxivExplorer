/**
 * tests/unit/revisions.test.ts
 * Tests for the word-level diff algorithm used in revision comparison.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { wordDiff } from '../../app/diff/[id]/RevisionsClient.js';

describe('wordDiff', () => {
  it('handles identical strings without edits', () => {
    const res = wordDiff('The quick brown fox', 'The quick brown fox');
    assert.deepEqual(
      res.map(d => d.value).join(''),
      'The quick brown fox'
    );
    assert.ok(res.every(d => !d.added && !d.removed), 'no words should be added or removed');
  });

  it('detects a single word insertion in the middle', () => {
    const res = wordDiff('The brown fox', 'The quick brown fox');
    const added = res.filter(d => d.added);
    const removed = res.filter(d => d.removed);

    assert.equal(removed.length, 0);
    assert.equal(added.length, 2); // 'quick' and the space ' '
    assert.equal(added[0].value, 'quick');
    assert.equal(added[1].value, ' ');
  });

  it('detects a single word deletion in the middle', () => {
    const res = wordDiff('The quick brown fox', 'The brown fox');
    const added = res.filter(d => d.added);
    const removed = res.filter(d => d.removed);

    assert.equal(added.length, 0);
    assert.equal(removed.length, 2); // 'quick' and the space ' '
    assert.equal(removed[0].value, 'quick');
    assert.equal(removed[1].value, ' ');
  });

  it('detects a word substitution', () => {
    const res = wordDiff('The green fox', 'The red fox');
    const added = res.filter(d => d.added);
    const removed = res.filter(d => d.removed);

    assert.equal(removed.length, 1);
    assert.equal(removed[0].value, 'green');

    assert.equal(added.length, 1);
    assert.equal(added[0].value, 'red');
  });

  it('handles front insertion correctly', () => {
    const res = wordDiff('brown fox', 'quick brown fox');
    const added = res.filter(d => d.added);
    const removed = res.filter(d => d.removed);

    assert.equal(removed.length, 0);
    assert.equal(added.length, 2);
    assert.equal(added[0].value, 'quick');
    assert.equal(added[1].value, ' ');
  });

  it('handles end insertion correctly', () => {
    const res = wordDiff('quick brown', 'quick brown fox');
    const added = res.filter(d => d.added);
    const removed = res.filter(d => d.removed);

    assert.equal(removed.length, 0);
    assert.equal(added.length, 2);
    assert.equal(added[0].value, ' ');
    assert.equal(added[1].value, 'fox');
  });

  it('handles front deletion correctly', () => {
    const res = wordDiff('quick brown fox', 'brown fox');
    const added = res.filter(d => d.added);
    const removed = res.filter(d => d.removed);

    assert.equal(added.length, 0);
    assert.equal(removed.length, 2);
    assert.equal(removed[0].value, 'quick');
    assert.equal(removed[1].value, ' ');
  });

  it('handles end deletion correctly', () => {
    const res = wordDiff('quick brown fox', 'quick brown');
    const added = res.filter(d => d.added);
    const removed = res.filter(d => d.removed);

    assert.equal(added.length, 0);
    assert.equal(removed.length, 2);
    assert.equal(removed[0].value, ' ');
    assert.equal(removed[1].value, 'fox');
  });

  it('handles multiple edits correctly', () => {
    const res = wordDiff('The quick brown fox jumps', 'The slow brown fox hops');
    const added = res.filter(d => d.added);
    const removed = res.filter(d => d.removed);

    // Should have removed: 'quick' and 'jumps'
    assert.equal(removed.length, 2);
    assert.ok(removed.some(d => d.value === 'quick'));
    assert.ok(removed.some(d => d.value === 'jumps'));

    // Should have added: 'slow' and 'hops'
    assert.equal(added.length, 2);
    assert.ok(added.some(d => d.value === 'slow'));
    assert.ok(added.some(d => d.value === 'hops'));
  });
});
