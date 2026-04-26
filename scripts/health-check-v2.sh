#!/bin/bash
# NanoClaw v2 health check — fired by ~/Library/LaunchAgents/com.nanoclaw.health-check-2026-05-01.plist
# Self-uninstalls at the end so it only runs once.
#
# Background: ran /migrate-nanoclaw on 2026-04-24. This is the post-migration
# health pass scheduled for 1 week later. If anything below is off, the most
# common issue is OneCLI agents stuck in `selective` secret mode (see
# CLAUDE.md "Gotcha: auto-created agents start in `selective` secret mode").

set -u

PROJECT_ROOT="/Users/ohad/Projects/nanoclaw"
LOG_DIR="$PROJECT_ROOT/logs"
PLIST_LABEL="com.nanoclaw.health-check-2026-05-01"
PLIST_PATH="$HOME/Library/LaunchAgents/$PLIST_LABEL.plist"
TIMESTAMP=$(date +%Y-%m-%d-%H%M%S)
REPORT="$LOG_DIR/health-check-v2-$TIMESTAMP.log"

mkdir -p "$LOG_DIR"

# Common tool paths (launchd starts with a minimal PATH).
export PATH="/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin:$HOME/.local/bin:$PATH"

cd "$PROJECT_ROOT" || { echo "Cannot cd to $PROJECT_ROOT" >&2; exit 1; }

ISSUES=0

note() {
  echo "" >> "$REPORT"
  echo "=== $* ===" >> "$REPORT"
}

flag() {
  ISSUES=$((ISSUES + 1))
  echo "  [FLAG] $*" >> "$REPORT"
}

ok() {
  echo "  [OK]   $*" >> "$REPORT"
}

{
  echo "NanoClaw v2 health check — $(date)"
  echo "Project: $PROJECT_ROOT"
  echo "Migration: 2026-04-24 (v1 -> v2)"
} > "$REPORT"

# 1. Service running
note "1. launchd service"
PID=$(launchctl list | awk '$3 == "com.nanoclaw" {print $1}')
if [ -n "$PID" ] && [ "$PID" != "-" ]; then
  ok "com.nanoclaw running, PID $PID"
else
  flag "com.nanoclaw not running. Try: launchctl load ~/Library/LaunchAgents/com.nanoclaw.plist"
fi

# 2. Recent log activity
note "2. log activity"
if [ -f "$LOG_DIR/nanoclaw.log" ]; then
  LAST_LINE_TS=$(tail -1 "$LOG_DIR/nanoclaw.log" | grep -oE '\[[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]+\]' | head -1)
  STAT_MTIME=$(stat -f '%Sm' -t '%Y-%m-%d %H:%M:%S' "$LOG_DIR/nanoclaw.log")
  ok "nanoclaw.log last modified $STAT_MTIME (last entry $LAST_LINE_TS)"
else
  flag "logs/nanoclaw.log missing"
fi

if [ -f "$LOG_DIR/nanoclaw.error.log" ]; then
  ERR_RECENT=$(find "$LOG_DIR/nanoclaw.error.log" -newermt "1 day ago" 2>/dev/null)
  if [ -n "$ERR_RECENT" ]; then
    ERR_LINES=$(wc -l < "$LOG_DIR/nanoclaw.error.log" | tr -d ' ')
    ERR_TAIL=$(tail -50 "$LOG_DIR/nanoclaw.error.log")
    flag "nanoclaw.error.log has recent entries ($ERR_LINES total). Tail:"
    echo "$ERR_TAIL" | sed 's/^/    /' >> "$REPORT"
  else
    ok "nanoclaw.error.log has no entries in the last day"
  fi
else
  ok "nanoclaw.error.log absent (no errors yet — or log file rotated)"
fi

# 3. v2 entity model populated
note "3. v2 entity model"
if [ -f "$PROJECT_ROOT/data/v2.db" ]; then
  AG_COUNT=$(sqlite3 "$PROJECT_ROOT/data/v2.db" "SELECT COUNT(*) FROM agent_groups" 2>/dev/null || echo "ERR")
  MG_COUNT=$(sqlite3 "$PROJECT_ROOT/data/v2.db" "SELECT COUNT(*) FROM messaging_groups" 2>/dev/null || echo "ERR")
  WIRE_COUNT=$(sqlite3 "$PROJECT_ROOT/data/v2.db" "SELECT COUNT(*) FROM messaging_group_agents" 2>/dev/null || echo "ERR")
  if [ "$AG_COUNT" = "ERR" ] || [ "$MG_COUNT" = "ERR" ] || [ "$WIRE_COUNT" = "ERR" ]; then
    flag "could not query data/v2.db"
  else
    if [ "$AG_COUNT" -gt 0 ] && [ "$MG_COUNT" -gt 0 ] && [ "$WIRE_COUNT" -gt 0 ]; then
      ok "agent_groups=$AG_COUNT, messaging_groups=$MG_COUNT, messaging_group_agents=$WIRE_COUNT"
    else
      flag "v2 entity tables under-populated: agent_groups=$AG_COUNT, messaging_groups=$MG_COUNT, messaging_group_agents=$WIRE_COUNT (expected all > 0)"
    fi
  fi
else
  flag "data/v2.db missing — has the host process initialized v2 yet?"
fi

# 4. OneCLI secret modes
note "4. OneCLI agent secret modes"
if command -v onecli >/dev/null 2>&1; then
  AGENTS_RAW=$(onecli agents list 2>&1)
  if echo "$AGENTS_RAW" | grep -qiE '(error|connection|refused)'; then
    flag "onecli agents list failed: $(echo "$AGENTS_RAW" | head -3)"
  else
    echo "$AGENTS_RAW" | sed 's/^/    /' >> "$REPORT"
    AGENT_IDS=$(echo "$AGENTS_RAW" | awk '/^[a-zA-Z0-9_-]{8,}/ {print $1}' | grep -E '^[a-zA-Z0-9_-]+$')
    if [ -z "$AGENT_IDS" ]; then
      ok "no OneCLI agents yet (none auto-created — first session may not have spawned)"
    else
      for ID in $AGENT_IDS; do
        SECRETS=$(onecli agents secrets --id "$ID" 2>&1)
        if echo "$SECRETS" | grep -qiE '(no secrets|empty|0 secrets)'; then
          flag "agent $ID has no secrets assigned. Run: onecli agents set-secret-mode --id $ID --mode all"
        else
          ok "agent $ID has secrets assigned"
        fi
      done
    fi
  fi
else
  flag "onecli not on PATH — gateway may not be installed"
fi

# 5. Container image current
note "5. container image"
if command -v docker >/dev/null 2>&1; then
  V2_IMG=$(docker images --format '{{.Repository}}:{{.Tag}}' 2>/dev/null | grep -E 'nanoclaw-agent-v2' | head -3)
  if [ -n "$V2_IMG" ]; then
    ok "v2 container image present:"
    echo "$V2_IMG" | sed 's/^/    /' >> "$REPORT"
  else
    flag "no nanoclaw-agent-v2-* image. Rebuild: ./container/build.sh"
  fi
else
  flag "docker not on PATH — Docker Desktop running?"
fi

# 6. Recent message flow
note "6. recent session activity"
SESSIONS_DIR="$PROJECT_ROOT/data/v2-sessions"
if [ -d "$SESSIONS_DIR" ]; then
  NEWEST=$(ls -t "$SESSIONS_DIR"/*/outbound.db 2>/dev/null | head -1)
  if [ -n "$NEWEST" ]; then
    SESS_ID=$(basename "$(dirname "$NEWEST")")
    OUT_COUNT=$(sqlite3 "$NEWEST" "SELECT COUNT(*) FROM messages_out" 2>/dev/null || echo "ERR")
    OUT_LATEST=$(sqlite3 "$NEWEST" "SELECT MAX(created_at) FROM messages_out" 2>/dev/null || echo "ERR")
    if [ "$OUT_COUNT" = "ERR" ]; then
      flag "could not read $NEWEST"
    elif [ "$OUT_COUNT" = "0" ]; then
      flag "newest session $SESS_ID has 0 outbound messages — agent may not have replied since spawn"
    else
      ok "newest session $SESS_ID: $OUT_COUNT outbound messages, latest at $OUT_LATEST"
    fi
  else
    flag "no session DBs under data/v2-sessions/ — no agent has run since migration"
  fi
else
  flag "data/v2-sessions/ missing"
fi

# 7. Backup tag for rollback safety
note "7. rollback backup tag"
if git -C "$PROJECT_ROOT" tag | grep -q '^pre-migrate-40aa6ad'; then
  ok "backup tag pre-migrate-40aa6ad-* still in place. Rollback: git reset --hard pre-migrate-40aa6ad-20260424-115328"
else
  flag "pre-migrate-40aa6ad-* tag missing — rollback to v1 no longer trivial via tag"
fi

# Summary + notification
note "summary"
if [ "$ISSUES" -eq 0 ]; then
  echo "  All checks passed. v2 install looks healthy." >> "$REPORT"
  TITLE="NanoClaw v2: healthy"
  MSG="All 7 checks passed. Report: $REPORT"
else
  echo "  $ISSUES issue(s) flagged. Review the [FLAG] lines above." >> "$REPORT"
  TITLE="NanoClaw v2: $ISSUES issue(s)"
  MSG="See $REPORT"
fi

# macOS notification (best-effort)
osascript -e "display notification \"$MSG\" with title \"$TITLE\"" >/dev/null 2>&1 || true

# Self-uninstall so this never fires again
launchctl unload "$PLIST_PATH" 2>/dev/null || true
rm -f "$PLIST_PATH"
echo "" >> "$REPORT"
echo "Plist self-uninstalled: $PLIST_PATH removed." >> "$REPORT"

exit 0
