import { formatText, pluralText } from './format';

export { formatText, pluralText };

/**
 * Every text the widget shows. The keys are public API (ADR-0008): override any of them with
 * `widget.texts`. Plural keys end in a CLDR category (`one`, `few`, `many`, `other`).
 */
const EN = {
  'header.title': 'Assistant',
  'header.newConversation': 'Start a new conversation',
  'header.close': 'Close chat',
  'confirm.newConversation': 'Start a new conversation? The current one will be deleted.',
  'confirm.cancel': 'Cancel',
  'confirm.accept': 'Start new',
  'welcome.label': 'Welcome',
  'welcome.greeting': 'Hi! How can I help?',
  'welcome.online': 'Online',
  'welcome.suggestions': 'Suggested questions',
  'composer.placeholder': 'Type your message…',
  'composer.send': 'Send',
  'composer.attach': 'Attach files',
  'composer.dictate': 'Dictate a message',
  'status.loading': 'Loading the conversation…',
  'status.thinking': 'Thinking…',
  'status.searching': 'Searching documents…',
  'status.tool': 'Using {name}…',
  'status.typing': 'The assistant is typing',
  'message.sources': 'Sources',
  'message.attachments.one': '{count} attachment',
  'message.attachments.other': '{count} attachments',
  'attachment.list': 'Attachments',
  'attachment.uploading': 'Uploading…',
  'attachment.remove': 'Remove {name}',
  'attachment.unsupported': 'This file type is not supported.',
  'attachment.tooLarge': 'Too large (max {size}).',
  'attachment.tooMany': 'You can attach up to {count} files per message.',
  'dictation.listening': 'Listening…',
  'dictation.transcribing': 'Transcribing…',
  'dictation.cancel': 'Cancel dictation',
  'dictation.done': 'Done',
  'dictation.empty': 'Nothing was recorded. Please try again.',
  'microphone.blocked': 'Microphone access is blocked. Allow it in your browser to dictate.',
  'microphone.missing': 'No microphone was found.',
  'microphone.failed': 'The microphone could not be started.',
  'disclosure.text': 'You’re chatting with an AI assistant. It can make mistakes.',
  'disclosure.privacy': 'Privacy policy',
  'launcher.label': 'Ask us',
  'launcher.open': 'Open chat',
  'launcher.close': 'Close chat',
  'launcher.unavailable': 'The chat couldn’t load. Please try again later.',
  'error.connection': 'Connection problem. Please try again.',
  'error.history': 'Could not load the previous conversation.',
  'error.updated': 'The assistant was updated. Please reload the page.',
  'error.stalled': 'The connection stalled. Please try again.',
  'error.uploadFailed': 'The file could not be uploaded.',
  'error.transcriptionFailed': 'The recording could not be transcribed.',
  'error.invalid_input': 'The request was invalid.',
  'error.unauthorized': 'Authentication is required.',
  'error.session_expired': 'Your session has expired. Please try again.',
  'error.not_found': 'Not found.',
  'error.content_blocked': 'This message cannot be processed.',
  'error.rate_limited': 'Too many messages. Please wait a moment.',
  'error.budget_exceeded': 'The assistant is unavailable for the rest of the day.',
  'error.internal_error': 'Something went wrong. Please try again.',
  'error.upstream_error': 'The assistant is temporarily unavailable. Please try again.',
  'error.bot_unavailable': 'The assistant is currently unavailable.',
  'error.timeout': 'The assistant took too long to respond. Please try again.',
  'error.conversationTooLong': 'This conversation is too long. Please start a new one.',
  'error.conversationGone': 'This conversation is no longer available.',
  'error.messageLength': 'Messages can be up to {max} characters.',
  'error.attachmentExpired': 'An attachment expired or is invalid. Please attach it again.',
  'error.filesNotAccepted': 'This assistant does not accept files.',
  'error.tooManyFiles': 'Attach up to {count} files per message.',
  'error.fileType.images': 'Only images (PNG, JPEG, WebP, GIF) are supported.',
  'error.fileType.pdf': 'Only PDF files are supported.',
  'error.fileType.both': 'Only images (PNG, JPEG, WebP, GIF) and PDF files are supported.',
  'error.fileTooLarge': 'Files can be up to {size}.',
  'error.pdfPages': 'PDFs can have up to {max} pages.',
  'error.voiceNotAccepted': 'This assistant does not accept voice input.',
  'error.recordingFormat': 'This recording format is not supported.',
  'error.recordingTooLong': 'This recording is too long.',
  'error.dictationBusy':
    'Another dictation is still being transcribed. Please try again in a moment.',
} as const;

/** Plural texts: the base plus a CLDR category, every category overridable. */
const PLURAL_BASES = ['message.attachments'] as const;
const PLURAL_FORMS = ['zero', 'one', 'two', 'few', 'many', 'other'] as const;
export type TextKey =
  | keyof typeof EN
  | `${(typeof PLURAL_BASES)[number]}.${(typeof PLURAL_FORMS)[number]}`;
export type Texts = Readonly<Record<TextKey, string>>;

const PL: Partial<Record<TextKey | `${string}.${'few' | 'many'}`, string>> = {
  'header.title': 'Asystent',
  'header.newConversation': 'Zacznij nową rozmowę',
  'header.close': 'Zamknij czat',
  'confirm.newConversation': 'Zacząć nową rozmowę? Obecna zostanie usunięta.',
  'confirm.cancel': 'Anuluj',
  'confirm.accept': 'Zacznij nową',
  'welcome.label': 'Powitanie',
  'welcome.greeting': 'Cześć! W czym mogę pomóc?',
  'welcome.online': 'Online',
  'welcome.suggestions': 'Proponowane pytania',
  'composer.placeholder': 'Napisz wiadomość…',
  'composer.send': 'Wyślij',
  'composer.attach': 'Dołącz pliki',
  'composer.dictate': 'Podyktuj wiadomość',
  'status.loading': 'Wczytuję rozmowę…',
  'status.thinking': 'Myślę…',
  'status.searching': 'Przeszukuję dokumenty…',
  'status.tool': 'Korzystam z narzędzia {name}…',
  'status.typing': 'Asystent pisze',
  'message.sources': 'Źródła',
  'message.attachments.one': '{count} załącznik',
  'message.attachments.few': '{count} załączniki',
  'message.attachments.many': '{count} załączników',
  'message.attachments.other': '{count} załącznika',
  'attachment.list': 'Załączniki',
  'attachment.uploading': 'Wysyłam…',
  'attachment.remove': 'Usuń {name}',
  'attachment.unsupported': 'Ten typ pliku nie jest obsługiwany.',
  'attachment.tooLarge': 'Za duży (maks. {size}).',
  'attachment.tooMany': 'Limit plików w jednej wiadomości: {count}.',
  'dictation.listening': 'Słucham…',
  'dictation.transcribing': 'Przepisuję…',
  'dictation.cancel': 'Anuluj dyktowanie',
  'dictation.done': 'Gotowe',
  'dictation.empty': 'Nic się nie nagrało. Spróbuj ponownie.',
  'microphone.blocked': 'Dostęp do mikrofonu jest zablokowany. Zezwól na niego w przeglądarce.',
  'microphone.missing': 'Nie znaleziono mikrofonu.',
  'microphone.failed': 'Nie udało się włączyć mikrofonu.',
  'disclosure.text': 'Rozmawiasz z asystentem AI. Może popełniać błędy.',
  'disclosure.privacy': 'Polityka prywatności',
  'launcher.label': 'Zapytaj nas',
  'launcher.open': 'Otwórz czat',
  'launcher.close': 'Zamknij czat',
  'launcher.unavailable': 'Nie udało się załadować czatu. Spróbuj ponownie później.',
  'error.connection': 'Problem z połączeniem. Spróbuj ponownie.',
  'error.history': 'Nie udało się wczytać poprzedniej rozmowy.',
  'error.updated': 'Asystent został zaktualizowany. Odśwież stronę.',
  'error.stalled': 'Połączenie zostało przerwane. Spróbuj ponownie.',
  'error.uploadFailed': 'Nie udało się wysłać pliku.',
  'error.transcriptionFailed': 'Nie udało się przepisać nagrania.',
  'error.invalid_input': 'Nieprawidłowe żądanie.',
  'error.unauthorized': 'Wymagane jest uwierzytelnienie.',
  'error.session_expired': 'Sesja wygasła. Spróbuj ponownie.',
  'error.not_found': 'Nie znaleziono.',
  'error.content_blocked': 'Nie możemy przetworzyć tej wiadomości.',
  'error.rate_limited': 'Zbyt wiele wiadomości. Poczekaj chwilę.',
  'error.budget_exceeded': 'Asystent jest niedostępny do końca dnia.',
  'error.internal_error': 'Coś poszło nie tak. Spróbuj ponownie.',
  'error.upstream_error': 'Asystent jest chwilowo niedostępny. Spróbuj ponownie.',
  'error.bot_unavailable': 'Asystent jest obecnie niedostępny.',
  'error.timeout': 'Odpowiedź trwała zbyt długo. Spróbuj ponownie.',
  'error.conversationTooLong': 'Ta rozmowa jest zbyt długa. Zacznij nową.',
  'error.conversationGone': 'Ta rozmowa nie jest już dostępna.',
  'error.messageLength': 'Wiadomość może mieć maksymalnie {max} znaków.',
  'error.attachmentExpired': 'Załącznik wygasł lub jest nieprawidłowy. Dołącz go ponownie.',
  'error.filesNotAccepted': 'Ten asystent nie przyjmuje plików.',
  'error.tooManyFiles': 'Limit plików w jednej wiadomości: {count}.',
  'error.fileType.images': 'Obsługujemy tylko obrazy (PNG, JPEG, WebP, GIF).',
  'error.fileType.pdf': 'Obsługujemy tylko pliki PDF.',
  'error.fileType.both': 'Obsługujemy tylko obrazy (PNG, JPEG, WebP, GIF) i pliki PDF.',
  'error.fileTooLarge': 'Plik może mieć maksymalnie {size}.',
  'error.pdfPages': 'PDF może mieć maksymalnie {max} stron.',
  'error.voiceNotAccepted': 'Ten asystent nie przyjmuje nagrań głosowych.',
  'error.recordingFormat': 'Ten format nagrania nie jest obsługiwany.',
  'error.recordingTooLong': 'To nagranie jest zbyt długie.',
  'error.dictationBusy': 'Poprzednie nagranie jest jeszcze przepisywane. Spróbuj za chwilę.',
};

/** The canonical form of a BCP 47 tag that Intl accepts (plural rules need it), else undefined. */
export function canonicalLocale(tag: string): string | undefined {
  if (tag.length > 35) return undefined;
  try {
    return Intl.getCanonicalLocales(tag)[0];
  } catch {
    return undefined;
  }
}

/** Languages with a built-in dictionary; any other locale shows English texts. */
export const TEXT_LOCALES = ['en', 'pl'] as const;
export type TextLocale = (typeof TEXT_LOCALES)[number];

const DICTIONARIES: Readonly<Record<TextLocale, Readonly<Record<string, string>>>> = {
  en: EN,
  pl: { ...EN, ...PL },
};

/** The dictionary language for a BCP 47 tag: its primary subtag when built in, else English. */
export function textLocale(locale: string): TextLocale {
  const primary = locale.toLowerCase().split('-')[0] as TextLocale;
  return TEXT_LOCALES.includes(primary) ? primary : 'en';
}

/** Every key `widget.texts` accepts. */
export const TEXT_KEYS: readonly TextKey[] = [
  ...new Set([
    ...(Object.keys(EN) as TextKey[]),
    ...PLURAL_BASES.flatMap((base) => PLURAL_FORMS.map((form) => `${base}.${form}` as TextKey)),
  ]),
];

/**
 * The full dictionary for a locale with overrides applied. Plural forms beyond `one`/`other`
 * (Polish `few`, `many`) are kept too, so the widget can pick them.
 */
export function textsFor(
  locale: string,
  overrides: Readonly<Partial<Record<TextKey, string>>> = {},
): Readonly<Record<string, string>> {
  return { ...DICTIONARIES[textLocale(locale)], ...overrides };
}
