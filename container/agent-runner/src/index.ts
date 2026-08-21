/**
 * NanoClaw Agent Runner v2
 *
 * Runs inside a container. All message IO goes through the registered mailbox.
 *
 * Config is read from /workspace/agent/container.json (mounted RO).
 * Only TZ and OneCLI networking vars come from env.
 *
 * Mount structure:
 *   /workspace/
 *     mailbox state     ← selected implementation
 *     .heartbeat        ← container touches for liveness detection
 *     outbox/           ← outbound files
 *     agent/            ← agent group folder (CLAUDE.md, container.json, working files)
 *       container.json  ← per-group config (RO nested mount)
 *     global/           ← shared global memory (RO)
 *   /app/src/           ← shared agent-runner source (RO)
 *   /app/skills/        ← shared skills (RO)
 *   /home/node/.claude/ ← Claude SDK state + skill symlinks (RW)
 */

import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { loadConfig } from './config.js';
import { buildSystemPromptAddendum } from './destinations.js';
import { getTaskSeriesId } from './db/session-routing.js';
import { ensureMemoryScaffold } from './memory/scaffold.js';
import { MEMORY_SESSION_HOOK } from './memory/session-hook.js';
// Module barrel — loads registration modules, including the singular mailbox slot.
import './modules/index.js';
import { getAgentMailbox, readMailboxContext } from './mailbox/index.js';
// Providers barrel — each enabled provider self-registers on import.
// Provider skills append imports to providers/index.ts.
import './providers/index.js';
import { createProvider, type ProviderName } from './providers/factory.js';
import { resolvePluginServer } from './plugin-mcp.js';
import type { McpServerConfig } from './providers/types.js';
import { runPollLoop } from './poll-loop.js';

function log(msg: string): void {
  console.error(`[agent-runner] ${msg}`);
}

const CWD = '/workspace/agent';

async function main(): Promise<void> {
  const config = loadConfig();
  const providerName = config.provider.toLowerCase() as ProviderName;
  const mailbox = getAgentMailbox();
  await mailbox.start(await readMailboxContext());

  log(`Starting v2 agent-runner (provider: ${providerName})`);

  // Every provider shares one persistent memory tree. Legacy imports are an
  // operator-run migration and never happen in this normal startup path.
  ensureMemoryScaffold();

  // Runtime-generated system-prompt addendum: agent identity (name) plus
  // the live destinations map. Everything else (capabilities, per-module
  // instructions, per-channel formatting) is loaded by Claude Code from
  // /workspace/agent/CLAUDE.md — the composed entry imports the shared
  // base (/app/CLAUDE.md) and each enabled module's fragment. Memory is
  // supplied separately by each provider's native lifecycle hook.
  const taskId = getTaskSeriesId();
  const instructions = buildSystemPromptAddendum(
    config.assistantName || undefined,
    taskId ? { kind: 'task', taskId } : { kind: 'chat' },
  );

  // Discover additional directories mounted at /workspace/extra/*
  const additionalDirectories: string[] = [];
  const extraBase = '/workspace/extra';
  if (fs.existsSync(extraBase)) {
    for (const entry of fs.readdirSync(extraBase)) {
      const fullPath = path.join(extraBase, entry);
      if (fs.statSync(fullPath).isDirectory()) {
        additionalDirectories.push(fullPath);
      }
    }
    if (additionalDirectories.length > 0) {
      log(`Additional directories: ${additionalDirectories.join(', ')}`);
    }
  }

  // MCP server path — bun runs TS directly; no tsc build step in-image.
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const mcpServerPath = path.join(__dirname, 'mcp-tools', 'index.ts');

  // Build MCP servers config: nanoclaw built-in + any from container.json
  const mcpServers: Record<string, McpServerConfig> = {
    nanoclaw: {
      command: 'bun',
      args: ['run', mcpServerPath],
      env: {},
    },
  };

  for (const [name, serverConfig] of Object.entries(config.mcpServers)) {
    // Plugin-shipped servers get ${PLUGIN_ROOT}/${PLUGIN_DATA} expansion and
    // the two injected env vars; everything else passes through untouched.
    mcpServers[name] = resolvePluginServer(serverConfig);
    log(
      serverConfig.type === 'http'
        ? `Additional MCP server: ${name} (HTTP)`
        : `Additional MCP server: ${name} (${serverConfig.command})`,
    );
  }

  // Global MCP servers enabled when their credential files are mounted from
  // the host. Available to all agent groups (v1 behavior preserved).
  // Notion MCP requires clearing HTTPS_PROXY — OneCLI's gateway only routes
  // Anthropic APIs, so Notion calls must bypass the proxy.
  const NOTION_TOKEN_PATH = '/home/node/.notion-mcp/token';
  const GMAIL_CREDS_PATH = '/home/node/.gmail-mcp/credentials.json';
  const GMAIL_OHAD_CREDS_PATH = '/home/node/.gmail-mcp-ohad/credentials.json';
  const GCAL_OAUTH_PATH = '/home/node/.gmail-mcp/gcp-oauth.keys.json';

  // zod is pinned because @gongrzhe/server-gmail-autoauth-mcp@1.1.11 declares
  // `"zod": "^3.22.4"` and breaks at import-time on zod >= 3.25 (the v3
  // submodule export shape changed). Without --package overrides, npx -y
  // resolves the latest zod and the Gmail MCP exits before the SDK can
  // connect — Gmail tools silently disappear from the agent's tool list.
  const GMAIL_NPX_ARGS = [
    '-y',
    '--package=zod@3.23.8',
    '--package=@gongrzhe/server-gmail-autoauth-mcp@1.1.11',
    '--',
    'gmail-mcp',
  ];
  // OneCLI's gateway only routes Anthropic APIs, so npm/npx installs and
  // Google API calls must bypass the proxy. Without this, esbuild's
  // postinstall (a transitive dep) fails downloading its native binary and
  // the MCP server never starts.
  const NO_PROXY_ENV = {
    HTTPS_PROXY: '',
    HTTP_PROXY: '',
    https_proxy: '',
    http_proxy: '',
  };
  // Both gmail entries below use identical npx args, so the first time they
  // spawn (cache empty) two npm reify operations race for the same npx cache
  // dir and one of them dies with "unfinished npm timer reify" → that MCP
  // server never starts. Pre-warm the npx cache once, synchronously, before
  // handing the config to the SDK. After this, both spawns are cache hits.
  if (fs.existsSync(GMAIL_CREDS_PATH) || fs.existsSync(GMAIL_OHAD_CREDS_PATH)) {
    log('Pre-warming Gmail MCP npx cache...');
    // Replace the trailing `gmail-mcp` binary invocation with a no-op so npx
    // installs the packages and exits cleanly. The actual MCP server runs
    // later when the SDK spawns the cached binary.
    const warmArgs = [
      '-y',
      '--package=zod@3.23.8',
      '--package=@gongrzhe/server-gmail-autoauth-mcp@1.1.11',
      '--',
      'node',
      '-e',
      'process.exit(0)',
    ];
    const warm = spawnSync('npx', warmArgs, {
      env: { ...process.env, ...NO_PROXY_ENV },
      stdio: 'pipe',
      timeout: 180_000,
      encoding: 'utf-8',
    });
    if (warm.status === 0) {
      log('Gmail MCP npx cache warmed');
    } else {
      log(`WARN: Gmail MCP cache warm exited ${warm.status} signal=${warm.signal} — falling back to lazy install`);
      if (warm.stderr) log(`  stderr: ${warm.stderr.slice(-500)}`);
    }
  }
  if (fs.existsSync(GMAIL_CREDS_PATH)) {
    mcpServers.gmail = {
      command: 'npx',
      args: GMAIL_NPX_ARGS,
      env: { ...NO_PROXY_ENV },
    };
    log('Gmail MCP server enabled');
  }
  if (fs.existsSync(GMAIL_OHAD_CREDS_PATH)) {
    mcpServers.gmail_ohad = {
      command: 'npx',
      args: GMAIL_NPX_ARGS,
      env: {
        ...NO_PROXY_ENV,
        GMAIL_CREDENTIALS_PATH: '/home/node/.gmail-mcp-ohad/credentials.json',
        GMAIL_OAUTH_PATH: '/home/node/.gmail-mcp-ohad/gcp-oauth.keys.json',
      },
    };
    log('Gmail-Ohad MCP server enabled');
  }
  if (fs.existsSync(GCAL_OAUTH_PATH)) {
    mcpServers.gcal = {
      command: 'npx',
      args: ['-y', '@cocal/google-calendar-mcp'],
      env: {
        ...NO_PROXY_ENV,
        GOOGLE_OAUTH_CREDENTIALS: GCAL_OAUTH_PATH,
      },
    };
    log('Google Calendar MCP server enabled');
  }
  if (fs.existsSync(NOTION_TOKEN_PATH)) {
    const notionToken = fs.readFileSync(NOTION_TOKEN_PATH, 'utf-8').trim();
    if (notionToken) {
      mcpServers.notion = {
        command: 'npx',
        args: ['-y', '@notionhq/notion-mcp-server'],
        env: {
          NOTION_TOKEN: notionToken,
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

  const provider = createProvider(providerName, {
    assistantName: config.assistantName || undefined,
    mcpServers,
    env: { ...process.env },
    additionalDirectories: additionalDirectories.length > 0 ? additionalDirectories : undefined,
    extraDisallowedTools: config.disallowedTools,
    model: config.model,
    effort: config.effort,
  });
  provider.registerMemorySessionHook(MEMORY_SESSION_HOOK);

  try {
    await runPollLoop({
      provider,
      providerName,
      cwd: CWD,
      systemContext: { instructions },
    });
  } finally {
    await mailbox.stop();
  }
}

main().catch((err) => {
  log(`Fatal error: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
