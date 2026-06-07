#!/usr/bin/env node
/**
 * tests/run.mjs
 * Single-entry test runner using Node.js built-in `node:test`.
 * Runs all *.test.ts files via tsx (TypeScript transpiler) — no vitest, no jest.
 *
 * Usage:
 *   npm test                     → run all tests
 *   npm test -- unit             → run only unit tests
 *   npm test -- regression       → run only regression tests
 *   npm test -- integration      → run only integration tests
 *
 * Exit code: 0 = all pass, non-zero = failures (safe for CI).
 */

import { spawnSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(import.meta.url), '..', '..');
const TESTS_DIR = join(ROOT, 'tests');

// Optional filter: `npm test -- unit` runs only tests/unit/**
const filter = process.argv[2] ?? null;

function collectTestFiles(dir) {
  const results = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      results.push(...collectTestFiles(full));
    } else if (entry.endsWith('.test.ts')) {
      results.push(full);
    }
  }
  return results;
}

let files = collectTestFiles(TESTS_DIR);

if (filter) {
  files = files.filter(f => f.includes(filter));
  if (files.length === 0) {
    console.error(`No test files matched filter: "${filter}"`);
    process.exit(1);
  }
}

console.log(`\n🧪  ArxivExplorer Test Suite`);
console.log(`    Running ${files.length} file(s)${filter ? ` matching "${filter}"` : ''}...\n`);

let passed = 0;
let failed = 0;

for (const file of files) {
  const relative = file.replace(ROOT + '/', '');
  const result = spawnSync(
    'npx',
    ['tsx', '--test', file],
    {
      cwd: ROOT,
      stdio: 'inherit',
      env: {
        ...process.env,
        NODE_OPTIONS: '--experimental-vm-modules',
        // Suppress noisy experimental warnings
        NODE_NO_WARNINGS: '1',
      },
    }
  );

  if (result.status === 0) {
    passed++;
  } else {
    failed++;
  }
}

console.log('\n' + '─'.repeat(50));
if (failed === 0) {
  console.log(`✅  All ${passed} test file(s) passed.`);
} else {
  console.log(`❌  ${failed} file(s) failed, ${passed} passed.`);
}
console.log('─'.repeat(50) + '\n');

process.exit(failed > 0 ? 1 : 0);
