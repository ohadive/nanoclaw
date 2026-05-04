---
name: add-mnemon
description: Add persistent graph-based memory to NanoClaw agents using mnemon. Agents recall context before responding and remember insights after. Each group gets isolated memory with optional global shared store.
---

# /add-mnemon

Adds [mnemon](https://github.com/mnemon-dev/mnemon) persistent memory to a NanoClaw install. After this skill runs, every new agent session gets per-group memory mounted at `/home/node/.mnemon/data/default` and (optionally) a read-only global memory at `/home/node/.mnemon/data/global`.

This skill is idempotent — re-running on an already-integrated install is a no-op. The wiring is also already present in this repo (this is the documentation/discovery file). The actual integration lives in:

- `container/Dockerfile` — installs the mnemon binary and copies hook scripts
- `container/skills/mnemon/SKILL.md` — container-side skill teaching the agent how to use mnemon
- `container/hooks/mnemon/{prime,user_prompt,stop,compact}.sh` — lifecycle hooks
- `src/container-runner.ts` — per-group + global volume mounts
- `src/group-init.ts` — idempotent registration of mnemon hooks in each group's settings.json

## Architecture

```
Host                              Container
~/.mnemon/data/{group.folder}/ ──rw──→ /home/node/.mnemon/data/default  (private)
~/.mnemon/data/global/         ──ro──→ /home/node/.mnemon/data/global   (shared, optional)
```

Each agent group gets its own isolated mnemon store, named after `group.folder`. The global store is mounted only if `~/.mnemon/data/global/` exists on the host.

## Pre-flight

1. Verify mnemon is installed on the host:
   ```bash
   mnemon --version
   ```
   If not installed:
   - macOS / Linux (Homebrew): `brew install mnemon-dev/tap/mnemon`
   - Go install: `go install github.com/mnemon-dev/mnemon@latest`

   Note: do NOT run `mnemon setup` on the host. That installs host-side hooks/skills and would conflict with claude-mem if you also use it. The host binary is only needed so other tools / introspection commands can read `~/.mnemon/data/`.

2. Pin the version in `container/Dockerfile`. Get the latest:
   ```bash
   curl -s https://api.github.com/repos/mnemon-dev/mnemon/releases/latest \
     | grep -o '"tag_name": "v[^"]*"' | cut -d'"' -f4 | sed 's/^v//'
   ```
   Update `ARG MNEMON_VERSION=...` in `container/Dockerfile` if it has drifted.

## Activation

After the wiring is in place (it already is in this repo), build the agent image and restart the host:

```bash
./container/build.sh
launchctl kickstart -k gui/$(id -u)/com.nanoclaw   # macOS
# systemctl --user restart nanoclaw                # Linux
```

The next agent session in any group will:
1. Find the mnemon binary at `/usr/local/bin/mnemon`
2. Auto-create `~/.mnemon/data/{group.folder}/` on the host (mkdirSync at spawn time)
3. Fire the four mnemon hooks (Prime / UserPromptSubmit / Stop / PreCompact)
4. Load the container-side `mnemon` skill teaching recall/remember/link

## Coexistence with claude-mem and CLAUDE.local.md

- **Host (your Mac):** claude-mem keeps capturing CLI sessions; mnemon binary is present but no host hooks fire.
- **Inside containers:** mnemon is the durable graph memory; `CLAUDE.local.md` and `conversations/` remain for top-of-context preferences and chronological transcripts. The container skill explains when to use which.

## Uninstall

To remove mnemon from this install:

1. Revert the changes in `container/Dockerfile`, `src/container-runner.ts`, and `src/group-init.ts`.
2. Delete `container/hooks/mnemon/` and `container/skills/mnemon/`.
3. Strip mnemon hooks from each group's settings.json:
   ```bash
   for f in data/v2-sessions/*/.claude-shared/settings.json; do
     jq 'del(.hooks.SessionStart, .hooks.UserPromptSubmit, .hooks.Stop, .hooks.PreCompact) | if .hooks == {} then del(.hooks) else . end' "$f" > "$f.tmp" && mv "$f.tmp" "$f"
   done
   ```
4. (Optional) `rm -rf ~/.mnemon/` to delete all stored memory.
5. Rebuild: `./container/build.sh`
