# solitaire 固有ルール

このリポジトリで作業する Claude Code エージェント向けのルールを記載する。

**GitHub Actions 上での実行は、このリポジトリをチェックアウトしたワークツリーしか参照できない。**
したがって無人実行でも守られる必要があるルールは、このファイルに明文化しておく必要がある。

## このリポジトリの作り

**依存パッケージがゼロの素のJS。** `package.json` に `dependencies`・`devDependencies` の
どちらも無く、**ロックファイルも無い**。`node_modules` は生成されない。

| 目的 | コマンド | 中身 |
|---|---|---|
| テスト | `npm test` | `node --test tests`（**Node組み込みのテストランナー**。Jest等は入っていない） |
| ビルド | `npm run build` | `node scripts/sync-version.js`（`package.json` のバージョンを各ファイルへ埋める） |
| ローカル起動 | `npm run dev` | `bash scripts/dev.sh` |
| 静的配信 | `npm start` | **`python3 -m http.server 8080`**（Nodeのサーバーではない） |

**`npm install` は不要。** 依存が無いので、テストもビルドも clone 直後にそのまま動く。
**どちらもラッパー無しで無人実行から使える**（`.env` も 1Password も要らない）。

CI（`.github/workflows/ci.yml`）は Node `'20'` で `npm test` → `npm run build` を実行する。

**ローカルのNode 24では `npm test`（`node --test tests`）が失敗する。** Node 22以降は位置引数が
ファイル・globとして解釈され、ディレクトリ名を渡すと `Cannot find module .../tests` になる
（Node 24全般の挙動でこのリポジトリ固有ではない）。CIはNode 20のため影響しない。
ローカルで実行するときは `node --test tests/*.test.js` を使う。

**新しいテストは `tests/` に置き、`node --test` で動く形（`node:test` / `node:assert`）で書く。**
テストフレームワークを追加したくなった場合は、下記「依存関係の追加」に従うこと。

## マルチエージェント運用（GitHub Actions 無人実行）

`@claude` コメントを起点に、計画提示〜実装〜develop向けPR作成までを GitHub Actions 上で無人実行する。
ワークフローの実体は `guchi-apps/issue-deck` にあり、このリポジトリの `.github/workflows/` には
`uses:` で参照する薄い caller だけを置いている（`@workflows/v9`）。

| ファイル | 役割 |
|---|---|
| `claude-issue-dispatch.yml` | `@claude` 起点の無人実行（計画提示・実装・PR作成・質問応答） |
| `issue-labels.yml` | Issueの進捗（Project Status）の状態遷移 |

**`runtime-setup: minimal` を指定している。** 依存が無くロックファイルも無いため、
`npm ci`・Playwright インストール・DB準備の各ステップは動かない（すべて
`runtime-setup != 'minimal'` で条件付けられている）。`node` や `node-db` に変えると、
ロックファイルが無い状態で `npm ci` が走って失敗する。

設計・運用の詳細は issue-deck 側を参照する。

- 進捗管理の設計: [progress-status-architecture.md](https://github.com/guchi-apps/issue-deck/blob/main/docs/progress-status-architecture.md)
- 無人実行の挙動: [multi-agent/dispatch.md](https://github.com/guchi-apps/issue-deck/blob/main/docs/multi-agent/dispatch.md)

**`/install-github-app` を実行しないこと。** 生成される素の `claude.yml` は
`claude-issue-dispatch.yml` と同じ `issue_comment` イベントで起動するため、1つのコメントで
Claude が二重に走る（`subscription-lists` で実際に起きた）。

## ブランチ運用

- `main` は本番と一致するリリース用ブランチ。直接pushは禁止し、`develop` → `main` のPRのみで進める
- `develop` が日常の開発ブランチ。**デフォルトブランチは `develop`**（`issues`・`issue_comment`
  イベントはデフォルトブランチのワークフローしか起動しないため、変更すると無人実行が動かなくなる）
- Issue専用ブランチは `develop` から作成し、ブランチ名は **`issue-<Issue番号>`** とする（例: `issue-23`）。
  ワークフローはブランチ名から対象Issueを特定するため、**この命名規約に従わないブランチはすべて対象外**になる

## Issueの進捗

**進捗は GitHub Projects の Status で管理する。進捗ラベルは存在しない**
（issue-deck#1010 / #991 Phase 5 で `01.wip`〜`09.main` を廃止した）。

1. `Ready` — 未着手
2. `Planning` — 計画検討中（`21.plan-required` 選択時のみ経由）
3. `Implementation` — 実装中
4. `Develop PR` — developへPR作成・マージ中
5. `Develop` — developへマージ完了（main未反映）
6. `Release` — mainへPR作成・マージ中
7. `Done` — mainへマージ完了。この時点でissueをcloseする

**`gh issue edit` で進捗を進めることはできない。** Status を書けるのは issue-deck だけで、
ワークフローは進捗報告API（`POST /api/progress`）へ報告する。ブランチのpush・PR作成・PRマージを
トリガーに自動で遷移するため、エージェントが自分で進捗を動かす必要はない。

## 条件を表すラベル（進捗とは別軸）

| ラベル | 意味 |
|---|---|
| `00.check-user` | ユーザーの確認・指示が必要。どの段階でも併用する |
| `00.qa-answered` | 質問への回答のみ完了（`00.check-user` と常に併用） |
| `11.local` | ローカル（VSCode等）で対応中。付いている間は無人実行を起動しない |
| `21.plan-required` | 実装前に計画を提示し承認を得る |
| `22.merge-confirm-required` | 内容によらず、developへのマージ前に必ず `00.check-user` を付ける |
| `23.preview-required` | PR作成前に開発サーバーでの画面確認を必須にする |
| `24.screenshot-required` | PR作成前にスクリーンショット取得を必須にする |

**`24.screenshot-required` は無人実行では成立しない。** `runtime-setup: minimal` のため
Playwright がインストールされない。ローカル実行でのみ意味を持つラベルとして扱う。

## 自動マージ不可カテゴリ

以下に該当する変更は自動マージせず `00.check-user` を付与してユーザーの確認を待つ。

- 認証・認可
- 本番環境の設定
- GitHub Actionsやデプロイ設定（`.github/workflows/**`・`deploy/`）
- Secretsや環境変数（`.github/*.env.tpl`・1Password関連）
- 大規模な依存関係の更新
- `develop` → `main` のマージ

## 実装エージェントの禁止事項

- `main` / `develop` への直接コミット・push
- 他Issueのブランチの編集
- 不要なforce push
- 自分が作成したPull Requestの自己マージ

## コミット・PR・コメントの書き方

- コミットメッセージ・PRタイトル・PR本文・issueコメントは**日本語**で書く
- コミットの author は `Claude Code <claude-code@example.com>` にする
- `develop` 宛のPR本文には、対応Issue・実装内容・テスト内容・確認方法・注意点を記載する。
  developマージ時点ではissueをcloseしない運用のため、`closes #番号` / `fixes #番号` は使わず
  `#番号` のみ記載する

## 依存関係の追加

**このリポジトリは依存ゼロで成立している。** 追加はその前提を崩すため、必ずユーザーに確認を取る。
無人実行では確認相手がいないため、追加が必要だと判断した場合は追加せずに作業を止め、
`00.check-user` を付与したうえでなぜ必要かをIssueコメントで相談する。

**ロックファイルが生まれると `runtime-setup: minimal` の前提も変わる**（caller の見直しが要る）
点も、相談時にあわせて伝えること。
