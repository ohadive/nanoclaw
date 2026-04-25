/**
 * Step: pair-telegram — Verify Telegram bot token and confirm the bot is reachable.
 * Required before registering Telegram groups or DMs.
 */
import { readEnvFile } from '../src/env.js';
import { logger } from '../src/logger.js';
import { emitStatus } from './status.js';

export async function run(_args: string[]): Promise<void> {
  const envVars = readEnvFile(['TELEGRAM_BOT_TOKEN']);
  const token = process.env.TELEGRAM_BOT_TOKEN ?? envVars.TELEGRAM_BOT_TOKEN;

  if (!token) {
    emitStatus('PAIR_TELEGRAM', {
      STATUS: 'failed',
      ERROR: 'TELEGRAM_BOT_TOKEN not set in .env',
      LOG: 'logs/setup.log',
    });
    process.exit(1);
  }

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/getMe`);
    const data = (await res.json()) as {
      ok: boolean;
      result?: { username?: string; id?: number };
    };
    if (!data.ok) throw new Error('Telegram API returned ok=false');
    logger.info({ username: data.result?.username }, 'Telegram bot verified');
    emitStatus('PAIR_TELEGRAM', {
      STATUS: 'success',
      BOT_USERNAME: data.result?.username ?? '',
      BOT_ID: String(data.result?.id ?? ''),
      LOG: 'logs/setup.log',
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ err }, 'Telegram bot verification failed');
    emitStatus('PAIR_TELEGRAM', {
      STATUS: 'failed',
      ERROR: message,
      LOG: 'logs/setup.log',
    });
    process.exit(1);
  }
}
