import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { APP_VERSION, CHANGELOG, formatChangelogDate } from '../js/changelog.js';

const PLACEHOLDER = '（更新内容を記入してください）';

function parseSemver(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  assert.ok(match, `invalid semver: ${version}`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function compareSemver(a, b) {
  const av = parseSemver(a);
  const bv = parseSemver(b);
  for (let i = 0; i < 3; i += 1) {
    if (av[i] !== bv[i]) return av[i] - bv[i];
  }
  return 0;
}

describe('formatChangelogDate', () => {
  it('formats ISO dates for display', () => {
    assert.equal(formatChangelogDate('2026-06-15'), '2026年6月15日');
    assert.equal(formatChangelogDate('invalid'), 'invalid');
  });
});

describe('version sync', () => {
  it('matches package.json version', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    assert.equal(APP_VERSION, pkg.version);
    assert.equal(CHANGELOG[0]?.version, pkg.version);
  });
});

describe('changelog structure', () => {
  it('lists versions in descending semver order without duplicates', () => {
    const versions = CHANGELOG.map((entry) => entry.version);
    assert.equal(new Set(versions).size, versions.length, 'duplicate versions found');

    for (let i = 1; i < versions.length; i += 1) {
      assert.ok(
        compareSemver(versions[i - 1], versions[i]) > 0,
        `${versions[i - 1]} should be newer than ${versions[i]}`,
      );
    }
  });

  it('does not ship placeholder text', () => {
    for (const entry of CHANGELOG) {
      assert.ok(
        !entry.changes.some((change) => change.includes(PLACEHOLDER)),
        `v${entry.version} still contains placeholder text`,
      );
    }
  });

  it('keeps usage as an optional non-empty list of steps', () => {
    for (const entry of CHANGELOG) {
      if (entry.usage === undefined) continue;
      assert.ok(Array.isArray(entry.usage), `v${entry.version} usage must be an array`);
      assert.ok(entry.usage.length > 0, `v${entry.version} usage must not be empty`);
      for (const step of entry.usage) {
        assert.equal(typeof step, 'string', `v${entry.version} usage step must be a string`);
        assert.notEqual(step.trim(), '', `v${entry.version} usage step must not be blank`);
        assert.ok(
          !step.includes(PLACEHOLDER),
          `v${entry.version} usage still contains placeholder text`,
        );
      }
    }
  });

  it('documents immutability of past entries in source comments', () => {
    const source = readFileSync(new URL('../js/changelog.js', import.meta.url), 'utf8');
    assert.match(source, /過去バージョンのエントリは変更しない/);
  });
});
