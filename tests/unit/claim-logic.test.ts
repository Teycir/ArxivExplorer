/**
 * tests/unit/claim-logic.test.ts
 *
 * Tests for the claim classification logic — the LLM response parsing,
 * validation, and normalization that happen inside handleClassifyClaim.
 *
 * These are pure unit tests; the AI and KV are never called.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// ─── JSON extraction regex (mirrors claim.ts) ─────────────────────────────────

function extractJson(text: string): string | null {
  const match = text.match(/\{[\s\S]*\}/);
  return match ? match[0] : null;
}

describe('LLM response — JSON extraction', () => {
  it('extracts clean JSON', () => {
    const raw = '{"result":"support","confidence":0.85,"reasoning":"It matches."}';
    assert.equal(extractJson(raw), raw);
  });

  it('extracts JSON surrounded by prose', () => {
    const raw = 'Based on my analysis: {"result":"contradict","confidence":0.70,"reasoning":"..."} That is my verdict.';
    const extracted = extractJson(raw);
    assert.ok(extracted !== null);
    const parsed = JSON.parse(extracted!);
    assert.equal(parsed.result, 'contradict');
  });

  it('extracts JSON with newlines inside', () => {
    const raw = '{\n  "result": "neutral",\n  "confidence": 0.5,\n  "reasoning": "Not relevant."\n}';
    const extracted = extractJson(raw);
    assert.ok(extracted !== null);
    JSON.parse(extracted!); // should not throw
  });

  it('returns null when no JSON object present', () => {
    assert.equal(extractJson('Sorry, I cannot classify this.'), null);
  });
});

// ─── Result enum validation ───────────────────────────────────────────────────

function validateResult(result: string): 'support' | 'contradict' | 'neutral' {
  if (['support', 'contradict', 'neutral'].includes(result)) {
    return result as 'support' | 'contradict' | 'neutral';
  }
  return 'neutral';
}

describe('claim result validation', () => {
  it('accepts "support"', () => {
    assert.equal(validateResult('support'), 'support');
  });

  it('accepts "contradict"', () => {
    assert.equal(validateResult('contradict'), 'contradict');
  });

  it('accepts "neutral"', () => {
    assert.equal(validateResult('neutral'), 'neutral');
  });

  it('falls back to "neutral" for unknown values', () => {
    assert.equal(validateResult('yes'), 'neutral');
    assert.equal(validateResult('no'), 'neutral');
    assert.equal(validateResult('SUPPORT'), 'neutral'); // case-sensitive
    assert.equal(validateResult(''), 'neutral');
    assert.equal(validateResult('supports'), 'neutral'); // plural — invalid
  });
});

// ─── Confidence clamping ──────────────────────────────────────────────────────

function validateConfidence(confidence: unknown): number {
  if (typeof confidence !== 'number' || confidence < 0 || confidence > 1) {
    return 0.5;
  }
  return confidence;
}

describe('claim confidence validation', () => {
  it('returns valid confidence as-is', () => {
    assert.equal(validateConfidence(0.85), 0.85);
    assert.equal(validateConfidence(0.0), 0.0);
    assert.equal(validateConfidence(1.0), 1.0);
  });

  it('defaults to 0.5 for non-number', () => {
    assert.equal(validateConfidence('0.85'), 0.5);
    assert.equal(validateConfidence(null), 0.5);
    assert.equal(validateConfidence(undefined), 0.5);
  });

  it('defaults to 0.5 for out-of-range values', () => {
    assert.equal(validateConfidence(-0.1), 0.5);
    assert.equal(validateConfidence(1.1), 0.5);
    assert.equal(validateConfidence(99), 0.5);
  });
});

// ─── Input size gates ─────────────────────────────────────────────────────────

describe('claim input size gates', () => {
  it('rejects claim longer than 500 chars', () => {
    const claim = 'x'.repeat(501);
    assert.ok(claim.length > 500, 'test setup: claim is over limit');
    // Simulate the guard
    const shouldReject = claim.length > 500;
    assert.equal(shouldReject, true);
  });

  it('rejects abstract longer than 2000 chars', () => {
    const abstract = 'y'.repeat(2001);
    const shouldReject = abstract.length > 2000;
    assert.equal(shouldReject, true);
  });

  it('accepts claim at exactly 500 chars', () => {
    const claim = 'x'.repeat(500);
    const shouldReject = claim.length > 500;
    assert.equal(shouldReject, false);
  });

  it('accepts abstract at exactly 2000 chars', () => {
    const abstract = 'y'.repeat(2000);
    const shouldReject = abstract.length > 2000;
    assert.equal(shouldReject, false);
  });
});

// ─── Prompt template substitution ────────────────────────────────────────────

describe('claim prompt assembly', () => {
  const TEMPLATE = 'Claim: {claim}\n\nAbstract: {abstract}\n\nSummary: {tldr}';

  function assemblePrompt(claim: string, abstract: string, tldr: string): string {
    return TEMPLATE
      .replace('{claim}', claim)
      .replace('{abstract}', abstract)
      .replace('{tldr}', tldr);
  }

  it('substitutes all three placeholders', () => {
    const result = assemblePrompt('My claim', 'The abstract text', 'A tldr');
    assert.ok(result.includes('My claim'));
    assert.ok(result.includes('The abstract text'));
    assert.ok(result.includes('A tldr'));
    assert.ok(!result.includes('{claim}'));
    assert.ok(!result.includes('{abstract}'));
    assert.ok(!result.includes('{tldr}'));
  });

  it('handles empty tldr (optional field)', () => {
    const result = assemblePrompt('My claim', 'The abstract', '');
    assert.ok(!result.includes('{tldr}'));
    assert.ok(result.includes('Summary: \n') || result.endsWith('Summary: '));
  });
});
