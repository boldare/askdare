#!/usr/bin/env node
import { createRequire } from 'node:module';
import { parseArgs } from 'node:util';
import { doctor, isLocal } from './doctor';
import { InitError, init } from './init';
import { KB_USAGE, kbSync } from './kb-sync';
import { UsageError } from './usage';

const USAGE = `Usage: npx @boldare/askdare <command> [options]

Commands:
  init               Add askdare to the Next.js app in this folder: a route, a bot
                     config, .env.local and the chat script. Never overwrites files.
    --bot <id>         Bot ID (default: support)
    --model <id>       OpenAI model to put in .env.local as ASKDARE_MODEL

  doctor             Check the project, its environment and the running app: the
                     OpenAI key, models, vector store, permissions and headers.
    --url <url>        Where the app runs (default: http://localhost:3000)
    --base-path <p>    Path of the askdare route (default: /api/chat)
    --env-file <path>  Read CHAT_SECRET and the rest from this file
                       (default: .env.local and .env)
    --origin <url>     Check that this site may embed the chat (the bot's
                       security.allowedOrigins), e.g. https://www.example.com

  kb sync <folder>   Make an OpenAI vector store mirror a folder of documents.
                     See: askdare kb sync --help

  -v, --version      Show the installed version
  -h, --help         Show this help
`;

/** The package's own version: the CLI ships next to its package.json (dist/cli.js). */
function version(): string {
  return (createRequire(import.meta.url)('../package.json') as { version: string }).version;
}

async function runInit(args: readonly string[]): Promise<number> {
  const { values } = parseArgs({
    args: [...args],
    options: {
      bot: { type: 'string', default: 'support' },
      model: { type: 'string' },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });
  if (values.help) {
    console.log(USAGE);
    return 0;
  }
  try {
    await init({
      root: process.cwd(),
      botId: values.bot,
      model: values.model,
      print: (line) => console.log(line),
    });
  } catch (error) {
    if (error instanceof InitError) {
      console.error(`askdare init: ${error.message}`);
      return 1;
    }
    throw error;
  }
  return 0;
}

async function runDoctor(args: readonly string[]): Promise<number> {
  const { values } = parseArgs({
    args: [...args],
    options: {
      url: { type: 'string', default: 'http://localhost:3000' },
      'base-path': { type: 'string', default: '/api/chat' },
      'env-file': { type: 'string' },
      origin: { type: 'string' },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });
  if (values.help) {
    console.log(USAGE);
    return 0;
  }
  let target: URL;
  try {
    target = new URL(values.url);
  } catch {
    throw new UsageError('--url must be a URL such as https://your-app.example.com.');
  }
  if (target.protocol !== 'https:' && !(target.protocol === 'http:' && isLocal(values.url))) {
    // The doctor token is signed with CHAT_SECRET; it must not cross the network in the clear.
    throw new UsageError('--url must use https (plain http only for localhost).');
  }
  if (!/^(\/[a-zA-Z0-9._~-]+)+$/.test(values['base-path'])) {
    throw new UsageError('--base-path must look like /api/chat.');
  }
  let origin: string | undefined;
  if (values.origin !== undefined) {
    try {
      origin = new URL(values.origin).origin;
    } catch {
      throw new UsageError('--origin must be a URL such as https://www.example.com.');
    }
  }
  const failures = await doctor({
    root: process.cwd(),
    url: values.url,
    basePath: values['base-path'],
    envFile: values['env-file'],
    origin,
    print: (line) => console.log(line),
  });
  return failures > 0 ? 1 : 0;
}

async function main(argv: readonly string[]): Promise<number> {
  const [command, ...rest] = argv;
  if (command === 'init') return runInit(rest);
  if (command === 'doctor') return runDoctor(rest);
  if (command === 'kb' && rest[0] === 'sync') return kbSync(rest.slice(1));
  if (command === '-v' || command === '--version') {
    console.log(version());
    return 0;
  }
  if (command === undefined || command === '-h' || command === '--help') {
    console.log(USAGE);
    return 0;
  }
  throw new UsageError(`Unknown command "${argv.join(' ')}".`);
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    const parseError = (error as { code?: unknown }).code?.toString().startsWith('ERR_PARSE_ARGS');
    if (error instanceof UsageError || parseError) {
      const usage = process.argv[2] === 'kb' ? KB_USAGE : USAGE;
      console.error(`${(error as Error).message}\n\n${usage}`);
    } else console.error(`askdare: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  },
);
