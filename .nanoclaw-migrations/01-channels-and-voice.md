# Channels and voice transcription

## Channel installation (v2 flow)

In v1, channels lived on separate fork repos merged into main (`gmail/main`, `slack/main`, etc.). In v2 they live on the upstream `channels` branch and install via `/add-<channel>` skills.

### Order

1. `/add-whatsapp` — primary channel
2. `/add-gmail`
3. `/add-slack`
4. `/add-telegram`

Each skill copies its channel source (`src/channels/<name>.ts` + test) from `upstream/channels` and wires registration. No hand-tweaks are required on top — the prettier-only diffs from commit `68e01f8` in v1 are cosmetic and do not need replay.

### WhatsApp-specific follow-up
After `/add-whatsapp` succeeds, the WhatsApp auth flow needs the custom auth script in `src/whatsapp-auth.ts` plus its setup-step integration. See [02-source.md](02-source.md).

## Voice transcription

**Intent:** Transcribe incoming WhatsApp voice notes to text via OpenAI Whisper API so the agent can read them.

**Files:** `src/transcription.ts` (new), `src/channels/whatsapp.ts` (hook into message handler), `package.json` (`openai` dep), `.env.example` (`OPENAI_API_KEY`).

**Scope:** Non-standard

### How to apply

**1. Check for a v2 upstream equivalent first.** Run `git branch -r | grep -i transcription` and `git branch -r | grep -i voice` in the worktree. If `upstream/skill/voice-transcription` or a v2 equivalent `/add-voice-transcription` exists, prefer that over manual replay.

**2. If no upstream skill, replay manually.** Create `src/transcription.ts` with the following content verbatim:

```typescript
import { downloadMediaMessage } from '@whiskeysockets/baileys';
import { WAMessage, WASocket } from '@whiskeysockets/baileys';

import { readEnvFile } from './env.js';

interface TranscriptionConfig {
  model: string;
  enabled: boolean;
  fallbackMessage: string;
}

const DEFAULT_CONFIG: TranscriptionConfig = {
  model: 'whisper-1',
  enabled: true,
  fallbackMessage: '[Voice Message - transcription unavailable]',
};

async function transcribeWithOpenAI(
  audioBuffer: Buffer,
  config: TranscriptionConfig,
): Promise<string | null> {
  const env = readEnvFile(['OPENAI_API_KEY']);
  const apiKey = env.OPENAI_API_KEY;

  if (!apiKey) {
    console.warn('OPENAI_API_KEY not set in .env');
    return null;
  }

  try {
    const openaiModule = await import('openai');
    const OpenAI = openaiModule.default;
    const toFile = openaiModule.toFile;

    const openai = new OpenAI({ apiKey });

    const file = await toFile(audioBuffer, 'voice.ogg', {
      type: 'audio/ogg',
    });

    const transcription = await openai.audio.transcriptions.create({
      file: file,
      model: config.model,
      response_format: 'text',
    });

    // When response_format is 'text', the API returns a plain string
    return transcription as unknown as string;
  } catch (err) {
    console.error('OpenAI transcription failed:', err);
    return null;
  }
}

export async function transcribeAudioMessage(
  msg: WAMessage,
  sock: WASocket,
): Promise<string | null> {
  const config = DEFAULT_CONFIG;

  if (!config.enabled) {
    return config.fallbackMessage;
  }

  try {
    const buffer = (await downloadMediaMessage(
      msg,
      'buffer',
      {},
      {
        logger: console as any,
        reuploadRequest: sock.updateMediaMessage,
      },
    )) as Buffer;

    if (!buffer || buffer.length === 0) {
      console.error('Failed to download audio message');
      return config.fallbackMessage;
    }

    console.log(`Downloaded audio message: ${buffer.length} bytes`);

    const transcript = await transcribeWithOpenAI(buffer, config);

    if (!transcript) {
      return config.fallbackMessage;
    }

    return transcript.trim();
  } catch (err) {
    console.error('Transcription error:', err);
    return config.fallbackMessage;
  }
}

export function isVoiceMessage(msg: WAMessage): boolean {
  return msg.message?.audioMessage?.ptt === true;
}
```

Note: `readEnvFile` is a NanoClaw helper exported from `src/env.ts`. Verify it still exists in v2 under that name; otherwise substitute with equivalent (likely `readEnv`, `getEnv`, or a direct `process.env.OPENAI_API_KEY` read — check the v2 codebase).

**3. Hook into `src/channels/whatsapp.ts`.**

Add the following imports near the top (alongside existing baileys imports):
```typescript
import { transcribeAudioMessage, isVoiceMessage } from '../transcription.js';
```

In the incoming-message handler, after the basic `content` field is extracted and before delivering to `onMessage`, handle voice notes:
```typescript
// If the message has no text but is a voice note, transcribe it
let finalContent = content;
if (!content && isVoiceMessage(msg)) {
  try {
    const transcript = await transcribeAudioMessage(msg, this.sock);
    if (transcript) {
      finalContent = `[Voice: ${transcript}]`;
      logger.info(
        { chatJid, length: transcript.length },
        'Transcribed voice message',
      );
    } else {
      finalContent = '[Voice Message - transcription unavailable]';
    }
  } catch (err) {
    logger.error({ err }, 'Voice transcription failed');
    finalContent = '[Voice Message - transcription failed]';
  }
}
```

Pass `finalContent` (not `content`) to `onMessage(chatJid, { ... content: finalContent ... })`.

**4. Also preserve the early `!content` gate adjustment.** Where v1 whatsapp.ts had `if (!content) continue;`, change to `if (!content && !isVoiceMessage(msg)) continue;` so voice notes aren't filtered out before transcription.

**5. Add `openai` dependency.** `npm install openai@^6.27.0` (or whatever version matches the OpenAI SDK API used above — the `toFile` helper and `openai.audio.transcriptions.create` with `response_format: 'text'` are stable across recent v6 versions).

**6. Add `OPENAI_API_KEY=` to `.env.example`.** Actual key goes in `.env` (not committed).

## WhatsApp LID → phone translation

**Intent:** Newer WhatsApp protocol emits group messages with `@lid` JIDs instead of phone-number JIDs. Falling back to `key.senderPn` (sender phone-number hint) resolves this when the signal-repository translator fails.

**Scope:** Standard (small hunk, but behavior-critical)

**Files:** `src/channels/whatsapp.ts`

**How to apply:**

In the `messages.upsert` handler, after computing `chatJid = await this.translateJid(rawJid)`, add:

```typescript
if (chatJid.endsWith('@lid') && (msg.key as any).senderPn) {
  const pn = (msg.key as any).senderPn as string;
  const phoneJid = pn.includes('@') ? pn : `${pn}@s.whatsapp.net`;
  this.setLidPhoneMapping(
    rawJid.split('@')[0].split(':')[0],
    phoneJid,
  );
  chatJid = phoneJid;
  logger.info({ lidJid: rawJid, phoneJid }, 'Translated LID via senderPn');
}
```

This assumes `setLidPhoneMapping` exists on the channel class — if v2's whatsapp channel has restructured this, match its LID-mapping API or drop the call and just reassign `chatJid`.

Check if v2's whatsapp channel already handles this natively. If yes, skip.
