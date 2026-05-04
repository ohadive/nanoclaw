#!/bin/bash
# mnemon Stop hook — remind agent to consider remember after responding.
INPUT=$(cat)
MSG=$(echo "$INPUT" | jq -r '.last_assistant_message // ""' 2>/dev/null)
if echo "$MSG" | grep -qiE "mnemon remember|sub-agent.*remember|Stored.*imp="; then
  exit 0
fi
echo "[mnemon] Consider: does this exchange warrant a remember sub-agent?"
