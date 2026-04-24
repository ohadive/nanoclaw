# Source-code customizations

## `src/whatsapp-auth.ts` (new file)

**Intent:** Standalone CLI script that handles WhatsApp authentication (QR code or pairing code). Writes raw QR data to `store/qr-data.txt` so the setup-flow helper can render it, a status file to `store/auth-status.txt` so the helper can poll, and final creds to `store/auth/`. Handles disconnect-reason-515 stream errors by reconnecting once to finish the handshake.

**Scope:** Non-standard (new file, ~180 lines)

**How to apply:**

Create `src/whatsapp-auth.ts`. The easiest replay is to copy from the pre-migration tree — this file is the same v1 and v2 regardless of upstream refactors, since it depends only on Baileys:

```bash
git show pre-update-5754dd8-20260423-160211:src/whatsapp-auth.ts > src/whatsapp-auth.ts
```

If the backup tag is not available, see the full content in this session's pre-migration snapshot. The file imports from `@whiskeysockets/baileys` (`makeWASocket`, `Browsers`, `DisconnectReason`, `fetchLatestWaWebVersion`, `makeCacheableSignalKeyStore`, `useMultiFileAuthState`), `qrcode-terminal`, `pino`, `readline`, `fs`, `path`. No NanoClaw-internal imports.

Key behaviors to preserve:
- Reads `--pairing-code` and `--phone <num>` flags from `process.argv`.
- On `connection.update` with `qr`: writes QR to `QR_FILE`, renders terminal QR.
- On `connection.close` with reason `515`: reconnects once (`isReconnect=true`).
- On `connection.close` with reason `DisconnectReason.loggedOut` or `timedOut`: writes `failed:...` to `STATUS_FILE`, exits 1.
- On `connection.open`: writes `authenticated` to `STATUS_FILE`, cleans QR file, exits 0.
- Already-registered: writes `already_authenticated`, exits 0.

Usage after install: `npx tsx src/whatsapp-auth.ts` (QR) or `npx tsx src/whatsapp-auth.ts --pairing-code --phone 14155551234` (pairing).

## `setup/whatsapp-auth.ts` (new file)

**Intent:** Setup-flow step that orchestrates `src/whatsapp-auth.ts`. Spawns it as a subprocess, polls the status file, renders the QR in a browser window (or displays the pairing code), reports success/failure via the setup status protocol (`emitStatus('AUTH_WHATSAPP', fields)`).

**Scope:** Non-standard (new file, ~370 lines)

**⚠️ v2 risk:** The v2 CHANGELOG says *"Install flow replaced. `bash nanoclaw.sh` is the new default"*. The `setup/index.ts` `STEPS` registry may no longer exist in v2 — inspect `setup/index.ts` and `nanoclaw.sh` in the worktree before proceeding. If the registry is gone, the integration point moves.

**How to apply (if the `setup/index.ts` STEPS registry still exists in v2):**

1. Copy the full file from the backup:
```bash
git show pre-update-5754dd8-20260423-160211:setup/whatsapp-auth.ts > setup/whatsapp-auth.ts
```

2. Register the step in `setup/index.ts`:
```typescript
const STEPS: Record<...> = {
  // ... existing steps (channels, deps, mounts, service, verify) ...
  'whatsapp-auth': () => import('./whatsapp-auth.js'),
};
```

The file depends on these setup-module helpers (check they still exist with the same names in v2):
- `openBrowser`, `isHeadless` from `./platform.js`
- `emitStatus` from `./status.js`
- `logger` from `../src/logger.js`

It depends on these runtime behaviors:
- Writes QR SVG HTML to `store/qr-auth.html`, opens in browser
- Polls `store/auth-status.txt` for `authenticated` / `failed:<reason>`
- Reads `store/auth/creds.json` to extract phone number on success

**How to apply (if v2 setup is replaced by `bash nanoclaw.sh`):**

This is the likely case. The v2 equivalent is probably a shell-script step that calls `npx tsx src/whatsapp-auth.ts` with appropriate flags. Options:

- **Option A (recommended):** Check if the v2 `/add-whatsapp` skill already bundles an auth step. If yes, use it and skip this file.
- **Option B:** Keep `src/whatsapp-auth.ts` as the standalone tool and invoke it manually (once, during setup) via `npx tsx src/whatsapp-auth.ts`. Drop `setup/whatsapp-auth.ts` entirely — the fancy browser-QR UX becomes optional.
- **Option C:** Port `setup/whatsapp-auth.ts` to the v2 bash script. Probably not worth the effort unless the browser QR render is important.

Ask the user which option they want before implementing.

## `src/db.ts` — `getMessageContentById`

**Intent:** Retrieve the text content of a previously-stored message by its WhatsApp message id + chat JID. Needed by the WhatsApp channel's `getMessage` callback so Baileys can re-encrypt on retry. Without this, self-chat messages show "waiting for this message" indefinitely.

**Scope:** Standard

**⚠️ v2 risk:** v2 splits the session DB into `inbound.db` (host-writes, container-reads) and `outbound.db` (container-writes, host-reads). Received messages are likely in `inbound.db` on the host side. Identify which DB handle `src/db.ts` exposes (or if the API is now split by direction), and add the function targeting the correct one.

**How to apply:**

In v2 `src/db.ts` (or whichever module exposes the host-side read of the inbound/messages table), add:

```typescript
export function getMessageContentById(
  id: string,
  chatJid: string,
): string | undefined {
  const row = db
    .prepare(`SELECT content FROM messages WHERE id = ? AND chat_jid = ?`)
    .get(id, chatJid) as { content: string } | undefined;
  return row?.content;
}
```

Adjust the `db` reference and table name (`messages`) to match v2's schema. If the table has been renamed (e.g. `inbound_messages`) or the columns changed (e.g. `chat_id` instead of `chat_jid`), adapt accordingly.

The caller (in `src/channels/whatsapp.ts` `getMessage` callback) does:
```typescript
const content =
  key.id && key.remoteJid
    ? getMessageContentById(key.id, key.remoteJid)
    : undefined;
```

## `src/types.ts` — `thread_id` on `NewMessage`

**Intent:** Optional thread identifier for channels that support threading (Slack, Gmail). Passed through from channel → router → storage.

**Scope:** Standard

**How to apply:**

Add `thread_id?: string` to the `NewMessage` interface (or whichever v2 type plays the same role — possibly renamed under the new entity model):

```typescript
export interface NewMessage {
  // ... existing fields ...
  thread_id?: string;
}
```

If v2 has already added thread support natively, verify the field name and skip.

## Ignored
- `src/channels/index.ts` — v1 added explicit `import './gmail.js'` etc. V2 uses self-registering channels (per CLAUDE.md); these imports should already be generated correctly by the v2 channel skills.
- `src/ipc.ts` — whitespace/comment-only diff.
- `src/container-runtime.test.ts` — test-formatting-only diff.
