import { describe, expect, it, vi } from 'vitest';
import { switchLocale } from './switch-locale';

/** A bridge whose locale messages the test sends, and a store whose switches it settles. */
function setup(results: Record<string, boolean>) {
  let send: (locale: string, inPlace: boolean) => void = () => {};
  const pending: (() => void)[] = [];
  const store = {
    language: undefined as string | undefined,
    setLocale: vi.fn(
      (locale: string) =>
        new Promise<boolean>((resolve) => {
          pending.push(() => {
            if (results[locale]) store.language = `${locale}-written`;
            resolve(results[locale] ?? false);
          });
        }),
    ),
  };
  const bridge = {
    onLocale: (listener: (locale: string, inPlace: boolean) => void) => {
      send = listener;
      return () => {};
    },
  };
  const effects = { reload: vi.fn(), switched: vi.fn() };
  switchLocale(store, bridge, effects);
  const settle = async (): Promise<void> => {
    for (const resolve of pending.splice(0)) resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  };
  return {
    send: (locale: string, inPlace = true) => send(locale, inPlace),
    settle,
    store,
    effects,
  };
}

describe('switchLocale', () => {
  it('reloads for a loader from before step 2', () => {
    const { send, store, effects } = setup({});
    send('pl', false);
    expect(effects.reload).toHaveBeenCalledWith('pl');
    expect(store.setLocale).not.toHaveBeenCalled();
  });

  it('switches in place and names the language the texts are written in', async () => {
    const { send, settle, effects } = setup({ pl: true });
    send('pl');
    await settle();
    expect(effects.switched).toHaveBeenCalledWith('pl', 'pl-written');
    expect(effects.reload).not.toHaveBeenCalled();
  });

  it('reloads when the texts for the latest language cannot be loaded', async () => {
    const { send, settle, effects } = setup({ pl: false });
    send('pl');
    await settle();
    expect(effects.reload).toHaveBeenCalledWith('pl');
  });

  it('ignores a failed switch that a later one overtook', async () => {
    const { send, settle, effects } = setup({ pl: false, de: true });
    send('pl');
    send('de');
    await settle();
    expect(effects.reload).not.toHaveBeenCalled();
    expect(effects.switched).toHaveBeenCalledWith('de', 'de-written');
  });
});
