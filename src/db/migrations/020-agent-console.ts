/**
 * `console_messaging_group_id` on `agent_groups`.
 *
 * For the orchestration manager (Marty), this designates the messaging group
 * whose session is the manager's "console" — where the owner talks to it AND
 * where replies from spoke agents are delivered. Without it, agent-to-agent
 * messages route to the target's `agent-shared` session (the most-recent
 * session for that agent group), which is ambiguous for a manager that is also
 * wired to busy channels + scheduled tasks: a spoke's reply could land in a
 * group-thread session instead of the owner's DM.
 *
 * When set, `routeAgentMessage` resolves the target's session for THIS
 * messaging group (using its wiring's session_mode) instead of agent-shared,
 * so the reply lands in the console and the manager's default reply routing
 * points back at the owner. NULL for every agent by default (= old behaviour).
 */
import type Database from 'better-sqlite3';
import type { Migration } from './index.js';

export const migration020: Migration = {
  version: 20,
  name: 'agent-console-messaging-group',
  up(db: Database.Database) {
    db.exec(`ALTER TABLE agent_groups ADD COLUMN console_messaging_group_id TEXT`);
  },
};
