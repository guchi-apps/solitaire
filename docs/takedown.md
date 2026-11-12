# 公開停止（#214）に伴うVPS公開物の撤去

このリポジトリの変更（#214・#215）は**今後のデプロイを止めるだけ**で、すでにVPSへ配布済みの公開物は消さない。
撤去は `guchi-apps/vps` の作業であり、追跡は **guchi-apps/vps#337** で行う。

## 撤去対象（VPS側）

| 対象 | 場所 |
|---|---|
| 公開先 | `/var/www/html/klondike.game.gucchii.com` |
| 置き場 | `/home/github-user/apps/solitaire` |
| Apache vhost | `klondike.game.gucchii.com.conf`・`-le-ssl.conf` |
| authorized_keys | solitaire 専用デプロイ鍵（`SSH_PRIVATE_KEY` 由来） |
| Apacheの証明書更新対象 | Let's Encrypt（`klondike.game.gucchii.com`） |
| vps リポジトリの記載 | `README.md` のアプリ一覧・構成図、`docs/architecture.md` |
| DNS | `*.gucchii.com` のワイルドカードAレコードがあるため個別レコードは無い想定 |

## 完了の確認（vps#337 へ結果を記録する）

```bash
curl -sS -o /dev/null -w "%{http_code}\n" https://klondike.game.gucchii.com/   # 200 以外であること
# vhost無効化後に別vhostの既定ページが200で返る場合は、solitaireのindex.htmlを含まないこと
curl -sS https://klondike.game.gucchii.com/ | grep -c -i solitaire                # 0 であること
ssh <VPS> 'grep -c -i solitaire ~github-user/.ssh/authorized_keys'                 # 0 であること（鍵のコメント名で確認）
ssh <VPS> 'test ! -e /var/www/html/klondike.game.gucchii.com && echo removed'
```

## 公開前と公開後

- このリポジトリの変更を `main` へ出すこと自体は、旧サイトを消さない。**旧サイトが残っている間は「公開停止済み」とは言えない**
- 撤去前にマージした場合、旧サイトは残るが新規デプロイは止まる
- 公開停止の完了は vps#337 のクローズをもって判断する。リリース（`main` へのマージ）の可否は、vps#337 の状況を見て人が判断する
- 再公開する場合の手順は `README.md`「公開停止中」を参照する
