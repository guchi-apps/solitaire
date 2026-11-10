# Solitaire

ブラウザで遊べる Klondike ソリティア（PWA 対応）。

## ローカル開発

```bash
npm run dev
```

ブラウザで [http://localhost:8080](http://localhost:8080) を開いて確認できます。

## 公開停止中

**このアプリは公開を停止しています（#214）。** `https://klondike.game.gucchii.com/` では配信していません。
リポジトリ（コード・テスト・`npm run build`）は残してあり、`npm run dev` でローカルで動かせます。

- `main` へ push しても本番デプロイは行いません（`deploy.yml` はタグ作成と GitHub Release のみ）
- 公開停止中は `version.json`（`scripts/write-version-json.js`）を誰も使いませんが、再公開用に残してあります
- デプロイ用の `deploy/`・`deploy-retry.yml`・専用デプロイ鍵（`SSH_PRIVATE_KEY`）は撤去済みです
- サーバー側（公開先 `/var/www/html/klondike.game.gucchii.com`・置き場 `/home/github-user/apps/solitaire`・Apache の vhost・
  authorized_keys の鍵・DNS）の撤去は `guchi-apps/vps` 側の作業です（追跡: guchi-apps/vps#337、確認手順: [docs/takedown.md](docs/takedown.md)）。
  **撤去が済むまで旧サイトは配信され続けます**
- 再公開する場合は、撤去前の `deploy.yml`・`deploy/`・`.github/secrets-manifest.tsv` を履歴（#214 より前）から戻します

## GitHub secret の同期

どの値を GitHub 側のどこへ置くかの対応表は `.github/secrets-manifest.tsv` です（現在は organization 共通値のみ）。

> `sync-secrets.yml` は本体を issue-deck の `reusable-sync-secrets.yml` に置き、`secrets: inherit` で丸ごと渡しています。**使われていないと判断して消さないでください**。

## タグと Release

`main` ブランチへの push で GitHub Actions が `package.json` のバージョンから Git タグ（`v*`）を作成し、GitHub Release を作ります。
本番へのデプロイは行いません。手動でタグを push した場合は `.github/workflows/release.yml` が GitHub Release を作成します（`deploy.yml` 経由のタグ push は GITHUB_TOKEN のため別 workflow は起動しません）。

## リリース手順

`develop` でバージョンを上げてから `main` にマージします。タグは CI が `main` 上で付けるため、ローカルでは **`--no-git-tag-version`** を付けて `package.json` だけ更新してください（ローカルでタグを作ると、マージ後のタグ作成が「タグが既に別コミットを指している」として失敗します）。

```bash
git checkout develop
git pull

# パッチ（バグ修正）: 1.4.1 → 1.4.2
npm run release:patch

# マイナー（機能追加）: 1.4.1 → 1.5.0
npm run release:minor

# メジャー（破壊的変更）: 1.4.1 → 2.0.0
npm run release:major
```

`npm run release:*` は `package.json` のバージョンを上げ、`js/changelog.js` / `sw.js` / `index.html` を同期します。先頭に追加された `（更新内容を記入してください）` はコミット前に必ず置き換えてください。

```bash
git add package.json js/changelog.js sw.js index.html
git commit -m "chore: release v$(node -p "require('./package.json').version")"
git push origin develop

# PR を作成して main にマージ
```

同じバージョン番号で再デプロイする場合は、先にバージョンを上げてから `main` にマージする必要があります。

| コマンド | 用途 |
| :--- | :--- |
| `npm run release:patch` | パッチ版を上げる（`x.y.Z`） |
| `npm run release:minor` | マイナー版を上げる（`x.Y.0`） |
| `npm run release:major` | メジャー版を上げる（`X.0.0`） |
| `node -p "require('./package.json').version"` | 現在のバージョンを表示 |

## 更新履歴（`js/changelog.js`）

- ユーザーが画面で体感できる変更のみを書く
- 過去バージョンのエントリは**変更しない**（誤記の修正も新バージョンで追記する）
- 自動追加された `（更新内容を記入してください）` はリリース前に必ず置き換える

詳細は `js/changelog.js` 先頭の記載ルールを参照してください。

## スクリプト

| コマンド | 説明 |
| :--- | :--- |
| `npm run dev` | ローカル開発サーバー（ポート 8080） |
| `npm run build` | バージョン同期（CI / デプロイ前） |
| `npm run release:patch` | パッチ版リリース準備（`package.json` + 同期） |
| `npm run release:minor` | マイナー版リリース準備 |
| `npm run release:major` | メジャー版リリース準備 |
| `npm run icons` | `assets/icon.svg` から favicon / PWA アイコンを生成 |
