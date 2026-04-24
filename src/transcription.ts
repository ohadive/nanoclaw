/**
 * Voice-note transcription via OpenAI Whisper.
 * Used by the WhatsApp channel adapter to convert PTT audio messages to text.
 */
import { downloadMediaMessage } from '@whiskeysockets/baileys';
import type { WAMessage } from '@whiskeysockets/baileys';

import { readEnvFile } from './env.js';
import { log } from './log.js';

const MODEL = 'whisper-1';

export async function transcribeAudioMessage(msg: WAMessage): Promise<string | null> {
  const env = readEnvFile(['OPENAI_API_KEY']);
  const apiKey = env.OPENAI_API_KEY;

  if (!apiKey) {
    log.warn('OPENAI_API_KEY not set, skipping transcription');
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
    const openai = new OpenAI({ apiKey });

    const file = await toFile(buffer, 'voice.ogg', { type: 'audio/ogg' });
    const transcription = await openai.audio.transcriptions.create({
      file,
      model: MODEL,
      response_format: 'text',
    });

    return (transcription as unknown as string).trim();
  } catch (err) {
    log.error('OpenAI transcription failed', { err });
    return null;
  }
}
