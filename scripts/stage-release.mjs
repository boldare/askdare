// Stages the packages whose version changed in this push and that aren't on npm yet. CI can only
// stage (the trusted publisher allows `npm stage publish`, not `npm publish`): nothing goes live
// until a maintainer approves it with 2FA, under Staged Packages on npmjs.com or with
// `npm stage approve <stage-id>`. The release workflow runs it after "Version packages" merges.
//   node scripts/stage-release.mjs [--dry-run]
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const repo = join(import.meta.dirname, '..');
const dryRun = process.argv.includes('--dry-run');
const PACKAGES = ['packages/askdare', 'packages/askdare-upstash'];

const run = (command, args, cwd) =>
  execFileSync(command, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

const versionBefore = (dir) => {
  try {
    return JSON.parse(run('git', ['show', `HEAD^:${dir}/package.json`], repo)).version;
  } catch {
    return undefined; // a new package, or no parent commit in this checkout
  }
};

const onNpm = (name, version) => {
  try {
    return run('npm', ['view', `${name}@${version}`, 'version'], repo) === version;
  } catch {
    return false; // E404: not published (a staged version isn't either until it is approved)
  }
};

let staged = 0;
for (const dir of PACKAGES) {
  const {
    name,
    version,
    private: isPrivate,
  } = JSON.parse(readFileSync(join(repo, dir, 'package.json'), 'utf8'));
  if (isPrivate) continue;
  if (versionBefore(dir) === version) {
    console.log(`${name}@${version}: version unchanged, nothing to stage.`);
    continue;
  }
  if (onNpm(name, version)) {
    console.log(`${name}@${version}: already on npm.`);
    continue;
  }
  // A pre-release goes under its own tag (0.1.0-rc.1 → rc), a release under latest.
  const tag = version.includes('-') ? (version.split('-')[1]?.split('.')[0] ?? 'next') : 'latest';
  // pnpm pack turns workspace: ranges into versions; npm stage publish packs the folder it runs
  // in, so it runs in the unpacked tarball.
  const out = mkdtempSync(join(tmpdir(), 'askdare-stage-'));
  run('pnpm', ['pack', '--pack-destination', out], join(repo, dir));
  const tarball = readdirSync(out).find((file) => file.endsWith('.tgz'));
  if (!tarball) throw new Error(`pnpm pack wrote no tarball for ${name}`);
  run('tar', ['-xzf', join(out, tarball), '-C', out], repo);
  const args = ['stage', 'publish', '--tag', tag, '--access', 'public'];
  if (dryRun) {
    console.log(`${name}@${version}: would run npm ${args.join(' ')} in ${join(out, 'package')}`);
    continue;
  }
  console.log(run('npm', args, join(out, 'package')));
  console.log(`${name}@${version}: staged under "${tag}". Approve it on npmjs.com to publish.`);
  staged += 1;
}
if (staged > 0) {
  console.log(
    `\n${staged} package(s) wait for approval: npmjs.com → the package → Staged Packages, or npm stage list and npm stage approve <stage-id>.`,
  );
}
