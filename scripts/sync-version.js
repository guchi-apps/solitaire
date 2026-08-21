import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const pkgPath = path.join(root, 'package.json');
const changelogPath = path.join(root, 'js', 'changelog.js');

const PLACEHOLDER = '（更新内容を記入してください）';

// リリース自動化ワークフロー（release-develop-to-main.yml）は、developへ取り込まれた
// 差分から利用者向けの更新履歴を生成し、環境変数 RELEASE_CHANGELOG で渡してくる。
// 生成される文面は箇条書き・段落のどちらもありうるため、行単位に分解し、
// 箇条書き記号と番号を落として1行1項目にそろえる。
function parseReleaseChangelog(raw) {
  return (raw ?? '')
    .split('\n')
    .map((line) => line.trim().replace(/^(?:[-*・]|\d+[.)])\s*/, '').trim())
    .filter((line) => line !== '');
}

// 同じ経路で RELEASE_USAGE（利用者向けの操作手順）も渡ってくる。こちらは「何が変わったか」では
// なく「どう使うか」（どこを開く / 何を押す / どうなれば成功か）のため、changes へ混ぜず
// usage として別に持たせる。`1. ` で始まる番号付きの複数行で渡るので、1行1手順のまま保つ
// （番号は画面側で振り直すため、ここでは changes と同じ規則で落とす）。
function parseReleaseUsage(raw) {
  return parseReleaseChangelog(raw);
}

// changes は生成された文面をそのまま埋め込むため、JavaScriptの文字列リテラルを
// 壊さないようにエスケープする。
function escapeForJs(value) {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
const version = pkg.version;

if (!/^\d+\.\d+\.\d+$/.test(version)) {
  console.error(`Invalid semver in package.json: ${version}`);
  process.exit(1);
}

let content = fs.readFileSync(changelogPath, 'utf8');

content = content.replace(
  /export const APP_VERSION = '[^']*';/,
  `export const APP_VERSION = '${version}';`,
);

const topVersionMatch = content.match(
  /export const CHANGELOG = \[\s*\{\s*version:\s*'([^']+)'/,
);

if (!topVersionMatch) {
  console.error('Could not parse CHANGELOG in js/changelog.js');
  process.exit(1);
}

let insertedChanges = 0;
let insertedUsage = 0;
const topVersion = topVersionMatch[1];
if (topVersion !== version) {
  const today = new Date().toISOString().slice(0, 10);
  const changes = parseReleaseChangelog(process.env.RELEASE_CHANGELOG);
  const usage = parseReleaseUsage(process.env.RELEASE_USAGE);
  const items = changes.length > 0 ? changes : [PLACEHOLDER];
  // 画面で使える変化が無いリリースでは使い方が生成されず空で渡る。そのときは usage の項目ごと
  // 出力しない（空の見出しだけが残ると書き漏らしに見えるため）。
  const usageBlock =
    usage.length > 0
      ? `
    usage: [
${usage.map((item) => `      '${escapeForJs(item)}',`).join('\n')}
    ],`
      : '';
  // 先頭に新エントリのみ追記する。過去バージョンのエントリは変更しない（js/changelog.js の記載ルール参照）。
  // RELEASE_CHANGELOG が未設定・空のとき（ローカルで npm version / npm run build を
  // 実行した場合）は、従来どおり手で埋めるための枠だけを作る。
  const newEntry = `  {
    version: '${version}',
    date: '${today}',
    changes: [
${items.map((item) => `      '${escapeForJs(item)}',`).join('\n')}
    ],${usageBlock}
  },
`;
  insertedChanges = changes.length;
  insertedUsage = usage.length;
  content = content.replace(
    /export const CHANGELOG = \[\n/,
    `export const CHANGELOG = [\n${newEntry}`,
  );
}

fs.writeFileSync(changelogPath, content, 'utf8');

const swPath = path.join(root, 'sw.js');
let swContent = fs.readFileSync(swPath, 'utf8');
swContent = swContent.replace(
  /const CACHE_VERSION = '[^']*';/,
  `const CACHE_VERSION = '${version}';`,
);
swContent = swContent.replace(
  /'\.\/styles\.css\?v=[^']*'/,
  `'./styles.css?v=${version}'`,
);
swContent = swContent.replace(
  /'\.\/js\/game\.js\?v=[^']*'/,
  `'./js/game.js?v=${version}'`,
);
fs.writeFileSync(swPath, swContent, 'utf8');

const indexPath = path.join(root, 'index.html');
let indexContent = fs.readFileSync(indexPath, 'utf8');
indexContent = indexContent.replace(
  /assetUrl\('js\/game\.js\?v=[^']+'\)/,
  `assetUrl('js/game.js?v=${version}')`,
);
indexContent = indexContent.replace(
  /assetUrl\('styles\.css\?v=[^']+'\)/,
  `assetUrl('styles.css?v=${version}')`,
);
fs.writeFileSync(indexPath, indexContent, 'utf8');

const notes = [];
if (insertedChanges > 0) {
  notes.push(`${insertedChanges} change(s) from RELEASE_CHANGELOG`);
}
if (insertedUsage > 0) {
  notes.push(`${insertedUsage} usage step(s) from RELEASE_USAGE`);
}

console.log(
  notes.length > 0
    ? `Synced version ${version} to js/changelog.js (${notes.join(', ')})`
    : `Synced version ${version} to js/changelog.js`,
);
