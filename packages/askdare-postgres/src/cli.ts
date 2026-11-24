#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { migrate } from './schema/migrate';

const USAGE = `Usage: askdare-postgres migrate [part…]

Creates or upgrades the askdare schema in the database at DATABASE_URL: every part, or only the
parts named (such as \`conversations\` on a database without pgvector, which \`knowledge\` needs).
Without DATABASE_URL in the environment, it is read from .env.local, then .env.`;

async function main(): Promise<number> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      help: { type: 'boolean', short: 'h' },
    },
  });
  if (values.help) {
    console.log(USAGE);
    return 0;
  }
  const [command, ...parts] = positionals;
  if (command !== 'migrate') {
    console.error(USAGE);
    return 2;
  }
  // As `next dev` would see it; values already in the environment win. (No --env-file flag:
  // Node 22 reads that flag from a script's arguments too.)
  for (const file of ['.env.local', '.env']) {
    if (!process.env['DATABASE_URL'] && existsSync(file)) process.loadEnvFile(file);
  }

  const report = await migrate(parts.length === 0 ? {} : { parts });
  for (const step of report.applied) {
    console.log(`Applied ${step.part} ${step.version}: ${step.name}`);
  }
  const versions = Object.entries(report.versions)
    .map(([part, version]) => `${part} ${version}`)
    .join(', ');
  console.log(
    report.applied.length === 0
      ? `The schema is up to date${versions ? ` (${versions})` : ''}.`
      : `The schema is at ${versions}.`,
  );
  return 0;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(
      message.startsWith('[askdare-postgres]') ? message : `[askdare-postgres] ${message}`,
    );
    process.exitCode = 1;
  },
);
