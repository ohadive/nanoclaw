#!/bin/bash
# Rotate NanoClaw host logs via copy-truncate.
#
# Why copy-truncate (not rename): the logs are written by the launchd-managed
# host process via StandardOutPath/StandardErrorPath, which hold the file open
# in O_APPEND mode. Renaming the file would leave the process writing to the
# old inode forever. Truncating in place is safe with O_APPEND — the next write
# lands at the new EOF (offset 0). macOS newsyslog has no copytruncate, so we
# do it here and schedule via a launchd StartCalendarInterval agent.
set -euo pipefail

LOGDIR="/Users/ohad/Projects/nanoclaw/logs"
MAX_BYTES=$((50 * 1024 * 1024))   # rotate a log only once it exceeds 50MB
KEEP=3                            # keep this many gzipped snapshots

for base in nanoclaw.log nanoclaw.error.log; do
  f="$LOGDIR/$base"
  [ -f "$f" ] || continue
  size=$(stat -f '%z' "$f" 2>/dev/null || echo 0)
  [ "$size" -gt "$MAX_BYTES" ] || continue

  # Age out old snapshots: .2.gz -> .3.gz, .1.gz -> .2.gz
  i=$KEEP
  while [ "$i" -ge 2 ]; do
    prev=$((i - 1))
    [ -f "$f.$prev.gz" ] && mv -f "$f.$prev.gz" "$f.$i.gz"
    i=$prev
  done

  # Snapshot the live file, then truncate it in place (O_APPEND-safe).
  cp "$f" "$f.1"
  : > "$f"
  gzip -f "$f.1"
  echo "$(date '+%Y-%m-%d %H:%M:%S') rotated $base (was $((size / 1024 / 1024))MB)"
done
