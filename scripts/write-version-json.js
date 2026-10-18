import fs from 'node:fs';
import path from 'node:path';

// 配信する版を外から確かめるための dist/version.json を書き出す（#193）。
// solitaire は rsync で配置する静的サイトでサーバー側の処理が無いため、ビルド時に
// 版情報のファイルを作って一緒に配信し、デプロイ後にその sha を照合する。
//
// 使い方: node scripts/write-version-json.js <出力ディレクトリ> <commit sha>
// sha を省略すると GITHUB_SHA を使う。どちらも無ければ失敗させる（空の sha を配信すると
// 照合が常に食い違うだけで、原因が読めなくなるため）。
const [outDirArg, shaArg] = process.argv.slice(2);
const outDir = path.resolve(outDirArg ?? 'dist');
const sha = (shaArg ?? process.env.GITHUB_SHA ?? '').trim();

if (!/^[0-9a-f]{40}$/.test(sha)) {
  console.error(`Invalid commit sha: "${sha}" (expected 40 lowercase hex characters)`);
  process.exit(1);
}

const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'));
const body = { version: pkg.version, sha };

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'version.json'), `${JSON.stringify(body)}\n`, 'utf8');
console.log(`Wrote ${path.join(outDir, 'version.json')}: ${JSON.stringify(body)}`);
