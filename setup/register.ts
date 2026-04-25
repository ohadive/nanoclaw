/**
 * Step: register — Write channel registration config, create group folders.
 *
 * Accepts --channel to specify the messaging platform (whatsapp, telegram, slack, discord).
 * Uses parameterized SQL queries to prevent injection.
 */
import fs from 'fs';
import path from 'path';

import { STORE_DIR } from '../src/config.ts';
import { initDatabase, setRegisteredGroup, storeChatMetadata } from '../src/db.ts';
import { isValidGroupFolder } from '../src/group-folder.ts';
import { logger } from '../src/logger.ts';
import { emitStatus } from './status.ts';

interface RegisterArgs {
  platformId: string;
  name: string;
  trigger: string;
  folder: string;
  channel: string;
  requiresTrigger: boolean;
  isGroup: boolean | null; // null = infer from platformId format
  isMain: boolean;
  assistantName: string;
  sessionMode: string;
}

/**
 * Return the ID as-is if it already carries channel context; otherwise prefix
 * it with `${channel}:`. IDs that must never be prefixed:
 *   - already namespaced (starts with `${channel}:` or a known short prefix)
 *   - WhatsApp/XMPP JIDs (contain `@`)
 *   - Phone numbers (start with `+`)
 *   - group: URIs
 */
function namespacedPlatformId(channel: string, rawId: string): string {
  // Short prefixes used by existing adapters (tg:, dc:, sl:, …)
  const shortPrefixes: Record<string, string> = {
    telegram: 'tg:',
    discord: 'dc:',
    slack: 'sl:',
    signal: 'si:',
  };
  const shortPrefix = shortPrefixes[channel];
  if (
    rawId.startsWith(`${channel}:`) ||
    (shortPrefix !== undefined && rawId.startsWith(shortPrefix)) ||
    rawId.includes('@') ||
    rawId.startsWith('+') ||
    rawId.startsWith('group:')
  ) {
    return rawId;
  }
  return `${channel}:${rawId}`;
}

/**
 * Infer whether a platform ID refers to a group or a DM based on
 * well-known ID patterns.
 */
function inferIsGroup(channel: string, platformId: string): boolean {
  if (channel === 'whatsapp') {
    if (platformId.endsWith('@g.us')) return true;
    if (platformId.endsWith('@s.whatsapp.net')) return false;
  }
  if (channel === 'telegram') {
    // Telegram supergroups/channels use negative IDs
    const numPart = platformId.replace(/^tg:/, '');
    if (numPart.startsWith('-')) return true;
    // Plain positive integer → private DM
    if (/^\d+$/.test(numPart)) return false;
  }
  if (channel === 'signal') {
    return !platformId.startsWith('+');
  }
  return true; // safe default: assume group
}

function parseArgs(args: string[]): RegisterArgs {
  const result: RegisterArgs = {
    platformId: '',
    name: '',
    trigger: '',
    folder: '',
    channel: 'whatsapp', // backward-compat: pre-refactor installs omit --channel
    requiresTrigger: true,
    isGroup: null,
    isMain: false,
    assistantName: 'Andy',
    sessionMode: 'isolated',
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--platform-id':
        result.platformId = args[++i] || '';
        break;
      case '--jid': // backwards-compat alias for --platform-id
        result.platformId = result.platformId || args[++i] || '';
        break;
      case '--name':
        result.name = args[++i] || '';
        break;
      case '--trigger':
        result.trigger = args[++i] || '';
        break;
      case '--folder':
        result.folder = args[++i] || '';
        break;
      case '--channel':
        result.channel = (args[++i] || '').toLowerCase();
        break;
      case '--no-trigger-required':
        result.requiresTrigger = false;
        break;
      case '--is-group':
        result.isGroup = true;
        break;
      case '--no-is-group':
        result.isGroup = false;
        break;
      case '--is-main':
        result.isMain = true;
        break;
      case '--assistant-name':
        result.assistantName = args[++i] || 'Andy';
        break;
      case '--session-mode':
        result.sessionMode = args[++i] || 'isolated';
        break;
    }
  }

  return result;
}

export async function run(args: string[]): Promise<void> {
  const projectRoot = process.cwd();
  const parsed = parseArgs(args);

  if (!parsed.platformId || !parsed.name || !parsed.folder) {
    emitStatus('REGISTER_CHANNEL', {
      STATUS: 'failed',
      ERROR: 'missing_required_args',
      LOG: 'logs/setup.log',
    });
    process.exit(4);
  }

  if (!isValidGroupFolder(parsed.folder)) {
    emitStatus('REGISTER_CHANNEL', {
      STATUS: 'failed',
      ERROR: 'invalid_folder',
      LOG: 'logs/setup.log',
    });
    process.exit(4);
  }

  // Apply namespacing: never double-prefix native JIDs (@s.whatsapp.net, tg:…, +phone)
  const jid = namespacedPlatformId(parsed.channel, parsed.platformId);

  // Determine group vs DM, honouring explicit flag over inference
  const isGroup =
    parsed.isGroup !== null ? parsed.isGroup : inferIsGroup(parsed.channel, jid);

  // For DMs: respond to every message (requiresTrigger=false, trigger='.')
  // For groups: respect --no-trigger-required; default trigger to '.' if not given.
  const requiresTrigger = isGroup ? parsed.requiresTrigger : false;
  const trigger = parsed.trigger || '.';

  logger.info({ ...parsed, jid, isGroup, requiresTrigger, trigger }, 'Registering channel');

  // Ensure data and store directories exist (store/ may not exist on
  // fresh installs that skip WhatsApp auth, which normally creates it)
  fs.mkdirSync(path.join(projectRoot, 'data'), { recursive: true });
  fs.mkdirSync(STORE_DIR, { recursive: true });

  // Initialize database (creates schema + runs migrations)
  initDatabase();

  setRegisteredGroup(jid, {
    name: parsed.name,
    folder: parsed.folder,
    trigger,
    added_at: new Date().toISOString(),
    requiresTrigger,
    isMain: parsed.isMain,
  });

  // Record channel/is_group in the chats table so the router can use it.
  storeChatMetadata(jid, new Date().toISOString(), parsed.name, parsed.channel, isGroup);

  logger.info('Wrote registration to SQLite');

  // Create group folders
  fs.mkdirSync(path.join(projectRoot, 'groups', parsed.folder, 'logs'), {
    recursive: true,
  });

  // Create CLAUDE.md in the new group folder from template if it doesn't exist.
  // The agent runs with CWD=/workspace/group and loads CLAUDE.md from there.
  // Never overwrite an existing CLAUDE.md — users customize these extensively
  // (persona, workspace structure, communication rules, family context, etc.)
  // and a stock template replacement would destroy that work.
  const groupClaudeMdPath = path.join(
    projectRoot,
    'groups',
    parsed.folder,
    'CLAUDE.md',
  );
  if (!fs.existsSync(groupClaudeMdPath)) {
    const templatePath = parsed.isMain
      ? path.join(projectRoot, 'groups', 'main', 'CLAUDE.md')
      : path.join(projectRoot, 'groups', 'global', 'CLAUDE.md');
    if (fs.existsSync(templatePath)) {
      fs.copyFileSync(templatePath, groupClaudeMdPath);
      logger.info(
        { file: groupClaudeMdPath, template: templatePath },
        'Created CLAUDE.md from template',
      );
    }
  }

  // Update assistant name in CLAUDE.md files if different from default
  let nameUpdated = false;
  if (parsed.assistantName !== 'Andy') {
    logger.info(
      { from: 'Andy', to: parsed.assistantName },
      'Updating assistant name',
    );

    const groupsDir = path.join(projectRoot, 'groups');
    const mdFiles = fs
      .readdirSync(groupsDir)
      .map((d) => path.join(groupsDir, d, 'CLAUDE.md'))
      .filter((f) => fs.existsSync(f));

    for (const mdFile of mdFiles) {
      if (fs.existsSync(mdFile)) {
        let content = fs.readFileSync(mdFile, 'utf-8');
        content = content.replace(/^# Andy$/m, `# ${parsed.assistantName}`);
        content = content.replace(
          /You are Andy/g,
          `You are ${parsed.assistantName}`,
        );
        fs.writeFileSync(mdFile, content);
        logger.info({ file: mdFile }, 'Updated CLAUDE.md');
      }
    }

    // Update .env
    const envFile = path.join(projectRoot, '.env');
    if (fs.existsSync(envFile)) {
      let envContent = fs.readFileSync(envFile, 'utf-8');
      if (envContent.includes('ASSISTANT_NAME=')) {
        envContent = envContent.replace(
          /^ASSISTANT_NAME=.*$/m,
          `ASSISTANT_NAME="${parsed.assistantName}"`,
        );
      } else {
        envContent += `\nASSISTANT_NAME="${parsed.assistantName}"`;
      }
      fs.writeFileSync(envFile, envContent);
    } else {
      fs.writeFileSync(envFile, `ASSISTANT_NAME="${parsed.assistantName}"\n`);
    }
    logger.info('Set ASSISTANT_NAME in .env');
    nameUpdated = true;
  }

  emitStatus('REGISTER_CHANNEL', {
    JID: jid,
    NAME: parsed.name,
    FOLDER: parsed.folder,
    CHANNEL: parsed.channel,
    TRIGGER: trigger,
    IS_GROUP: isGroup,
    REQUIRES_TRIGGER: requiresTrigger,
    SESSION_MODE: parsed.sessionMode,
    ASSISTANT_NAME: parsed.assistantName,
    NAME_UPDATED: nameUpdated,
    STATUS: 'success',
    LOG: 'logs/setup.log',
  });
}
