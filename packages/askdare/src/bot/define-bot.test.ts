import { describe, expect, it } from 'vitest';
import { createBot, widgetTexts } from './define-bot';

describe('createBot', () => {
  it('applies default limits and normalizes instructions to a function', () => {
    const bot = createBot({ id: 'support', model: 'test-model', instructions: 'Be helpful.' });
    expect(bot.limits).toEqual({
      maxOutputTokens: 1024,
      maxInputChars: 4000,
      maxSteps: 5,
      turnTimeoutMs: 120_000,
      dailyTokens: 2_000_000,
      dailyTokensPerIp: 200_000,
      sessionsPerIpPerHour: 30,
      conversationsPerIpPerHour: 20,
      messagesPerVisitorPerMinute: 10,
      messagesPerIpPerMinute: 30,
      maxTurns: 50,
      uploadsPerVisitorPerHour: 20,
      uploadsPerIpPerHour: 60,
      uploadsPerDay: 500,
      transcriptionsPerVisitorPerHour: 30,
      voiceSecondsPerDay: 3_600,
      voiceSecondsPerIpPerDay: 600,
    });
    expect(bot.voice).toBeUndefined();
    expect(bot.instructions({ locale: 'en' })).toBe('Be helpful.');
    expect(bot.attachments).toBeUndefined();
  });

  it('requires a transcription model for voice input and defaults to 60 seconds', () => {
    const bot = createBot({ id: 'a', model: 'm', instructions: 'x', voice: { model: ' t ' } });
    expect(bot.voice).toEqual({ model: 't', maxSeconds: 60 });
    expect(() =>
      createBot({ id: 'a', model: 'm', instructions: 'x', voice: { model: '' } }),
    ).toThrow(/voice\.model is required/);
  });

  it('defaults attachments to images and PDFs up to 4 MB, 3 per message', () => {
    const bot = createBot({ id: 'a', model: 'm', instructions: 'x', attachments: { pdf: false } });
    expect(bot.attachments).toEqual({
      images: true,
      pdf: false,
      maxBytes: 4_000_000,
      maxPerMessage: 3,
      maxPdfPages: 50,
    });
    expect(() =>
      createBot({
        id: 'a',
        model: 'm',
        instructions: 'x',
        attachments: { images: false, pdf: false },
      }),
    ).toThrow(/attachments must allow images or pdf/);
  });

  it('keeps instruction functions and overrides selected limits', () => {
    const bot = createBot({
      id: 'sales-pl',
      model: 'test-model',
      instructions: ({ locale }) => `Answer in ${locale}.`,
      limits: { maxSteps: 2 },
    });
    expect(bot.instructions({ locale: 'pl' })).toBe('Answer in pl.');
    expect(bot.limits.maxSteps).toBe(2);
    expect(bot.limits.maxOutputTokens).toBe(1024);
  });

  it('takes a page of the app as embedPath, and nothing that could leave it (ADR-0018)', () => {
    const base = { id: 'a', model: 'm', instructions: 'x' };
    expect(createBot(base).embedPath).toBeUndefined();
    expect(createBot({ ...base, embedPath: '/askdare/support' }).embedPath).toBe(
      '/askdare/support',
    );
    for (const embedPath of [
      'https://evil.example/x',
      '//evil.example',
      '/a/../b',
      'askdare',
      '/a?b=1',
    ]) {
      expect(() => createBot({ ...base, embedPath })).toThrow(
        /embedPath must be a path of this app/,
      );
    }
  });

  it('defaults the widget config and keeps allowed origins unique', () => {
    const bot = createBot({
      id: 'a',
      model: 'm',
      instructions: 'x',
      security: { allowedOrigins: ['https://example.com', 'https://example.com'] },
      widget: { title: 'Helper', locale: 'pl' },
    });
    expect(bot.security.allowedOrigins).toEqual(['https://example.com']);
    expect(bot.widget).toMatchObject({
      title: 'Helper',
      locale: 'pl',
      greeting: expect.any(String),
    });
  });

  it('defaults knowledge search to 5 results and allows no knowledge base', () => {
    const bot = createBot({
      id: 'a',
      model: 'm',
      instructions: 'x',
      knowledge: { vectorStoreId: 'vs_1' },
    });
    expect(bot.knowledge).toEqual({ vectorStoreId: 'vs_1', maxResults: 5 });
    expect(
      createBot({ id: 'a', model: 'm', instructions: 'x', knowledge: undefined }).knowledge,
    ).toBeUndefined();
  });

  it('is frozen', () => {
    const bot = createBot({ id: 'a', model: 'm', instructions: 'x' });
    expect(Object.isFrozen(bot)).toBe(true);
    expect(Object.isFrozen(bot.limits)).toBe(true);
  });

  it.each([
    [{ id: 'Bad Id', model: 'm', instructions: 'x' }, /id use 1-48 lowercase/],
    [{ id: 'ok', model: '  ', instructions: 'x' }, /model is required/],
    [{ id: 'ok', model: 'm', instructions: '' }, /instructions/],
    [{ id: 'ok', model: 'm', instructions: 'x', limits: { maxSteps: 50 } }, /limits\.maxSteps/],
    [
      {
        id: 'ok',
        model: 'm',
        instructions: 'x',
        security: { allowedOrigins: ['https://*.example.com'] },
      },
      /security\.allowedOrigins\.0 must be an https origin/,
    ],
    [
      {
        id: 'ok',
        model: 'm',
        instructions: 'x',
        security: { allowedOrigins: ['https://example.com/path'] },
      },
      /must be an https origin/,
    ],
    [{ id: 'ok', model: 'm', instructions: 'x', widget: { locale: 'english please' } }, /BCP 47/],
    [
      { id: 'ok', model: 'm', instructions: 'x', knowledge: { vectorStoreId: 'file-1' } },
      /knowledge\.vectorStoreId must be a vector store ID/,
    ],
    [
      {
        id: 'ok',
        model: 'm',
        instructions: 'x',
        knowledge: { vectorStoreId: 'vs_1', maxResults: 100 },
      },
      /knowledge\.maxResults/,
    ],
    [
      {
        id: 'ok',
        model: 'm',
        instructions: 'x',
        security: { allowedOrigins: ['http://www.example.com'] },
      },
      /https origin/,
    ],
  ])('rejects invalid definitions (%#)', (definition, message) => {
    expect(() => createBot(definition)).toThrow(message);
  });

  describe('widget.texts per language', () => {
    const define = (widget: NonNullable<Parameters<typeof createBot>[0]['widget']>) =>
      createBot({ id: 'a', model: 'm', instructions: 'x', widget });

    it('keeps the flat form for every language, with the shortcuts winning', () => {
      const bot = define({
        title: 'Shortcut',
        texts: { 'header.title': 'Flat', 'launcher.label': 'Questions?' },
      });
      expect(bot.widget.texts).toEqual({
        'header.title': 'Shortcut',
        'launcher.label': 'Questions?',
      });
      expect(bot.widget.textsByLocale).toEqual({});
      expect(widgetTexts(bot.widget, 'pl')).toBe(bot.widget.texts);
    });

    it('picks the set for the tag, then its primary subtag, else en for a language without a dictionary', () => {
      const bot = define({
        locale: 'auto',
        greeting: 'Hi from the shortcut',
        texts: {
          en: { 'launcher.label': 'Questions?' },
          'pl-PL': { 'launcher.label': 'Pytania?', 'welcome.greeting': 'Cześć' },
          DE: { 'launcher.label': 'Fragen?' },
        },
      });
      expect(Object.keys(bot.widget.textsByLocale)).toEqual(['en', 'pl-PL', 'de']);
      expect(bot.widget.texts).toEqual({ 'welcome.greeting': 'Hi from the shortcut' });
      expect(widgetTexts(bot.widget, 'pl-PL')).toEqual({
        'launcher.label': 'Pytania?',
        'welcome.greeting': 'Cześć',
      });
      expect(widgetTexts(bot.widget, 'de-AT')['launcher.label']).toBe('Fragen?');
      expect(widgetTexts(bot.widget, 'en-GB')['launcher.label']).toBe('Questions?');
      // French has no dictionary, so it shows English, with the en set.
      expect(widgetTexts(bot.widget, 'fr')['launcher.label']).toBe('Questions?');
      // Another tag of the same language uses its set.
      expect(widgetTexts(bot.widget, 'pl')['launcher.label']).toBe('Pytania?');
      // Polish has a dictionary: without its set it gets only the shortcuts, never English texts.
      const englishOnly = define({
        locale: 'auto',
        greeting: 'Hi',
        texts: { en: { 'launcher.label': 'Q' } },
      });
      expect(widgetTexts(englishOnly.widget, 'pl')).toEqual({ 'welcome.greeting': 'Hi' });
      // The resolved shortcuts follow the bot's own language, English for auto.
      expect(bot.widget.launcherLabel).toBe('Questions?');
      expect(bot.widget.greeting).toBe('Hi from the shortcut');
    });

    it("resolves a fixed locale's shortcuts from its own set", () => {
      const bot = define({ locale: 'pl', texts: { pl: { 'header.title': 'Asystent' } } });
      expect(bot.widget.title).toBe('Asystent');
    });

    it('rejects unknown keys, invalid tags and the same language twice', () => {
      expect(() => define({ texts: { 'no.such.key': 'x' } as never })).toThrow(/widget\.texts/);
      expect(() => define({ texts: { en: { 'no.such.key': 'x' } } as never })).toThrow(
        /widget\.texts\.en/,
      );
      expect(() => define({ texts: { 'not a tag!': { 'launcher.label': 'x' } } })).toThrow(
        /BCP 47/,
      );
      expect(() =>
        define({ texts: { pl: { 'launcher.label': 'a' }, PL: { 'launcher.label': 'b' } } }),
      ).toThrow(/same language twice/);
      expect(() => define({ texts: { en: { 'launcher.label': '' } } })).toThrow(/widget\.texts/);
    });
  });
});
