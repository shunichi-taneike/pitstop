#!/usr/bin/env bash
# S3 にサイトをアップロードし、CloudFront のキャッシュを無効化する
set -euo pipefail

cd "$(dirname "$0")"

# .env から認証情報を読み込む（AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY）
if [ ! -f .env ]; then
  echo ".env がありません。.env.example をコピーして作成してください" >&2
  exit 1
fi
set -a
# shellcheck disable=SC1091
. ./.env
set +a
: "${AWS_ACCESS_KEY_ID:?.env に AWS_ACCESS_KEY_ID を設定してください}"
: "${AWS_SECRET_ACCESS_KEY:?.env に AWS_SECRET_ACCESS_KEY を設定してください}"
# ~/.aws のプロファイルより .env のキーを確実に優先させる
unset AWS_PROFILE
export AWS_DEFAULT_REGION="${AWS_DEFAULT_REGION:-ap-northeast-1}"

BUCKET="pitstop.small-right.com"
DISTRIBUTION_ID="${DISTRIBUTION_ID:-EA3V3ZYCLAWZ}"

# 公開に必要なファイルだけを送る（scrapers やビルドスクリプトは除外）
aws s3 sync . "s3://$BUCKET" --delete \
  --exclude "*" \
  --include "index.html" \
  --include "favicon.png" \
  --include "apple-touch-icon.png" \
  --include "icon-192.png" \
  --include "icon-512.png" \
  --include "site.webmanifest" \
  --include "robots.txt" \
  --include "sitemap.xml" \
  --include "stores.js" \
  --include "stores/*/icon.*"

# .webmanifest は拡張子から Content-Type が推測されないので明示する（ホーム画面への追加に必要）
aws s3 cp site.webmanifest "s3://$BUCKET/site.webmanifest" --content-type "application/manifest+json"

aws cloudfront create-invalidation \
  --distribution-id "$DISTRIBUTION_ID" \
  --paths "/*" \
  --query "Invalidation.Id" --output text

echo "https://pitstop.small-right.com/"
