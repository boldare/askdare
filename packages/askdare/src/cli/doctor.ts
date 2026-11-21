import { readFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { parseEnv } from 'node:util';
import {
  type BotEmbed,
  type DoctorCheck,
  type DoctorReport,
  doctorReportSchema,
} from '../protocol/doctor';
import { createIdentityVerifier } from '../security/identity';
import { createTokenService } from '../security/tokens';
import {
  addCommand,
  atLeast,
  findFile,
  gitIgnores,
  installedVersion,
  majorOf,
  type Project,
  readEnv,
  readProject,
  routeDir,
  runScript,
  shown,
} from './project';

export interface DoctorOptions {
  readonly root: string;
  /** Where the app runs; default `http://localhost:3000`. */
  readonly url: string;
  readonly basePath: string;
  readonly envFile?: string | undefined;
  /** A site that should embed the chat: checked against each bot's allowlist (frame-ancestors). */
  readonly origin?: string | undefined;
  readonly fetch?: typeof fetch;
  readonly shell?: NodeJS.ProcessEnv;
  readonly print: (line: string) => void;
}

/** A check, or `info`: something to know about that is neither a warning nor a problem. */
type Finding =
  | DoctorCheck
  | { readonly status: 'info'; readonly title: string; readonly fix?: string | undefined };

interface Section {
  readonly title: string;
  readonly checks: Finding[];
}

const ok = (title: string): DoctorCheck => ({ status: 'ok', title });
const warn = (title: string, fix?: string): DoctorCheck => ({ status: 'warn', title, fix });
const fail = (title: string, fix?: string): DoctorCheck => ({ status: 'fail', title, fix });
const info = (title: string, fix?: string): Finding => ({ status: 'info', title, fix });

const PROXY_FIX =
  "Exclude askdare's routes in proxy.ts, e.g. matcher: ['/((?!api/chat|_next/static|_next/image).*)'].";

function versions(project: Project): DoctorCheck[] {
  const checks: DoctorCheck[] = [];
  const node = majorOf(process.versions.node) ?? 0;
  checks.push(
    node >= 22
      ? ok(`Node ${process.versions.node}`)
      : fail(`Node ${process.versions.node} is too old.`, 'Use Node 22 or later.'),
  );
  const wanted: readonly (readonly [string, number, number, string])[] = [
    ['next', 16, 0, 'Next.js 16'],
    ['react', 19, 0, 'React 19'],
    ['zod', 4, 1, 'zod 4.1 or later'],
    ['@boldare/askdare', 0, 0, '@boldare/askdare'],
  ];
  const found: string[] = [];
  for (const [name, major, minor, label] of wanted) {
    const version = installedVersion(project, name);
    if (version === undefined) {
      checks.push(
        fail(
          `${name} is not installed.`,
          project.dependencies?.[name]
            ? `Run ${project.packageManager} install.`
            : `askdare needs ${label}: ${addCommand(project, [name])}`,
        ),
      );
    } else if (!atLeast(version, major, minor)) {
      checks.push(fail(`${name} ${version} is too old.`, `askdare needs ${label}.`));
    } else {
      found.push(`${name} ${version}`);
    }
  }
  if (found.length > 0) checks.splice(1, 0, ok(found.join(', ')));
  return checks;
}

async function files(project: Project, basePath: string): Promise<DoctorCheck[]> {
  if (project.appDir === undefined) {
    return [fail('No app/ or src/app/ folder.', 'askdare needs the App Router.')];
  }
  const checks: DoctorCheck[] = [];
  const route = findFile(routeDir(project, basePath), 'route');
  if (route === undefined) {
    checks.push(
      fail(
        `No route at ${shown(project, join(routeDir(project, basePath) ?? '', 'route.ts'))}.`,
        'Run `npx @boldare/askdare init`, or pass --base-path if you mounted askdare elsewhere.',
      ),
    );
  } else {
    const text = await readFile(route, 'utf8');
    const maxDuration = /export\s+const\s+maxDuration\s*=\s*(\d[\d_]*)/.exec(text)?.[1];
    if (!text.includes('createChatHandler')) {
      checks.push(fail(`${shown(project, route)} doesn't call createChatHandler.`));
    } else if (/export\s+const\s+runtime\s*=\s*['"]edge['"]/.test(text)) {
      checks.push(
        fail(
          `${shown(project, route)} uses the Edge runtime.`,
          'askdare runs on Node.js only; remove `runtime`.',
        ),
      );
    } else if (maxDuration === undefined) {
      checks.push(
        warn(
          `${shown(project, route)} has no literal maxDuration.`,
          'Add `export const maxDuration = 300;` so long answers aren’t cut off on Vercel.',
        ),
      );
    } else {
      checks.push(
        ok(`${shown(project, route)} (maxDuration ${maxDuration.replaceAll('_', '')} s)`),
      );
    }
  }
  const middleware = [project.root, join(project.root, 'src')]
    .map((dir) => findFile(dir, 'middleware'))
    .find(Boolean);
  if (middleware) {
    checks.push(
      warn(
        `${shown(project, middleware)} is deprecated in Next.js 16.`,
        'Rename it to proxy.ts; the live checks below show whether it blocks askdare.',
      ),
    );
  }
  return checks;
}

/** `remote`: checking a deployed app, whose own key and model the live checks cover. */
async function environment(
  project: Project,
  env: Record<string, string | undefined>,
  envFiles: readonly string[],
  remote: boolean,
) {
  const checks: DoctorCheck[] = [];
  if (!remote) {
    checks.push(
      env['OPENAI_API_KEY']
        ? ok('OPENAI_API_KEY is set.')
        : fail(
            'OPENAI_API_KEY is not set.',
            'Add the key of a dedicated OpenAI project to .env.local.',
          ),
    );
  }
  const secret = env['CHAT_SECRET'];
  const previous = (env['CHAT_SECRET_PREVIOUS'] ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  if (!secret) {
    checks.push(
      fail(
        'CHAT_SECRET is not set.',
        `Generate one: node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"`,
      ),
    );
  } else {
    try {
      await createTokenService({ secret, previousSecrets: previous });
      checks.push(
        ok(
          previous.length > 0
            ? 'CHAT_SECRET and CHAT_SECRET_PREVIOUS are strong.'
            : 'CHAT_SECRET is strong.',
        ),
      );
    } catch (error) {
      checks.push(fail((error as Error).message.replace('[askdare] ', '')));
    }
  }
  // Optional: only for sites that sign visitors in (ADR-0009).
  const identitySecret = env['IDENTITY_SECRET'];
  if (identitySecret) {
    try {
      createIdentityVerifier({ secret: identitySecret, chatSecret: secret });
      checks.push(ok('IDENTITY_SECRET is strong and differs from CHAT_SECRET.'));
    } catch (error) {
      checks.push(fail((error as Error).message.replace('[askdare] ', '')));
    }
  }
  // The bot config `init` writes reads its model from ASKDARE_MODEL; without it the app won't start.
  const config = findFile(project.root, 'askdare.config');
  const usesModelVariable =
    env['ASKDARE_MODEL'] !== undefined ||
    (config !== undefined && (await readFile(config, 'utf8')).includes('ASKDARE_MODEL'));
  if (!remote && usesModelVariable && !env['ASKDARE_MODEL']) {
    checks.push(
      fail(
        env['ASKDARE_MODEL'] === undefined
          ? 'ASKDARE_MODEL is not set.'
          : 'ASKDARE_MODEL is empty.',
        'Set it to a current OpenAI model your project may use, here and in every environment of your host (on Vercel: Production and Preview). Without a model the app fails to start.',
      ),
    );
  }
  for (const file of envFiles) {
    const name = relative(project.root, resolve(project.root, file));
    if (name.startsWith('..') || isAbsolute(name) || (await gitIgnores(project.root, name))) {
      continue;
    }
    const values = parseEnv(await readFile(join(project.root, name), 'utf8'));
    if (values['OPENAI_API_KEY'] || values['CHAT_SECRET']) {
      checks.push(
        fail(
          `${name} holds secrets but is not in .gitignore.`,
          `Add \`${name.endsWith('.local') ? '.env*.local' : '.env*'}\` to .gitignore before you commit.`,
        ),
      );
    }
  }
  return checks;
}

async function request(
  fetcher: typeof fetch,
  url: string,
  init: RequestInit = {},
): Promise<Response | DoctorCheck> {
  try {
    return await fetcher(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(120_000),
      ...init,
    });
  } catch {
    return fail(`Could not reach ${url}.`);
  }
}

function redirectOrMissing(response: Response, url: string): DoctorCheck | undefined {
  if (response.status >= 300 && response.status < 400) {
    return fail(
      `${url} redirects to ${response.headers.get('location') ?? 'another page'}.`,
      PROXY_FIX,
    );
  }
  return undefined;
}

/** The sources of the response's `frame-ancestors`, one list per policy that sets it. */
function frameAncestorsOf(response: Response): string[][] {
  const policy = response.headers.get('content-security-policy') ?? '';
  return [...policy.matchAll(/frame-ancestors\s+([^;,]*)/g)].map((match) =>
    (match[1] ?? '').trim().split(/\s+/).filter(Boolean),
  );
}

/** Whether `origin` may frame a page whose `frame-ancestors` sources are these. */
const mayFrame = (sources: readonly string[], origin: string, appOrigin: string): boolean =>
  sources.includes(origin) || (origin === appOrigin && sources.includes("'self'"));

const EMBED_HEADERS_FIX = (path: string, botId: string): string =>
  `Send embedPageHeaders({ bots, bot: '${botId}' }) from @boldare/askdare/next for ${path} in the headers() of next.config.`;

/**
 * A bot's own page in the widget's iframe (ADR-0018): reachable without a login or a redirect,
 * rendered with EmbedRoot, framed only by the app and the bot's allowed origins, and with the
 * microphone off unless the bot has voice input.
 */
async function embedPage(
  fetcher: typeof fetch,
  base: string,
  botId: string,
  embed: BotEmbed,
  origin: string | undefined,
): Promise<DoctorCheck[]> {
  const appOrigin = new URL(base).origin;
  const url = `${appOrigin}${embed.path}`;
  const page = await request(fetcher, url);
  if (!(page instanceof Response)) return [page];
  const pageFix = `Leave ${embed.path} out of proxy.ts (its matcher) and of anything that signs visitors in or rewrites the path.`;
  const missing = redirectOrMissing(page, url);
  if (missing) {
    await page.body?.cancel();
    return [{ ...missing, fix: pageFix }];
  }
  if (!page.ok) {
    await page.body?.cancel();
    return [fail(`${url} answered HTTP ${page.status}.`, pageFix)];
  }
  const checks: DoctorCheck[] = [];
  const html = await page.text();
  checks.push(
    html.includes('data-askdare-embed')
      ? ok(`${embed.path} renders the chat.`)
      : fail(
          `${embed.path} doesn't render EmbedRoot.`,
          'Render <EmbedRoot config={getEmbedConfig(…)}> from @boldare/askdare/embed on that page.',
        ),
  );
  const fix = EMBED_HEADERS_FIX(embed.path, botId);
  const ancestors = frameAncestorsOf(page);
  const sources = ancestors[0] ?? [];
  const allowed = new Set(["'self'", appOrigin, ...embed.allowedOrigins]);
  const wider = sources.filter((source) => !allowed.has(source));
  // The app's own pages need it too: the widget there opens the same page.
  const absent = [
    ...(mayFrame(sources, appOrigin, appOrigin) ? [] : [appOrigin]),
    ...embed.allowedOrigins.filter((item) => !sources.includes(item)),
  ];
  if (page.headers.has('x-frame-options')) {
    checks.push(fail(`X-Frame-Options on ${embed.path} stops sites from embedding it.`, fix));
  } else if (ancestors.length !== 1) {
    checks.push(
      fail(
        ancestors.length === 0
          ? `Any site can frame ${embed.path}: it has no frame-ancestors policy.`
          : `A second Content-Security-Policy on ${embed.path} overrides who may frame it.`,
        fix,
      ),
    );
  } else if (wider.length > 0) {
    checks.push(
      fail(`${embed.path} may be framed by more than the bot allows: ${wider.join(' ')}`, fix),
    );
  } else if (absent.length > 0) {
    checks.push(
      fail(
        `${absent.join(', ')} may not frame ${embed.path}, so the widget can't open there.`,
        fix,
      ),
    );
  } else {
    checks.push(ok(`Sites that may frame ${embed.path}: ${sources.join(' ')}`));
  }
  if (origin !== undefined && ancestors.length === 1) {
    checks.push(
      mayFrame(sources, origin, appOrigin)
        ? ok(`${origin} may embed the chat.`)
        : fail(
            `${origin} may not embed the chat: it isn't in the bot's security.allowedOrigins.`,
            `Add '${origin}' to security.allowedOrigins of bot "${botId}" and deploy.`,
          ),
    );
  }
  const microphone = /(?:^|,)\s*microphone=([^,]*)/
    .exec(page.headers.get('permissions-policy') ?? '')?.[1]
    ?.trim();
  if (!embed.voice && microphone !== '()') {
    checks.push(
      fail(`${embed.path} doesn't keep the microphone off for a bot without voice input.`, fix),
    );
  } else if (embed.voice && !/\bself\b|\*/.test(microphone ?? '')) {
    checks.push(warn(`${embed.path} doesn't allow the microphone, so dictation won't start.`, fix));
  }
  if (page.headers.has('set-cookie')) {
    checks.push(
      warn(
        `Something sets cookies on ${embed.path}.`,
        'askdare uses no cookies; scripts on the page could read them with the chat.',
      ),
    );
  }
  return checks;
}

/** What the browser needs from widget.js and the chat page; things in front of askdare can break it. */
async function headers(
  fetcher: typeof fetch,
  base: string,
  botId: string,
  origin: string | undefined,
  embed: BotEmbed | undefined,
): Promise<DoctorCheck[]> {
  const checks: DoctorCheck[] = [];
  const loaderUrl = `${base}/widget.js?bot=${botId}`;
  const loader = await request(fetcher, loaderUrl);
  if (!(loader instanceof Response)) return [loader];
  const embedUrl = `${base}/embed/${botId}`;
  const embedResponse = await request(fetcher, embedUrl);
  if (!(embedResponse instanceof Response)) return [embedResponse];

  const loaderProblem = redirectOrMissing(loader, loaderUrl);
  if (loaderProblem) checks.push(loaderProblem);
  else if (!loader.ok || !(loader.headers.get('content-type') ?? '').includes('javascript')) {
    checks.push(
      fail(`${loaderUrl} answered HTTP ${loader.status} instead of the script.`, PROXY_FIX),
    );
  } else {
    checks.push(ok('widget.js loads.'));
  }

  if (embed) {
    // The route sends the iframe to the bot's own page (ADR-0018).
    const location = embedResponse.headers.get('location') ?? '';
    if (
      embedResponse.status === 302 &&
      (location === embed.path || location.startsWith(`${embed.path}?`))
    ) {
      checks.push(ok(`The widget opens ${embed.path}.`));
      checks.push(...(await embedPage(fetcher, base, botId, embed, origin)));
    } else {
      checks.push(fail(`${embedUrl} doesn't send the widget to ${embed.path}.`, PROXY_FIX));
    }
  } else {
    const embedProblem = redirectOrMissing(embedResponse, embedUrl);
    if (embedProblem) {
      checks.push(embedProblem);
    } else if (!embedResponse.ok) {
      checks.push(fail(`${embedUrl} answered HTTP ${embedResponse.status}.`, PROXY_FIX));
    } else {
      const ancestors = frameAncestorsOf(embedResponse);
      const fix = 'Leave /api/chat out of the headers() in next.config and of proxy.ts.';
      // A site that should embed the chat: the app itself ('self') or one of the bot's allowed origins.
      if (origin !== undefined && ancestors.length === 1) {
        checks.push(
          mayFrame(ancestors[0] ?? [], origin, new URL(base).origin)
            ? ok(`${origin} may embed the chat.`)
            : fail(
                `${origin} may not embed the chat: it isn't in the bot's security.allowedOrigins.`,
                `Add '${origin}' to security.allowedOrigins of bot "${botId}" and deploy.`,
              ),
        );
      }
      if (embedResponse.headers.has('x-frame-options')) {
        checks.push(fail('X-Frame-Options on the chat page stops sites from embedding it.', fix));
      } else if (ancestors.length !== 1) {
        checks.push(
          fail(
            ancestors.length === 0
              ? 'The chat page lost its frame-ancestors policy.'
              : 'A second Content-Security-Policy on the chat page overrides who may embed it.',
            fix,
          ),
        );
      } else {
        checks.push(ok(`Sites that may embed the chat: ${(ancestors[0] ?? []).join(' ')}`));
      }
    }
  }
  if (loader.headers.has('set-cookie') || embedResponse.headers.has('set-cookie')) {
    checks.push(
      warn(
        "Something sets cookies on askdare's responses.",
        'askdare uses no cookies; leave /api/chat out of the code that sets them.',
      ),
    );
  }
  await Promise.all([loader.body?.cancel(), embedResponse.body?.cancel()]);
  return checks;
}

/** The literal `maxDuration` of the askdare route, in seconds, if the file has one. */
async function maxDurationOf(project: Project, basePath: string): Promise<number | undefined> {
  const route = findFile(routeDir(project, basePath), 'route');
  if (!route) return undefined;
  const value = /export\s+const\s+maxDuration\s*=\s*(\d[\d_]*)/.exec(
    await readFile(route, 'utf8'),
  )?.[1];
  return value === undefined ? undefined : Number(value.replaceAll('_', ''));
}

/**
 * A bot whose answers may run longer than the route may: the platform ends the function first and
 * the answer is cut off. 15 s of headroom for the history read and the stream's end.
 */
function timeout(
  bot: DoctorReport['bots'][number],
  routeSeconds: number | undefined,
): DoctorCheck[] {
  if (bot.turnTimeoutMs === undefined || routeSeconds === undefined) return [];
  const needed = Math.ceil(bot.turnTimeoutMs / 1000) + 15;
  return needed > routeSeconds
    ? [
        warn(
          `An answer may take up to ${Math.ceil(bot.turnTimeoutMs / 1000)} s, but the route's maxDuration is ${routeSeconds} s.`,
          `Raise maxDuration to at least ${needed}, or lower limits.turnTimeoutMs.`,
        ),
      ]
    : [];
}

async function live(
  options: DoctorOptions,
  project: Project,
  env: Record<string, string | undefined>,
): Promise<Section[]> {
  const base = `${options.url.replace(/\/+$/, '')}${options.basePath}`;
  const fetcher = options.fetch ?? fetch;
  const title = `App at ${options.url}`;
  const start = `Start the app (${runScript(project, 'dev')}) or pass --url with where it runs.`;
  let token: string;
  try {
    const tokens = await createTokenService({ secret: env['CHAT_SECRET'] ?? '' });
    token = (await tokens.issueDoctor()).token;
  } catch {
    return [{ title, checks: [warn('Skipped: the live checks need CHAT_SECRET.')] }];
  }
  const response = await request(fetcher, `${base}/doctor`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
  });
  if (!(response instanceof Response)) return [{ title, checks: [{ ...response, fix: start }] }];
  const problem = redirectOrMissing(response, `${base}/doctor`);
  if (problem) return [{ title, checks: [problem] }];
  const json = (await response.json().catch(() => undefined)) as
    | { error?: { code?: string } }
    | undefined;
  if (!response.ok) {
    const code = json?.error?.code;
    const reason =
      response.status === 404 && code === undefined
        ? fail(`No askdare route at ${base}.`, 'Check --url and --base-path, and the route file.')
        : code === 'unauthorized'
          ? fail(
              "The app rejected the doctor's token: its CHAT_SECRET differs from yours.",
              'Run doctor with the CHAT_SECRET of that app, e.g. --env-file .env.production.local.',
            )
          : code === 'not_found'
            ? fail("This app's askdare has no doctor endpoint.", 'Update @boldare/askdare.')
            : code === 'bot_unavailable'
              ? fail(
                  'The app is switched off (ASKDARE_DISABLED) or has no CHAT_SECRET where it runs.',
                )
              : code === 'rate_limited'
                ? fail('Too many doctor runs at once or this minute.', 'Try again in a minute.')
                : fail(`${base}/doctor answered HTTP ${response.status}.`, 'Check the app’s logs.');
    return [{ title, checks: [reason] }];
  }
  const parsed = doctorReportSchema.safeParse(json);
  if (!parsed.success) {
    return [{ title, checks: [fail(`${base}/doctor did not answer like askdare.`, PROXY_FIX)] }];
  }
  const report: DoctorReport = parsed.data;
  const app: DoctorCheck[] = [
    ok(report.development ? 'Reachable (development).' : 'Reachable (production).'),
  ];
  if (!report.development && report.gallery) {
    app.push(warn('The state gallery is on.', 'Turn `gallery` off in production.'));
  }
  if (!report.development && !report.sharedLimits) {
    app.push(
      warn(
        'Rate limits and budgets are kept in memory, per instance.',
        'Fine for one server; with more (Vercel, several dynos) use @boldare/askdare-upstash.',
      ),
    );
  }
  const sections: Section[] = [{ title, checks: app }];
  const routeSeconds = await maxDurationOf(project, options.basePath);
  for (const bot of report.bots) {
    sections.push({
      title: `Bot "${bot.id}"`,
      checks: [
        ...bot.checks,
        ...(await headers(fetcher, base, bot.id, options.origin, bot.embed)),
        ...timeout(bot, routeSeconds),
        ...(bot.disclosure === false
          ? [
              info(
                'The AI notice is off (widget.disclosure: false).',
                'Fine when your page already tells visitors they are talking to an AI (EU AI Act, art. 50).',
              ),
            ]
          : []),
      ],
    });
  }
  return sections;
}

const MARK = { ok: '✓', info: 'i', warn: '!', fail: '✗' } as const;

/** localhost and loopback addresses: the app runs on this machine, with the env files here. */
export function isLocal(url: string): boolean {
  return /^(localhost|127\.0\.0\.1|\[::1\])$|\.localhost$/.test(new URL(url).hostname);
}

/** `askdare doctor`: checks the project, its environment and the running app. Returns failures. */
export async function doctor(options: DoctorOptions): Promise<number> {
  const project = await readProject(options.root);
  const { env, files: envFiles } = await readEnv(options.root, options.envFile, options.shell);
  const sections: Section[] = [
    {
      title: 'Project',
      checks: [...versions(project), ...(await files(project, options.basePath))],
    },
    {
      title: `Environment (${envFiles.join(', ') || 'shell only'})`,
      checks: await environment(project, env, envFiles, !isLocal(options.url)),
    },
    ...(await live(options, project, env)),
  ];
  options.print('askdare doctor');
  for (const section of sections) {
    options.print(`\n${section.title}`);
    for (const check of section.checks) {
      options.print(`  ${MARK[check.status]} ${check.title}`);
      if (check.fix) options.print(`    → ${check.fix}`);
    }
  }
  const all = sections.flatMap((section) => section.checks);
  const failures = all.filter((check) => check.status === 'fail').length;
  const warnings = all.filter((check) => check.status === 'warn').length;
  const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;
  options.print(
    failures + warnings === 0
      ? '\nAll good.'
      : `\n${plural(failures, 'problem')}, ${plural(warnings, 'warning')}.`,
  );
  return failures;
}
