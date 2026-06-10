import fs from 'fs';
import path from 'path';

import { afterEach, describe, expect, it } from 'vitest';

import { GROUPS_DIR } from './config.js';
import { readContainerConfig, writeContainerConfig } from './container-config.js';

// Use a throwaway folder under the real GROUPS_DIR (configPath resolves against
// it). Unique-per-run name keeps parallel runs from colliding.
const FOLDER = `__cfgtest_${process.pid}__`;
const dir = path.join(GROUPS_DIR, FOLDER);
const file = path.join(dir, 'container.json');

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('readContainerConfig', () => {
  it('returns an empty config when the file is absent', () => {
    const cfg = readContainerConfig(FOLDER);
    expect(cfg.additionalMounts).toEqual([]);
    expect(cfg.mcpServers).toEqual({});
    expect(cfg.skills).toBe('all');
  });

  it('round-trips a valid config', () => {
    const written = {
      mcpServers: {},
      packages: { apt: [], npm: [] },
      additionalMounts: [{ hostPath: '/x', containerPath: 'projects/x', readonly: false }],
      skills: 'all' as const,
      agentGroupId: 'ag-1',
      groupName: 'G',
      assistantName: 'G',
    };
    writeContainerConfig(FOLDER, written);
    const cfg = readContainerConfig(FOLDER);
    expect(cfg.additionalMounts).toEqual(written.additionalMounts);
    expect(cfg.agentGroupId).toBe('ag-1');
  });

  // The regression this guards: a corrupt-but-present file must NOT silently
  // resolve to an empty config, because a read-modify-write caller would then
  // persist that empty config and permanently destroy the real mounts.
  it('throws on a corrupt existing file and backs it up without overwriting it', () => {
    fs.mkdirSync(dir, { recursive: true });
    const garbage = '{ "additionalMounts": [ {bad json';
    fs.writeFileSync(file, garbage);

    expect(() => readContainerConfig(FOLDER)).toThrow(/corrupt/i);

    // Original is left intact (not clobbered with defaults)...
    expect(fs.readFileSync(file, 'utf8')).toBe(garbage);
    // ...and a backup copy was made.
    const backups = fs.readdirSync(dir).filter((f) => f.startsWith('container.json.corrupt-'));
    expect(backups.length).toBe(1);
    expect(fs.readFileSync(path.join(dir, backups[0]), 'utf8')).toBe(garbage);
  });
});

describe('writeContainerConfig', () => {
  it('produces parseable JSON and leaves no temp file behind', () => {
    writeContainerConfig(FOLDER, {
      mcpServers: {},
      packages: { apt: [], npm: [] },
      additionalMounts: [],
      skills: 'all',
    });
    expect(() => JSON.parse(fs.readFileSync(file, 'utf8'))).not.toThrow();
    const leftover = fs.readdirSync(dir).filter((f) => f.includes('.tmp-'));
    expect(leftover).toEqual([]);
  });
});
