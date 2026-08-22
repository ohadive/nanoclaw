/**
 * Slack MCP tools: slack_read_channel, slack_get_thread.
 *
 * Auth: requests to slack.com ride the OneCLI gateway proxy, which injects
 * the vaulted "Slack Bot" token as the Authorization header at the proxy
 * boundary — no credential lives in the container. A local SLACK_BOT_TOKEN
 * env var, when present, is used directly instead (legacy/dev path; the
 * driver admission rules refuse credential-shaped env, so in normal spawns
 * it is absent).
 */
import { registerTools } from './server.js';
import type { McpToolDefinition } from './types.js';

function log(msg: string): void {
  console.error(`[mcp-tools/slack] ${msg}`);
}

function ok(text: string) {
  return { content: [{ type: 'text' as const, text }] };
}

function err(text: string) {
  return { content: [{ type: 'text' as const, text: `Error: ${text}` }], isError: true };
}

function getToken(): string | null {
  return process.env.SLACK_BOT_TOKEN ?? null;
}

interface SlackMessage {
  ts: string;
  user?: string;
  bot_profile?: { name: string };
  username?: string;
  text?: string;
  reply_count?: number;
  thread_ts?: string;
}

interface SlackHistoryResponse {
  ok: boolean;
  messages?: SlackMessage[];
  error?: string;
  response_metadata?: { next_cursor?: string };
}

function formatMessage(m: SlackMessage, includeThread = true): string {
  const sender = m.bot_profile?.name ?? m.username ?? m.user ?? 'unknown';
  const date = new Date(parseFloat(m.ts) * 1000).toLocaleString();
  const thread = includeThread && m.reply_count ? ` [${m.reply_count} replies, ts:${m.ts}]` : '';
  return `[${date}] ${sender}: ${m.text ?? ''}${thread}`;
}

async function slackGet(endpoint: string, params: Record<string, string>): Promise<SlackHistoryResponse> {
  const token = getToken();

  const url = new URL(`https://slack.com/api/${endpoint}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  // No local token → send unauthenticated; the OneCLI gateway injects the
  // vaulted bot token for slack.com at the proxy boundary.
  const res = await fetch(url.toString(), {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<SlackHistoryResponse>;
}

/** Slack's "no/bad auth" errors, translated for the vault setup. */
function authHint(apiError: string): string | null {
  if (apiError !== 'not_authed' && apiError !== 'invalid_auth') return null;
  return (
    `Slack API error: ${apiError}. The gateway did not inject the Slack token — ` +
    `the "Slack Bot" secret may be missing from this agent's OneCLI vault assignment.`
  );
}

export const slackReadChannel: McpToolDefinition = {
  tool: {
    name: 'slack_read_channel',
    description:
      'Fetch recent messages from a Slack channel. Returns the latest N messages, newest last. ' +
      'Use the channel ID (starts with C) or name. Call slack_get_thread to read replies to a threaded message.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        channel: {
          type: 'string',
          description: 'Channel ID (e.g. C0123ABC) or name (e.g. general)',
        },
        limit: {
          type: 'number',
          description: 'Number of messages to fetch (default 20, max 100)',
        },
      },
      required: ['channel'],
    },
  },
  async handler(args) {
    const channel = args.channel as string;
    const limit = Math.min(Number(args.limit ?? 20), 100);

    try {
      const data = await slackGet('conversations.history', {
        channel,
        limit: String(limit),
      });
      if (!data.ok) return err(authHint(data.error ?? '') ?? `Slack API error: ${data.error ?? 'unknown'}`);

      const messages = (data.messages ?? []).slice().reverse();
      if (messages.length === 0) return ok('No messages found.');

      const lines = messages.map((m) => formatMessage(m));
      log(`slack_read_channel: ${messages.length} messages from ${channel}`);
      return ok(lines.join('\n'));
    } catch (e) {
      return err(e instanceof Error ? e.message : String(e));
    }
  },
};

export const slackGetThread: McpToolDefinition = {
  tool: {
    name: 'slack_get_thread',
    description:
      'Fetch all replies in a Slack thread. Provide the channel ID and the thread timestamp (ts) ' +
      'shown in brackets after a message from slack_read_channel.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        channel: {
          type: 'string',
          description: 'Channel ID (e.g. C0123ABC)',
        },
        thread_ts: {
          type: 'string',
          description: 'Thread timestamp (e.g. 1714000000.123456)',
        },
        limit: {
          type: 'number',
          description: 'Number of replies to fetch (default 50, max 200)',
        },
      },
      required: ['channel', 'thread_ts'],
    },
  },
  async handler(args) {
    const channel = args.channel as string;
    const thread_ts = args.thread_ts as string;
    const limit = Math.min(Number(args.limit ?? 50), 200);

    try {
      const data = await slackGet('conversations.replies', {
        channel,
        ts: thread_ts,
        limit: String(limit),
      });
      if (!data.ok) return err(authHint(data.error ?? '') ?? `Slack API error: ${data.error ?? 'unknown'}`);

      const messages = data.messages ?? [];
      if (messages.length === 0) return ok('No messages found in thread.');

      const lines = messages.map((m) => formatMessage(m, false));
      log(`slack_get_thread: ${messages.length} messages from thread ${thread_ts}`);
      return ok(lines.join('\n'));
    } catch (e) {
      return err(e instanceof Error ? e.message : String(e));
    }
  },
};

registerTools([slackReadChannel, slackGetThread]);
