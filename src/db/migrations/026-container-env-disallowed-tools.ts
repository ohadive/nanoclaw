/**
 * Per-group `env` and `disallowed_tools` on `container_configs`.
 *
 * Fork features that predate upstream's file→DB container-config move
 * (upstream migration 014-container-configs). `env` carries per-group
 * container env vars (skill tokens); `disallowed_tools` is a per-group
 * SDK tool blocklist (e.g. make a Typefully MCP read-only). Both are
 * JSON-encoded text, NULL by default — existing rows are unaffected and
 * the backfill seeds them from any legacy container.json.
 */
import type { Migration } from './index.js';

export const migration026: Migration = {
  version: 26,
  name: 'container-env-disallowed-tools',
  sqliteOnly: true,
  up(db) {
    db.exec(`ALTER TABLE container_configs ADD COLUMN env TEXT`);
    db.exec(`ALTER TABLE container_configs ADD COLUMN disallowed_tools TEXT`);
  },
};
