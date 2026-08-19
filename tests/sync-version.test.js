import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { after, describe, it } from 'node:test';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const workspaces = [];

/**
 * scripts/sync-version.js はリポジトリのルートを __dirname から解決するため、
 * 一時ディレクトリへスクリプトごと写して、最小限のファイルだけを置いた状態で実行する。
 */
function runSyncVersion({ version, env }) {
  const root = mkdtempSync(path.join(tmpdir(), 'solitaire-sync-version-'));
  workspaces.push(root);
  mkdirSync(path.join(root, 'scripts'));
  mkdirSync(path.join(root, 'js'));
  copyFileSync(
    path.join(repoRoot, 'scripts', 'sync-version.js'),
    path.join(root, 'scripts', 'sync-version.js'),
  );
  writeFileSync(path.join(root, 'package.json'), JSON.stringify({ version, type: 'module' }));
  writeFileSync(
    path.join(root, 'js', 'changelog.js'),
    [
      "export const APP_VERSION = '0.0.1';",
      '',
      'export const CHANGELOG = [',
      '  {',
      "    version: '0.0.1',",
      "    date: '2026-01-01',",
      '    changes: [',
      "      '最初のリリース',",
      '    ],',
      '  },',
      '];',
      '',
    ].join('\n'),
  );
  writeFileSync(path.join(root, 'sw.js'), "const CACHE_VERSION = '0.0.1';\n");
  writeFileSync(path.join(root, 'index.html'), '<!doctype html>\n');

  const result = spawnSync(process.execPath, [path.join(root, 'scripts', 'sync-version.js')], {
    env: { ...process.env, RELEASE_CHANGELOG: '', RELEASE_USAGE: '', ...env },
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);

  return { root, changelogPath: path.join(root, 'js', 'changelog.js'), stdout: result.stdout };
}

async function loadChangelog(changelogPath) {
  // 一時ディレクトリはテストごとに別なので、モジュールキャッシュの衝突は起きない。
  const module = await import(pathToFileURL(changelogPath).href);
  return module.CHANGELOG;
}

after(() => {
  for (const root of workspaces) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('sync-version RELEASE_USAGE', () => {
  it('keeps each numbered line as its own usage step', async () => {
    const { changelogPath, stdout } = runSyncVersion({
      version: '1.0.0',
      env: {
        RELEASE_CHANGELOG: '新しい機能を追加しました',
        RELEASE_USAGE: '1. スタート画面を開く\n2. バージョン表示を押す\n3. 更新履歴が出れば成功',
      },
    });

    const changelog = await loadChangelog(changelogPath);
    assert.equal(changelog[0].version, '1.0.0');
    assert.deepEqual(changelog[0].changes, ['新しい機能を追加しました']);
    assert.deepEqual(changelog[0].usage, [
      'スタート画面を開く',
      'バージョン表示を押す',
      '更新履歴が出れば成功',
    ]);
    assert.match(stdout, /3 usage step\(s\) from RELEASE_USAGE/);
  });

  it('omits usage entirely when RELEASE_USAGE is empty', async () => {
    const { changelogPath } = runSyncVersion({
      version: '1.0.0',
      env: { RELEASE_CHANGELOG: '不具合を修正しました', RELEASE_USAGE: '' },
    });

    const changelog = await loadChangelog(changelogPath);
    assert.equal(changelog[0].version, '1.0.0');
    assert.equal('usage' in changelog[0], false);
  });

  it('escapes quotes in usage steps', async () => {
    const { changelogPath } = runSyncVersion({
      version: '1.0.0',
      env: { RELEASE_USAGE: "1. 「設定」の'簡単移動'を押す" },
    });

    const changelog = await loadChangelog(changelogPath);
    assert.deepEqual(changelog[0].usage, ["「設定」の'簡単移動'を押す"]);
  });

  it('does not touch entries when the top version already matches', async () => {
    const { changelogPath } = runSyncVersion({
      version: '0.0.1',
      env: { RELEASE_USAGE: '1. 押す' },
    });

    const changelog = await loadChangelog(changelogPath);
    assert.equal(changelog.length, 1);
    assert.equal('usage' in changelog[0], false);
  });
});
