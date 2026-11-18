/**
 * tests/unit/version-sync.test.ts
 *
 * Release-hygiene guard. The version shown in the footer comes from
 * package.json (inlined by next.config.ts), so the release process is:
 *
 *   bump version -> write the CHANGELOG entry -> deploy -> verify -> git push
 *
 * This fails (and `deploy.sh` refuses to deploy) if any of those drift apart,
 * e.g. a version bumped without a CHANGELOG entry, or a changelog entry written
 * without bumping package.json — which would leave the footer showing a stale
 * release after a deploy.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8');

const SEMVER = /^\d+\.\d+\.\d+$/;
const pkgVersion: string = JSON.parse(read('package.json')).version;

describe('release version stays in sync', () => {
  it('package.json carries a semver version', () => {
    assert.match(pkgVersion, SEMVER);
  });

  it('catalog.json matches package.json', () => {
    assert.equal(JSON.parse(read('catalog.json')).version, pkgVersion);
  });

  it('CHANGELOG header "Version:" matches package.json', () => {
    const m = read('CHANGELOG.md').match(/^\*\*Version:\*\*\s*(\S+)/m);
    assert.ok(m, 'CHANGELOG.md has no "**Version:**" header line');
    assert.equal(m[1], pkgVersion);
  });

  it('the newest released CHANGELOG section is package.json\'s version', () => {
    // First "## [x.y.z] - date" heading; "[Unreleased]" sections are skipped.
    const m = read('CHANGELOG.md').match(/^## \[(\d+\.\d+\.\d+)\]/m);
    assert.ok(m, 'CHANGELOG.md has no released "## [x.y.z]" section');
    assert.equal(
      m[1],
      pkgVersion,
      `CHANGELOG top release is ${m[1]} but package.json is ${pkgVersion} — ` +
        'write the CHANGELOG entry (or bump package.json) before deploying.',
    );
  });
});

describe('footer shows the deployed version', () => {
  it('next.config.ts inlines package.json version as NEXT_PUBLIC_APP_VERSION', () => {
    const cfg = read('next.config.ts');
    assert.match(cfg, /NEXT_PUBLIC_APP_VERSION/);
    assert.match(cfg, /package\.json/);
  });

  it('Footer renders it with the data-version hook used by verify-deploy.sh', () => {
    const footer = read('app/components/Footer.tsx');
    assert.match(footer, /process\.env\.NEXT_PUBLIC_APP_VERSION/);
    assert.match(footer, /id="app-version"/);
    assert.match(footer, /data-version=\{APP_VERSION\}/);
  });
});
