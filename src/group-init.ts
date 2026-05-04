import fs from 'fs';
import path from 'path';

import { DATA_DIR, GROUPS_DIR } from './config.js';
import { initContainerConfig } from './container-config.js';
import { log } from './log.js';
import type { AgentGroup } from './types.js';

const DEFAULT_SETTINGS_JSON =
  JSON.stringify(
    {
      env: {
        CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: '1',
        CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD: '1',
        CLAUDE_CODE_DISABLE_AUTO_MEMORY: '0',
      },
    },
    null,
    2,
  ) + '\n';

const MNEMON_HOOKS: Record<string, Array<{ hooks: Array<{ type: string; command: string }> }>> = {
  SessionStart: [{ hooks: [{ type: 'command', command: '/app/hooks/mnemon/prime.sh' }] }],
  UserPromptSubmit: [{ hooks: [{ type: 'command', command: '/app/hooks/mnemon/user_prompt.sh' }] }],
  Stop: [{ hooks: [{ type: 'command', command: '/app/hooks/mnemon/stop.sh' }] }],
  PreCompact: [{ hooks: [{ type: 'command', command: '/app/hooks/mnemon/compact.sh' }] }],
};

/**
 * Idempotent merge of mnemon hooks into the group's settings.json. Runs on
 * every initGroupFilesystem call so existing groups (which already have a
 * settings.json from before mnemon shipped) also pick up the hooks. Skips
 * silently on malformed JSON to avoid breaking a group spawn.
 */
function ensureMnemonHooks(settingsFile: string): boolean {
  let settings: { hooks?: Record<string, Array<{ hooks?: Array<{ command?: string }> }>>; [k: string]: unknown } = {};
  if (fs.existsSync(settingsFile)) {
    try {
      settings = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
    } catch {
      return false;
    }
  }
  const existingHooks = settings.hooks ?? {};
  let changed = false;
  for (const [event, entries] of Object.entries(MNEMON_HOOKS)) {
    const existing = existingHooks[event] ?? [];
    const alreadyHas = existing.some((entry) =>
      entry?.hooks?.some((h) => typeof h?.command === 'string' && h.command.startsWith('/app/hooks/mnemon/'))
    );
    if (!alreadyHas) {
      existingHooks[event] = [...existing, ...entries];
      changed = true;
    }
  }
  if (changed) {
    settings.hooks = existingHooks;
    fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2) + '\n');
  }
  return changed;
}

/**
 * Initialize the on-disk filesystem state for an agent group. Idempotent —
 * every step is gated on the target not already existing, so re-running on
 * an already-initialized group is a no-op.
 *
 * Called once per group lifetime at creation, or defensively from
 * `buildMounts()` for groups that pre-date this code path.
 *
 * Source code and skills are shared RO mounts — not copied per-group.
 * Skill symlinks are synced at spawn time by container-runner.ts.
 *
 * The composed `CLAUDE.md` is NOT written here — it's regenerated on every
 * spawn by `composeGroupClaudeMd()` (see `claude-md-compose.ts`). Initial
 * per-group instructions (if provided) seed `CLAUDE.local.md`.
 */
export function initGroupFilesystem(group: AgentGroup, opts?: { instructions?: string }): void {
  const initialized: string[] = [];

  // 1. groups/<folder>/ — group memory + working dir
  const groupDir = path.resolve(GROUPS_DIR, group.folder);
  if (!fs.existsSync(groupDir)) {
    fs.mkdirSync(groupDir, { recursive: true });
    initialized.push('groupDir');
  }

  // groups/<folder>/CLAUDE.local.md — per-group agent memory, auto-loaded by
  // Claude Code. Seeded with caller-provided instructions on first creation.
  const claudeLocalFile = path.join(groupDir, 'CLAUDE.local.md');
  if (!fs.existsSync(claudeLocalFile)) {
    const body = opts?.instructions ? opts.instructions + '\n' : '';
    fs.writeFileSync(claudeLocalFile, body);
    initialized.push('CLAUDE.local.md');
  }

  // groups/<folder>/container.json — empty container config, replaces the
  // former agent_groups.container_config DB column. Self-modification flows
  // read and write this file directly.
  if (initContainerConfig(group.folder)) {
    initialized.push('container.json');
  }

  // 2. data/v2-sessions/<id>/.claude-shared/ — Claude state + per-group skills
  const claudeDir = path.join(DATA_DIR, 'v2-sessions', group.id, '.claude-shared');
  if (!fs.existsSync(claudeDir)) {
    fs.mkdirSync(claudeDir, { recursive: true });
    initialized.push('.claude-shared');
  }

  const settingsFile = path.join(claudeDir, 'settings.json');
  if (!fs.existsSync(settingsFile)) {
    fs.writeFileSync(settingsFile, DEFAULT_SETTINGS_JSON);
    initialized.push('settings.json');
  }
  if (ensureMnemonHooks(settingsFile)) {
    initialized.push('mnemon-hooks');
  }

  // Skills directory — created empty here; symlinks are synced at spawn
  // time by container-runner.ts based on container.json skills selection.
  const skillsDst = path.join(claudeDir, 'skills');
  if (!fs.existsSync(skillsDst)) {
    fs.mkdirSync(skillsDst, { recursive: true });
    initialized.push('skills/');
  }

  if (initialized.length > 0) {
    log.info('Initialized group filesystem', {
      group: group.name,
      folder: group.folder,
      id: group.id,
      steps: initialized,
    });
  }
}
