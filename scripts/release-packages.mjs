// Releases the packages whose version changed in this push and that aren't on npm yet, through
// npm trusted publishing (OIDC). The release workflow runs it after "Version packages" merges.
// NPM_RELEASE_MODE (a repository variable) picks how:
// - stage (default): `npm stage publish`. Nothing goes live until a maintainer approves it with
//   2FA, under Staged Packages on npmjs.com or with `npm stage approve <stage-id>`.
// - publish: `npm publish`, live at once; needs "Allow npm publish" on the trusted publisher.
//   Each release also gets a git tag and a GitHub release (from the "New tag:" lines).
//   node scripts/release-packages.mjs [--dry-run]
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const repo = join(import.meta.dirname, '..');
const dryRun = process.argv.includes('--dry-run');
const mode = process.env['NPM_RELEASE_MODE'] === 'publish' ? 'publish' : 'stage';
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

/** Whether the tag is on GitHub already (the checkout fetches no tags). */
const tagged = (tag) =>
  run('git', ['ls-remote', '--tags', 'origin', `refs/tags/${tag}`], repo) !== '';

let released = 0;
for (const dir of PACKAGES) {
  const {
    name,
    version,
    private: isPrivate,
  } = JSON.parse(readFileSync(join(repo, dir, 'package.json'), 'utf8'));
  if (isPrivate) continue;
  if (versionBefore(dir) === version) {
    console.log(`${name}@${version}: version unchanged, nothing to release.`);
    continue;
  }
  if (onNpm(name, version)) {
    console.log(`${name}@${version}: already on npm.`);
    // A run that failed on a later package published this one but pushed no tag: a rerun adds it.
    if (mode === 'publish' && !dryRun && !tagged(`${name}@${version}`)) {
      run('git', ['tag', `${name}@${version}`], repo);
      console.log(`New tag: ${name}@${version}`);
    }
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
  const args = [
    ...(mode === 'stage' ? ['stage'] : []),
    'publish',
    '--tag',
    tag,
    '--access',
    'public',
  ];
  if (dryRun) {
    console.log(`${name}@${version}: would run npm ${args.join(' ')} in ${join(out, 'package')}`);
    continue;
  }
  console.log(run('npm', args, join(out, 'package')));
  if (mode === 'publish') {
    // changesets/action pushes the tags and opens a GitHub release for each "New tag:" line.
    run('git', ['tag', `${name}@${version}`], repo);
    console.log(`New tag: ${name}@${version}`);
  } else {
    console.log(`${name}@${version}: staged under "${tag}". Approve it on npmjs.com to publish.`);
  }
  released += 1;
}
if (released > 0 && mode === 'stage') {
  console.log(
    `\n${released} package(s) wait for approval: npmjs.com → the package → Staged Packages, or npm stage list and npm stage approve <stage-id>.`,
  );
}
