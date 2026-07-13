# 1Password secret references for GitHub Actions deploy.
# CI: loaded automatically via 1password/load-secrets-action
#
# apps ボールトに solitaire アイテムを作成し、DEPLOY_PATH を登録してください。
# SSH 接続情報は portfolio / MyRoom などと共通の Server / githubaction-sshkey を参照します。

SSH_HOST=op://apps/Server/host
SSH_USERNAME=op://apps/Server/username
SSH_PORT=op://apps/Server/ssh-port
DEPLOY_PATH=op://apps/solitaire/DEPLOY_PATH
SSH_PRIVATE_KEY=op://apps/githubaction-sshkey/PRIVATE_KEY
SIGNALY_WEBHOOK_URL=op://apps/solitaire/ci-webhook-url
