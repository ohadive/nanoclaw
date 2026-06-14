#!/bin/bash
# One-shot wrapper: launchd fires this at 5am IDT 2026-05-08.
# Runs Claude Code headless against the Watchtower setup prompt, then self-cleans.

set -u

NANOCLAW_DIR="/Users/ohad/Projects/nanoclaw"
LOG_DIR="$NANOCLAW_DIR/logs"
LOG_FILE="$LOG_DIR/watchtower-setup.log"
PROMPT_FILE="$NANOCLAW_DIR/scripts/watchtower-setup-prompt.md"
PLIST_LABEL="com.nanoclaw.watchtower-setup"
PLIST_PATH="$HOME/Library/LaunchAgents/$PLIST_LABEL.plist"
CLAUDE_BIN="/Users/ohad/.local/bin/claude"

mkdir -p "$LOG_DIR"

{
  echo "===================="
  echo "Watchtower setup run: $(date -Iseconds)"
  echo "===================="
} >> "$LOG_FILE"

cd "$NANOCLAW_DIR" || {
  echo "FATAL: cannot cd into $NANOCLAW_DIR" >> "$LOG_FILE"
  exit 1
}

# Run Claude Code headless with the prompt; --dangerously-skip-permissions
# is required for unattended execution. Tier 1 scope is enforced by the
# prompt content, not by permission gating.
"$CLAUDE_BIN" --dangerously-skip-permissions -p "$(cat "$PROMPT_FILE")" \
  >> "$LOG_FILE" 2>&1
EXIT_CODE=$?

{
  echo "Claude exit code: $EXIT_CODE"
  echo "Run ended: $(date -Iseconds)"
} >> "$LOG_FILE"

# Self-cleanup: unload the plist so it never fires again.
# (StartCalendarInterval is recurring; we want one-shot semantics.)
launchctl bootout "gui/$(id -u)/$PLIST_LABEL" 2>>"$LOG_FILE" \
  || launchctl unload "$PLIST_PATH" 2>>"$LOG_FILE"
rm -f "$PLIST_PATH"

echo "Plist removed. One-shot complete." >> "$LOG_FILE"
exit $EXIT_CODE
