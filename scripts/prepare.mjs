// pnpm install's prepare step: the git hooks where this is a git checkout (hosts such as Vercel
// may build without .git, where `lefthook install` fails), then the widget assets the core
// package inlines.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const repo = join(import.meta.dirname, '..');
const run = (command, args) => execFileSync(command, args, { cwd: repo, stdio: 'inherit' });

if (existsSync(join(repo, '.git'))) run('lefthook', ['install']);
run('pnpm', ['--filter', '@boldare/askdare', 'run', 'build:assets']);
