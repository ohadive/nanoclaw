/**
 * Voice-note transcription for the WhatsApp channel adapter (PTT audio → text).
 *
 * Provider selection: prefer Groq (generous free tier, fast, multilingual
 * whisper-large-v3) and fall back to OpenAI Whisper. Both expose the same
 * OpenAI-compatible /audio/transcriptions endpoint, so only the baseURL and
 * model differ — we reuse the `openai` SDK for both.
 */
import { downloadMediaMessage } from '@whiskeysockets/baileys';
import type { WAMessage } from '@whiskeysockets/baileys';

import { readEnvFile } from './env.js';
import { log } from './log.js';

interface TranscribeProvider {
  name: string;
  apiKey: string;
  baseURL?: string;
  model: string;
}

/**
 * Pick the transcription backend from whichever key is present in .env.
 * Groq wins when both are set. Returns null when neither key is configured.
 */
function selectProvider(): TranscribeProvider | null {
  const env = readEnvFile(['GROQ_API_KEY', 'OPENAI_API_KEY']);
  if (env.GROQ_API_KEY) {
    return {
      name: 'groq',
      apiKey: env.GROQ_API_KEY,
      baseURL: 'https://api.groq.com/openai/v1',
      model: 'whisper-large-v3',
    };
  }
  if (env.OPENAI_API_KEY) {
    return { name: 'openai', apiKey: env.OPENAI_API_KEY, model: 'whisper-1' };
  }
  return null;
}

export async function transcribeAudioMessage(msg: WAMessage): Promise<string | null> {
  const provider = selectProvider();
  if (!provider) {
    log.warn('No transcription key set (GROQ_API_KEY or OPENAI_API_KEY), skipping transcription');
    return null;
  }

  let buffer: Buffer;
  try {
    buffer = (await downloadMediaMessage(msg, 'buffer', {})) as Buffer;
  } catch (err) {
    log.error('Failed to download audio for transcription', { err });
    return null;
  }

  if (!buffer || buffer.length === 0) {
    log.error('Empty audio buffer for transcription');
    return null;
  }

  try {
    const openaiModule = await import('openai');
    const OpenAI = openaiModule.default;
    const toFile = openaiModule.toFile;
    const client = new OpenAI({ apiKey: provider.apiKey, baseURL: provider.baseURL });

    const file = await toFile(buffer, 'voice.ogg', { type: 'audio/ogg' });
    const transcription = await client.audio.transcriptions.create({
      file,
      model: provider.model,
      response_format: 'text',
    });

    return (transcription as unknown as string).trim();
  } catch (err) {
    // Surface the real failure. A quota/billing rejection (HTTP 429
    // insufficient_quota) can arrive mid-upload and the OpenAI SDK reports it
    // as a generic "Connection error" (read ECONNRESET) with no status — so we
    // log the status/code/api-message when present AND the underlying cause,
    // otherwise a billing problem looks identical to a network fault.
    const e = err as {
      status?: number;
      code?: string;
      error?: { code?: string; message?: string };
      message?: string;
      cause?: { message?: string; code?: string };
    };
    log.error(`${provider.name} transcription failed`, {
      status: e?.status,
      code: e?.error?.code ?? e?.code,
      apiMessage: e?.error?.message,
      message: e?.message,
      cause: e?.cause?.message ?? e?.cause?.code,
    });
    return null;
  }
}
