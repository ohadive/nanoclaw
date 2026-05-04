#!/bin/bash
# mnemon SessionStart hook — report memory stats on session init.
STATS=$(mnemon status 2>/dev/null)
if [ -n "$STATS" ]; then
  INSIGHTS=$(echo "$STATS" | sed -n 's/.*"total_insights": *\([0-9]*\).*/\1/p' | head -1)
  EDGES=$(echo "$STATS" | sed -n 's/.*"edge_count": *\([0-9]*\).*/\1/p' | head -1)
  echo "[mnemon] Memory active (${INSIGHTS:-0} insights, ${EDGES:-0} edges)."
else
  echo "[mnemon] Memory active."
fi
