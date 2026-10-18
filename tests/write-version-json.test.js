import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, describe, it } from 'node:test';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const script = path.join(repoRoot, 'scripts', 'write-version-json.js');
const pkgVersion = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8')).version;
const workspaces = [];

function run(args, env = {}) {
  const outDir = mkdtempSync(path.join(tmpdir(), 'solitaire-version-json-'));
  workspaces.push(outDir);
  const childEnv = { ...process.env, ...env };
  if (!('GITHUB_SHA' in env)) delete childEnv.GITHUB_SHA;
  const result = spawnSync(process.execPath, [script, outDir, ...args], {
    cwd: repoRoot,
    env: childEnv,
    encoding: 'utf8',
  });
  return { result, file: path.join(outDir, 'version.json') };
}

after(() => {
  for (const dir of workspaces) rmSync(dir, { recursive: true, force: true });
});

const SHA = '0123456789abcdef0123456789abcdef01234567';

describe('scripts/write-version-json.js', () => {
  it('writes version and sha', () => {
    const { result, file } = run([SHA]);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), { version: pkgVersion, sha: SHA });
  });

  it('falls back to GITHUB_SHA', () => {
    const { result, file } = run([], { GITHUB_SHA: SHA });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(readFileSync(file, 'utf8')).sha, SHA);
  });

  it('refuses a missing or malformed sha', () => {
    for (const args of [[], ['abc'], [SHA.toUpperCase()]]) {
      const { result, file } = run(args);
      assert.notEqual(result.status, 0);
      assert.equal(existsSync(file), false);
    }
  });
});
