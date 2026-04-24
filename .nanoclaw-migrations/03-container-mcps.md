# Container MCP integrations

Two coordinated changes: (1) volume mounts on the host side (`src/container-runner.ts`) so credential directories are accessible from inside the container; (2) MCP server registrations + allowed-tool entries on the container side (`container/agent-runner/src/index.ts`).

**Applies to all four MCPs:** Gmail (marty@), Gmail-Ohad (ohad@), Google Calendar, Notion.

## Design intent

- **Gmail dual-account.** marty@ is the primary (read/write); ohad@ is secondary (typically read calendars via delegate). Two separate Gmail MCP servers, two separate credential directories on the host, two separate allowed-tool prefixes (`mcp__gmail__*`, `mcp__gmail_ohad__*`).
- **Google Calendar.** Reuses the marty@ Gmail OAuth keys (`~/.gmail-mcp/gcp-oauth.keys.json`) — no separate OAuth app.
- **Notion.** Opens to **all groups** in v2 (previous v1 behavior was slack_main only — dropped per user decision during migration). Credential file is `~/.notion-mcp/token`; the MCP server gets `NOTION_TOKEN` in env.

## Notion / OneCLI proxy workaround (critical)

OneCLI is the sole credential path in v2 and acts as an HTTPS proxy that only proxies known services (Anthropic). Any MCP that hits a non-Anthropic API (like Notion's `api.notion.com`) breaks under the default proxy. The workaround is to set `NO_PROXY=api.notion.com` and clear the proxy env vars in the Notion MCP's `env` block. Without this, Notion API calls fail.

This workaround is required in v2; do not remove it.

## Host side — `src/container-runner.ts`

**Intent:** Mount host credential directories into the container, conditionally on their existence. `os.homedir()` resolves the actual user's home directory at runtime.

**Scope:** Non-standard

**How to apply:**

Add `import os from 'os';` near the top of the file (alongside the `fs`, `path` imports).

In `buildVolumeMounts(group, isMain)`, after the existing mount push (just before the per-group IPC namespace mount), add:

```typescript
// Gmail credentials directory (for Gmail MCP inside the container)
const homeDir = os.homedir();
const gmailDir = path.join(homeDir, '.gmail-mcp');
if (fs.existsSync(gmailDir)) {
  mounts.push({
    hostPath: gmailDir,
    containerPath: '/home/node/.gmail-mcp',
    readonly: false, // MCP may need to refresh OAuth tokens
  });
}

// Ohad's Gmail credentials (ohad@ account, separate from marty@)
const gmailOhadDir = path.join(homeDir, '.gmail-mcp-ohad');
if (fs.existsSync(gmailOhadDir)) {
  mounts.push({
    hostPath: gmailOhadDir,
    containerPath: '/home/node/.gmail-mcp-ohad',
    readonly: false,
  });
}

// Google Calendar MCP credentials
const gcalDir = path.join(homeDir, '.config', 'google-calendar-mcp');
if (fs.existsSync(gcalDir)) {
  mounts.push({
    hostPath: gcalDir,
    containerPath: '/home/node/.config/google-calendar-mcp',
    readonly: false,
  });
}

// Notion MCP credentials directory (all groups)
const notionDir = path.join(homeDir, '.notion-mcp');
if (fs.existsSync(notionDir)) {
  mounts.push({
    hostPath: notionDir,
    containerPath: '/home/node/.notion-mcp',
    readonly: true,
  });
}
```

**⚠️ Change from v1:** v1 gated the Notion mount on `group.folder === 'slack_main'`. In v2 the gate is **removed** — Notion mounts for all groups.

**⚠️ v2 risk:** v2 introduces a new entity model where users/roles/messaging-groups/agent-groups are separate entities. The `RegisteredGroup` type and `group.folder` field may have changed shape. Inspect `src/container-runner.ts` in the v2 worktree before applying — the mount-building function signature or the `group` parameter may differ.

**⚠️ v2 risk (two-DB split):** v2's two-DB session split (`inbound.db`/`outbound.db`) may change the mount layout entirely. The Gmail/Notion credential mounts should be independent of the session DB mounts, but verify they're not stepping on v2's new mount strategy.

## Container side — `container/agent-runner/src/index.ts`

**Intent:** Register four external MCP servers and allow their tools. The Notion MCP is conditionally registered only when the token file exists (otherwise the `ensureNotionToken` path would fail at spawn time).

**Scope:** Non-standard

**⚠️ v2 risk:** Agent-runner moves Node → Bun in v2. `fs.existsSync`, `fs.readFileSync`, and dynamic object spread (`...notionMcpConfig`) should all work under Bun, but verify. Also verify the SDK config shape — v2's claude-agent-sdk may have changed `allowedTools` → `allowedToolNames` or similar.

**How to apply:**

**1. Add the conditional Notion config before `runQuery()` is called** (the v1 snippet was after `waitForIpcMessage()`; in v2 pick an equivalent module-level location):

```typescript
// Notion MCP server config — enabled when token file is mounted
const NOTION_TOKEN_PATH = '/home/node/.notion-mcp/token';
const notionMcpConfig: Record<string, { command: string; args: string[]; env: Record<string, string> }> = {};
if (fs.existsSync(NOTION_TOKEN_PATH)) {
  const notionToken = fs.readFileSync(NOTION_TOKEN_PATH, 'utf-8').trim();
  if (notionToken) {
    notionMcpConfig.notion = {
      command: 'npx',
      args: ['-y', '@notionhq/notion-mcp-server'],
      env: {
        NOTION_TOKEN: notionToken,
        // Bypass OneCLI HTTPS proxy for Notion API — the gateway
        // only handles known services (Anthropic) and breaks others.
        NO_PROXY: 'api.notion.com',
        no_proxy: 'api.notion.com',
        HTTPS_PROXY: '',
        HTTP_PROXY: '',
        https_proxy: '',
        http_proxy: '',
      },
    };
    log('Notion MCP server enabled');
  }
}
```

**2. Extend `allowedTools` inside the SDK query options** (the v1 block around line 429 — find the equivalent in v2). Add these entries to the allowedTools array:

```typescript
'mcp__gmail__*',
'mcp__gmail_ohad__*',
'mcp__gcal__*',
'mcp__notion__*',
```

**3. Extend `mcpServers` inside the SDK query options** (the v1 block around line 447). After the existing `nanoclaw` server config, add:

```typescript
gmail: {
  command: 'npx',
  args: ['-y', '@gongrzhe/server-gmail-autoauth-mcp'],
},
gmail_ohad: {
  command: 'npx',
  args: ['-y', '@gongrzhe/server-gmail-autoauth-mcp'],
  env: {
    GMAIL_CREDENTIALS_PATH: '/home/node/.gmail-mcp-ohad/credentials.json',
    GMAIL_OAUTH_PATH: '/home/node/.gmail-mcp-ohad/gcp-oauth.keys.json',
  },
},
gcal: {
  command: 'npx',
  args: ['-y', '@cocal/google-calendar-mcp'],
  env: {
    GOOGLE_OAUTH_CREDENTIALS: '/home/node/.gmail-mcp/gcp-oauth.keys.json',
  },
},
...notionMcpConfig,
```

Note the spread of `notionMcpConfig` at the end — this is how the conditional registration works.

## Validation

After applying both sides:

1. Rebuild the container image (`./container/build.sh` or v2 equivalent). Cache busting may be needed — the CLAUDE.md warns `--no-cache` alone doesn't invalidate COPY steps; may need to prune the buildkit builder volume.
2. Start the service. Check logs for `Notion MCP server enabled` if the Notion token file exists. The Gmail/GCal MCPs log their own startup messages.
3. From a registered group, ask the agent to list Gmail labels or a Notion page — verify tools are callable and the proxy workaround works for Notion.
