#!/bin/sh
# Nightly database backup to S3-compatible storage (R2 or B2). Run from cron on the VPS:
#   15 3 * * * cd /opt/dah-pango && sh infra/backup.sh >> /var/log/dahpango-backup.log 2>&1
# Keep 30 days with a lifecycle rule on the bucket.
set -eu
. "$(dirname "$0")/.env"
STAMP=$(date +%Y-%m-%d)
FILE="/tmp/dahpango-$STAMP.sql.gz"
docker compose -f "$(dirname "$0")/docker-compose.yml" exec -T postgres \
  pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" | gzip > "$FILE"
docker run --rm -v /tmp:/tmp \
  -e AWS_ACCESS_KEY_ID -e AWS_SECRET_ACCESS_KEY \
  amazon/aws-cli s3 cp "$FILE" "s3://$BACKUP_S3_BUCKET/" --endpoint-url "$BACKUP_S3_ENDPOINT"
rm -f "$FILE"
