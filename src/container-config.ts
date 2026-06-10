/**
 * Per-group container config, stored as a plain JSON file at
 * `groups/<folder>/container.json`. Mounted read-only inside the container
 * at `/workspace/agent/container.json` — the runner reads it at startup but
 * cannot modify it. Config changes go through the self-mod approval flow.
 *
 * All fields are optional — a missing file or a partial file both resolve
 * to sensible defaults. Writes are atomic-enough (write-then-rename is not
 * worth the ceremony here since there's only one writer in practice: the
 * host, from the delivery thread that processes approved system actions).
 */
import fs from 'fs';
import path from 'path';

import { GROUPS_DIR } from './config.js';

export interface McpServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  // Optional always-in-context guidance. When set, the host writes the
  // content to `.claude-fragments/mcp-<name>.md` at spawn and imports it
  // into the composed CLAUDE.md.
  instructions?: string;
}

export interface AdditionalMountConfig {
  hostPath: string;
  containerPath: string;
  readonly?: boolean;
}

export interface ContainerConfig {
  mcpServers: Record<string, McpServerConfig>;
  packages: { apt: string[]; npm: string[] };
  imageTag?: string;
  additionalMounts: AdditionalMountConfig[];
  /** Which skills to enable — array of skill names or "all" (default). */
  skills: string[] | 'all';
  /** Agent provider name (e.g. "claude", "opencode"). Default: "claude". */
  provider?: string;
  /** Agent group display name (used in transcript archiving). */
  groupName?: string;
  /** Assistant display name (used in system prompt / responses). */
  assistantName?: string;
  /** Agent group ID — set by the host, read by the runner. */
  agentGroupId?: string;
  /** Max messages per prompt. Falls back to code default if unset. */
  maxMessagesPerPrompt?: number;
  /** Per-group env vars passed to the container (e.g. skill tokens). */
  env?: Record<string, string>;
  /** Per-group tool blocklist — appended to the SDK-level disallow list.
   * Use to filter specific MCP tools by exact name, e.g.
   * `mcp__typefully__create_draft` to make a Typefully MCP read-only. */
  disallowedTools?: string[];
}

function emptyConfig(): ContainerConfig {
  return {
    mcpServers: {},
    packages: { apt: [], npm: [] },
    additionalMounts: [],
    skills: 'all',
  };
}

function configPath(folder: string): string {
  return path.join(GROUPS_DIR, folder, 'container.json');
}

/**
 * Read the container config for a group, returning sensible defaults for
 * any missing fields.
 *
 * A *missing* file resolves to an empty config (a brand-new group). But a
 * file that EXISTS yet fails to parse is treated as corruption and THROWS —
 * it must not silently fall back to empty. Most callers read-modify-write
 * (spawn identity sync, image build, self-mod); if a corrupt read returned
 * an empty config, the subsequent write would persist that empty config and
 * PERMANENTLY destroy the real mounts / MCP servers / packages. Throwing
 * makes the caller abort before writing. The corrupt file is backed up to
 * `container.json.corrupt-<timestamp>` for recovery.
 *
 * `wakeContainer` already swallows spawn errors (host-sweep retries), so a
 * throw here aborts the spawn safely rather than crashing the host. Genuinely
 * read-only callers that can tolerate a missing config should catch and fall
 * back to `emptyConfig()` themselves.
 */
export function readContainerConfig(folder: string): ContainerConfig {
  const p = configPath(folder);
  if (!fs.existsSync(p)) return emptyConfig();
  let text: string;
  try {
    text = fs.readFileSync(p, 'utf8');
  } catch (err) {
    // I/O error on an existing file — don't risk a destructive write-back.
    throw new Error(`[container-config] cannot read ${p}: ${String(err)}`);
  }
  let raw: Partial<ContainerConfig>;
  try {
    raw = JSON.parse(text) as Partial<ContainerConfig>;
  } catch (err) {
    const backup = `${p}.corrupt-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    try {
      fs.copyFileSync(p, backup);
    } catch (backupErr) {
      console.error(`[container-config] failed to back up corrupt ${p}: ${String(backupErr)}`);
    }
    console.error(
      `[container-config] ${p} is not valid JSON (backed up to ${backup}). ` +
        `Refusing to load defaults — a write-back would erase the real config. ` +
        `Fix the file and retry. Parse error: ${String(err)}`,
    );
    throw new Error(`container.json for "${folder}" is corrupt: ${String(err)}`);
  }
  return {
    mcpServers: raw.mcpServers ?? {},
    packages: {
      apt: raw.packages?.apt ?? [],
      npm: raw.packages?.npm ?? [],
    },
    imageTag: raw.imageTag,
    additionalMounts: raw.additionalMounts ?? [],
    skills: raw.skills ?? 'all',
    provider: raw.provider,
    groupName: raw.groupName,
    assistantName: raw.assistantName,
    agentGroupId: raw.agentGroupId,
    maxMessagesPerPrompt: raw.maxMessagesPerPrompt,
    env: raw.env,
    disallowedTools: raw.disallowedTools,
  };
}

/**
 * Write the container config for a group, creating the groups/<folder>/
 * directory if necessary. Pretty-printed JSON so diffs in the activation
 * flow are reviewable.
 *
 * Writes atomically (temp file + rename) so a crash or a concurrent reader
 * never observes a half-written, unparseable container.json. A torn write is
 * what produces the corruption that `readContainerConfig` now refuses to load.
 */
export function writeContainerConfig(folder: string, config: ContainerConfig): void {
  const p = configPath(folder);
  const dir = path.dirname(p);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = `${p}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(config, null, 2) + '\n');
  fs.renameSync(tmp, p);
}

/**
 * Apply a mutator function to a group's container config and persist the
 * result. Convenient for append-style changes like `install_packages` and
 * `add_mcp_server` handlers.
 */
export function updateContainerConfig(folder: string, mutate: (config: ContainerConfig) => void): ContainerConfig {
  const config = readContainerConfig(folder);
  mutate(config);
  writeContainerConfig(folder, config);
  return config;
}

/**
 * Initialize an empty container.json for a group if one doesn't already
 * exist. Idempotent — used from `group-init.ts`.
 */
export function initContainerConfig(folder: string): boolean {
  const p = configPath(folder);
  if (fs.existsSync(p)) return false;
  writeContainerConfig(folder, emptyConfig());
  return true;
}
