# Solitaire

ブラウザで遊べる Klondike ソリティア（PWA 対応）。

## ローカル開発

```bash
npm run dev
```

ブラウザで [http://localhost:8080](http://localhost:8080) を開いて確認できます。

## デプロイに使う値（GitHub secret / variable）

ワークフローは実行時に **GitHub の secret / variable** から値を取ります（`op://` の実行時参照は行いません）。以前は実行のたびに 1Password から読んでいましたが、1Password サービスアカウントの日次レート制限（1Password アカウント全体で 1,000 リクエスト/日。サービスアカウントを分けても分割されません）を使い切り、フリート全体のデプロイが止まったためです（guchi-apps/issue-deck#1302）。

どの値を GitHub 側のどこへ置くかの対応表は `.github/secrets-manifest.tsv` です。

### 1. GitHub 側に置く値

SSH 接続情報（`SERVER_*`）は organization の共通値を継承します。このリポジトリ固有の値だけ repository の secret に置きます。

| GitHub 側の名前 | スコープ | 説明 |
| :--- | :--- | :--- |
| `SERVER_HOST` | organization | デプロイ先サーバーのホスト名または IP |
| `SERVER_USERNAME` | organization | SSH 接続ユーザー名 |
| `SERVER_SSH_PORT` | organization | SSH ポート番号（例: `22`） |
| `SERVER_SSH_PRIVATE_KEY` | organization | SSH 秘密鍵（デプロイ用・他アプリと共通） |
| `DEPLOY_PATH` | repository | 静的ファイルの配置先（例: `/var/www/html/solitaire`） |
| `SIGNALY_WEBHOOK_URL` | repository | CI / デプロイ通知用 Signaly Webhook URL |
| `OP_SERVICE_ACCOUNT_TOKEN` | repository | 1Password Service Account のトークン（`apps` ボールトへの読み取り権限）。**下記の同期でのみ使い、デプロイでは使いません** |

ワークフローの `env:` ブロックは `scripts/generate-workflow-env-block.sh` で生成できます。

### 2. 値を変えたときの同期（1Password が唯一の正）

1Password（`apps` ボールトの `solitaire` アイテムほか）は「人が管理する唯一の正」として残します。値を変えたときだけ次を実行して GitHub 側へ同期してください。ここで使う `op` は**個人アカウントのセッション**のため、サービスアカウントの日次レート制限を消費しません。

```bash
op signin                                  # 個人アカウントでサインイン
scripts/sync-github-secrets.sh --dry-run   # 差分だけ確認
scripts/sync-github-secrets.sh             # 実際に同期
```

organization の共通値（`SERVER_*`）はこのリポジトリからは同期しません（マニフェスト上は `inherit`）。issue-deck の画面のボタン（`.github/workflows/sync-secrets.yml`）からも同期を起こせます。

> `sync-secrets.yml` は本体を issue-deck の `reusable-sync-secrets.yml` に置き、`secrets: inherit` で丸ごと渡しています。そのため `.github/` を `OP_SERVICE_ACCOUNT_TOKEN` で grep してもヒットしません。**使われていないと判断して消さないでください**（消すと同期が動かなくなります）。

`main` ブランチへのプッシュで、ビルド → SSH デプロイが自動実行されます。

**CI / デプロイ通知:** Signaly へ通知します（`.github/scripts/signaly-notify.sh`）。

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
4. 公開URL <https://klondike.game.gucchii.com/> へヘルスチェック（2秒間隔・最大5回）
5. **デプロイ成功後のみ** GitHub Release を作成

ヘルスチェックは `deploy` ジョブに SSH セッションが無いため、GitHub Actions のランナーから
公開HTTPS を叩きます。経路に Apache と TLS を含むので vhost の破損も検知できます。
200 が返るだけでなく `index.html` のルート要素（`<div id="app"`）が本文に含まれることまで
確認します。`--delete` 付き rsync で公開ディレクトリを空にしてしまう事故を、200 応答だけでは
拾えないためです。静的サイトで起動待ちが無いため、標準の「2秒間隔・最大60秒」ではなく
Apache reload の瞬断を吸収できる長さ（10秒）にしています。

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
