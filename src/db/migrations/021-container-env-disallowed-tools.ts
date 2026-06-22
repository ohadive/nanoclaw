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
import type Database from 'better-sqlite3';
import type { Migration } from './index.js';

export const migration021: Migration = {
  version: 21,
  name: 'container-env-disallowed-tools',
  up(db: Database.Database) {
    db.exec(`ALTER TABLE container_configs ADD COLUMN env TEXT`);
    db.exec(`ALTER TABLE container_configs ADD COLUMN disallowed_tools TEXT`);
  },
};
