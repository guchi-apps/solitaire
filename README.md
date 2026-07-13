# Solitaire

ブラウザで遊べる Klondike ソリティア（PWA 対応）。

## ローカル開発

```bash
npm run dev
```

ブラウザで [http://localhost:8080](http://localhost:8080) を開いて確認できます。

## 環境変数の設定（1Password）

デプロイ用の秘密情報は **1Password** で管理します。リポジトリに含まれる `.github/deploy.env.tpl` に secret reference が定義されています。

### 1. 1Password にシークレットを登録

`apps` ボールトに以下のアイテムを作成し、フィールドを登録してください。

| アイテム | フィールド名 | 説明 |
| :--- | :--- | :--- |
| `solitaire` | `DEPLOY_PATH` | 静的ファイルの配置先（例: `/var/www/html/solitaire`） |
| `discord_webhook` | `CI_URL` | CI / デプロイ通知用 Discord Webhook URL（全アプリ共通） |
| `githubaction-sshkey` | `PRIVATE_KEY` | SSH 秘密鍵（デプロイ用・他アプリと共通） |
| `Server` | `host` | デプロイ先サーバーのホスト名または IP |
| `Server` | `username` | SSH 接続ユーザー名 |
| `Server` | `ssh-port` | SSH ポート番号（例: `22`） |

`Server` と `githubaction-sshkey` は [portfolio](https://github.com/m-guchi/portfolio) などと共通のものを使えます。ボールト名やアイテム名を変更した場合は、`.github/deploy.env.tpl` 内の `op://` 参照も合わせて更新してください。

### 2. GitHub Actions（CI/CD）

GitHub リポジトリには **1つだけ** シークレットを登録します。

| Secret Name | 説明 |
| :--- | :--- |
| `OP_SERVICE_ACCOUNT_TOKEN` | 1Password Service Account のトークン（`apps` ボールトへの読み取り権限） |

`main` ブランチへのプッシュで、ビルド → SSH デプロイが自動実行されます。デプロイに必要な SSH 情報はすべて 1Password から取得されます。

**CI / デプロイ通知:** 現状は Discord。**Signaly へ移行予定** — [設計ガイド](https://github.com/m-guchi/docs/blob/main/README.md#ci--デプロイ通知) 参照。

- **CI:** `develop` への push は失敗時のみ、`main` 向け PR は成功・失敗・キャンセルを通知
- **デプロイ / リリース:** `main` への push 後に結果を通知

### 3. サーバー側の準備

1. `DEPLOY_PATH` のディレクトリを作成し、Web サーバーから読み取り可能にする
2. Apache の場合、`DEPLOY_PATH` を DocumentRoot または Alias で公開する

**本番（推奨）:** サブドメイン直下に公開する場合（例: `https://klondike.game.gucchii.com/`）、`DEPLOY_PATH` をその VirtualHost の DocumentRoot に設定します。

```apache
<VirtualHost *:443>
  ServerName klondike.game.gucchii.com
  DocumentRoot /var/www/klondike.game.gucchii.com
  <Directory /var/www/klondike.game.gucchii.com>
    Options -Indexes
    AllowOverride All
    Require all granted
  </Directory>
</VirtualHost>
```

**別パターン:** 既存サイトのサブパス（例: `/solitaire/`）で公開する場合:

```apache
Alias /solitaire /var/www/html/solitaire
<Directory /var/www/html/solitaire>
  Options -Indexes
  AllowOverride All
  Require all granted
</Directory>
```

**注意:** サーバー側で `/icons` に Alias 等が設定されていると、アイコンだけ 404 になることがあります（`js/` や `styles.css` は正常）。本リポジトリではアイコンを `assets/` に配置しています。

## デプロイの流れ

`main` ブランチへの push で GitHub Actions が次を実行します。

1. `package.json` のバージョンから Git タグ（`v*`）を作成
2. `npm run build` でバージョンを各ファイルに同期し、静的ファイルをビルド
3. rsync でサーバーの `DEPLOY_PATH` へ転送（`--delete` で古いファイルを削除）
4. **デプロイ成功後のみ** GitHub Release を作成

手動でタグを push した場合は `.github/workflows/release.yml` が GitHub Release を作成します（`deploy.yml` 経由のタグ push は GITHUB_TOKEN のため別 workflow は起動しません）。

## リリース手順

`develop` でバージョンを上げてから `main` にマージします。タグは CI が `main` 上で付けるため、ローカルでは **`--no-git-tag-version`** を付けて `package.json` だけ更新してください（ローカルでタグを作ると、マージ後のデプロイが「タグが既に別コミットを指している」として失敗します）。

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

## CI/CD の既知の課題

> 2026-06-29 時点で確認された課題です。対応が完了したら削除または更新してください。

| 優先度 | 課題 | 対象ファイル |
|--------|------|-------------|
| 中 | Discord 通知を Signaly へ移行する（`discord-notify.sh` → `signaly-notify.sh`、`DISCORD_CI_WEBHOOK_URL` → `SIGNALY_WEBHOOK_URL`） | `.github/workflows/deploy.yml` |
| 中 | **`notify-release` にバージョン番号が出ない** — `needs` に `tag` がなく `NOTIFY_VERSION` も未設定のため Signaly 通知にバージョンが表示されない。`needs: [tag, deploy, release]` + `NOTIFY_VERSION: ${{ needs.tag.outputs.tag }}` を追加する | `.github/workflows/deploy.yml` |
