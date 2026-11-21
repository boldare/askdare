import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  init: vi.fn(async (_options: unknown) => {}),
  addUi: vi.fn(async (_options: unknown) => {}),
  doctor: vi.fn(async (_options: unknown) => 0),
  kbSync: vi.fn(async (_args: readonly string[]) => 0),
}));

// The commands have their own tests; here only the argument parsing and exit codes matter.
vi.mock('./init', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./init')>()),
  init: mocks.init,
}));
vi.mock('./add-ui', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./add-ui')>()),
  addUi: mocks.addUi,
}));
vi.mock('./doctor', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./doctor')>()),
  doctor: mocks.doctor,
}));
vi.mock('./kb-sync', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./kb-sync')>()),
  kbSync: mocks.kbSync,
}));

let out: string[];
let err: string[];
const argv = process.argv;

/** Runs the CLI as `askdare <args>` and resolves with its exit code. */
async function cli(...args: string[]): Promise<number> {
  process.argv = ['node', 'askdare', ...args];
  vi.resetModules();
  await import('./index');
  await vi.waitFor(() => {
    if (process.exitCode === undefined) throw new Error('still running');
  });
  return Number(process.exitCode);
}

beforeEach(() => {
  out = [];
  err = [];
  process.exitCode = undefined;
  vi.spyOn(console, 'log').mockImplementation((line: unknown) => void out.push(String(line)));
  vi.spyOn(console, 'error').mockImplementation((line: unknown) => void err.push(String(line)));
  for (const mock of Object.values(mocks)) mock.mockClear();
});

afterEach(() => {
  process.argv = argv;
  process.exitCode = undefined;
  vi.restoreAllMocks();
});

describe('askdare', () => {
  it('prints the usage without a command, or with -h/--help', async () => {
    for (const args of [[], ['-h'], ['--help']]) {
      out = [];
      expect(await cli(...args)).toBe(0);
      expect(out.join('\n')).toContain('Usage: npx @boldare/askdare <command>');
    }
  });

  it('fails on an unknown command, with the usage', async () => {
    expect(await cli('deploy', '--now')).toBe(1);
    expect(err.join('\n')).toContain('Unknown command "deploy --now".');
    expect(err.join('\n')).toContain('Usage: npx @boldare/askdare <command>');
  });

  it('fails on an unknown option, with the usage', async () => {
    expect(await cli('init', '--bott', 'x')).toBe(1);
    expect(err.join('\n')).toContain('--bott');
    expect(err.join('\n')).toContain('Usage:');
    expect(mocks.init).not.toHaveBeenCalled();
  });

  it('reports an unexpected error on one line, without the usage', async () => {
    mocks.init.mockRejectedValueOnce(new Error('disk full'));
    expect(await cli('init')).toBe(1);
    expect(err).toEqual(['askdare: disk full']);
  });
});

describe('askdare init', () => {
  it('defaults the bot ID to support', async () => {
    expect(await cli('init')).toBe(0);
    expect(mocks.init).toHaveBeenCalledWith(
      expect.objectContaining({ root: process.cwd(), botId: 'support', model: undefined }),
    );
  });

  it('passes --bot and --model', async () => {
    expect(await cli('init', '--bot', 'sales', '--model', 'gpt-x')).toBe(0);
    expect(mocks.init).toHaveBeenCalledWith(
      expect.objectContaining({ botId: 'sales', model: 'gpt-x' }),
    );
  });

  it('prints its help without running', async () => {
    expect(await cli('init', '--help')).toBe(0);
    expect(mocks.init).not.toHaveBeenCalled();
    expect(out.join('\n')).toContain('Usage:');
  });

  it('exits 1 on an InitError, with its message', async () => {
    mocks.init.mockImplementationOnce(async () => {
      const { InitError } = await import('./init');
      throw new InitError('No package.json here.');
    });
    expect(await cli('init')).toBe(1);
    expect(err).toEqual(['askdare init: No package.json here.']);
  });
});

describe('askdare add ui', () => {
  it('passes --dir', async () => {
    expect(await cli('add', 'ui', '--dir', 'src/chat')).toBe(0);
    expect(mocks.addUi).toHaveBeenCalledWith(expect.objectContaining({ dir: 'src/chat' }));
  });

  it('needs the ui subcommand', async () => {
    expect(await cli('add')).toBe(1);
    expect(mocks.addUi).not.toHaveBeenCalled();
  });

  it('exits 1 on an AddUiError, with its message', async () => {
    mocks.addUi.mockImplementationOnce(async () => {
      const { AddUiError } = await import('./add-ui');
      throw new AddUiError('components/askdare exists.');
    });
    expect(await cli('add', 'ui')).toBe(1);
    expect(err).toEqual(['askdare add ui: components/askdare exists.']);
  });
});

describe('askdare doctor', () => {
  it('checks the local app on the default route by default', async () => {
    expect(await cli('doctor')).toBe(0);
    expect(mocks.doctor).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'http://localhost:3000',
        basePath: '/api/chat',
        envFile: undefined,
        origin: undefined,
      }),
    );
  });

  it('passes its options, keeping only the origin of --origin', async () => {
    expect(
      await cli(
        'doctor',
        '--url',
        'https://app.example.com',
        '--base-path',
        '/support/chat',
        '--env-file',
        '.env.production',
        '--origin',
        'https://www.example.com/pricing?x=1',
      ),
    ).toBe(0);
    expect(mocks.doctor).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'https://app.example.com',
        basePath: '/support/chat',
        envFile: '.env.production',
        origin: 'https://www.example.com',
      }),
    );
  });

  it('exits 1 when a check fails', async () => {
    mocks.doctor.mockResolvedValueOnce(2);
    expect(await cli('doctor')).toBe(1);
  });

  it.each([
    [['--url', 'not a url'], '--url must be a URL'],
    [['--url', 'http://app.example.com'], '--url must use https'],
    [['--base-path', 'api/chat'], '--base-path must look like /api/chat.'],
    [['--origin', 'www.example.com'], '--origin must be a URL'],
  ])('rejects %j', async (args, message) => {
    expect(await cli('doctor', ...args)).toBe(1);
    expect(err.join('\n')).toContain(message);
    expect(mocks.doctor).not.toHaveBeenCalled();
  });

  it('allows plain http for localhost', async () => {
    expect(await cli('doctor', '--url', 'http://127.0.0.1:3001')).toBe(0);
    expect(mocks.doctor).toHaveBeenCalledOnce();
  });
});

describe('askdare kb sync', () => {
  it('hands the remaining arguments to kb sync', async () => {
    expect(await cli('kb', 'sync', './docs', '--dry-run')).toBe(0);
    expect(mocks.kbSync).toHaveBeenCalledWith(['./docs', '--dry-run']);
  });

  it('prints the kb usage for a kb usage error', async () => {
    // The module registry is reset per run, so the error class comes from the fresh one.
    mocks.kbSync.mockImplementationOnce(async () => {
      const { UsageError } = await import('./usage');
      throw new UsageError('Expected exactly one folder.');
    });
    expect(await cli('kb', 'sync')).toBe(1);
    expect(err.join('\n')).toContain('Expected exactly one folder.');
    expect(err.join('\n')).toContain('Usage: npx @boldare/askdare kb sync <folder>');
  });
});
