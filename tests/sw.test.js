import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const swSource = readFileSync(path.join(root, 'sw.js'), 'utf8');
const pkgVersion = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).version;

const REQUIRED_JS_MODULES = [
  'app-update.js',
  'changelog.js',
  'deal-quality.js',
  'game.js',
  'pwa-install.js',
  'ranking.js',
  'rules.js',
  'save.js',
  'settings.js',
  'solitaire-game.js',
  'sounds.js',
  'stats.js',
];

describe('service worker offline cache', () => {
  it('keeps CACHE_VERSION in sync with package.json', () => {
    const match = /const CACHE_VERSION = '([^']+)';/.exec(swSource);
    assert.ok(match, 'CACHE_VERSION is defined');
    assert.equal(match[1], pkgVersion);
  });

  it('precaches app shell and all JS modules', () => {
    for (const file of REQUIRED_JS_MODULES) {
      assert.match(swSource, new RegExp(`'\\./js/${file.replace('.', '\\.')}(\\?v=[^']+)?'`));
    }
    assert.match(swSource, /'\.\/index\.html'/);
    assert.match(swSource, /'\.\/manifest\.webmanifest'/);
    assert.match(swSource, new RegExp(`'\\./styles\\.css\\?v=${pkgVersion}'`));
    assert.match(swSource, new RegExp(`'\\./js/game\\.js\\?v=${pkgVersion}'`));
  });

  it('uses network-first for navigation and all JavaScript modules', () => {
    assert.match(swSource, /addEventListener\('fetch'/);
    assert.match(swSource, /request\.mode === 'navigate'/);
    assert.match(swSource, /isJavaScriptModule/);
    assert.match(swSource, /async function networkFirst/);
    assert.doesNotMatch(swSource, /ignoreSearch:\s*true/);
    assert.match(swSource, /request\.cache === 'no-store'/);
  });
});
