/**
 * Pause flag on `agent_groups`. When `paused_at` is non-null, the host sweep
 * skips scheduled-wake paths for that group (recurrence fanout in particular)
 * while still allowing interactive wakes triggered by inbound user messages.
 *
 * `paused_reason` is a free-text annotation so whoever set the pause can leave
 * a note for whoever resumes ("flaky output", "rate-limit recovery", etc.).
 *
 * Both columns NULL by default — every existing group is "not paused".
 */
import type Database from 'better-sqlite3';
import type { Migration } from './index.js';

export const migration014: Migration = {
  version: 14,
  name: 'agent-group-pause',
  up(db: Database.Database) {
    db.exec(`ALTER TABLE agent_groups ADD COLUMN paused_at TEXT`);
    db.exec(`ALTER TABLE agent_groups ADD COLUMN paused_reason TEXT`);
  },
};
