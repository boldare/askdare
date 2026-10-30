# Texts

Every text the chat shows has a key, such as `composer.placeholder`. The library ships each text in English and Polish, and you can replace any of them per bot. The keys are public API ([ADR-0006](adr/0006-support-matrix-and-versioning.md)), so you can rely on them in your configuration.

The keys cover the chat and the launcher on your page: `launcher.*`, and `header.title`, which also names the chat dialog. A key named after an error code, such as `error.rate_limited`, is the text the widget shows for that code; some errors have a more specific key, such as `error.conversationTooLong`. The server sends these keys with its errors ([Wire protocol](protocol.md#error-keys-and-parameters)).

## Override texts

Set `widget.texts` in `defineBot`:

```ts
defineBot({
  // …
  widget: {
    texts: {
      'composer.placeholder': 'Ask about plans, support or security…',
      'launcher.label': 'Questions?',
      'message.attachments.one': '{count} file',
      'message.attachments.other': '{count} files',
    },
  },
});
```

- **Keys.** Only the keys in the table below are accepted. An unknown key, or a text that is empty or longer than 300 characters, makes `defineBot` throw at startup.
- **Shortcuts.** `title`, `greeting`, `placeholder` and `launcherLabel` set `header.title`, `welcome.greeting`, `composer.placeholder` and `launcher.label`. If you set a shortcut and the same key in `texts`, the shortcut wins.
- **Every language.** An override replaces the text in every language. With `locale: 'auto'`, Polish visitors see your override too.
- **Placeholders.** Words in braces, such as `{count}`, `{name}`, `{size}` and `{max}`, are filled in by the widget. Keep the ones the default text has. A placeholder the widget doesn't fill for that key is shown as typed.
- **Bold.** In `welcome.greeting`, `**words**` are shown in bold.

A page can still set its own greeting with `askdare('configure', { greeting })`; see [Styling](styling.md#3-page-javascript).

## Languages

`widget.locale` picks the language:

| Value | Texts |
| --- | --- |
| `'en'` (default) | English |
| A Polish tag, such as `'pl'` or `'pl-PL'` | Polish |
| Any other BCP 47 tag, such as `'de'` | English, unless you set `texts` |
| `'auto'` | The language of the page that embeds the chat (its `lang` attribute), else the visitor's browser language, else English |

`defineBot` throws on a value that is neither `'auto'` nor a valid BCP 47 tag. The language part of the tag picks the dictionary, and the full tag picks the plural rules.

With `'auto'`, the launcher on your page follows the same order. Your `instructions` function receives the chosen tag as `context.locale`, so you can tell the model which language to answer in.

## Plurals

A text with a number has one key per plural category: `zero`, `one`, `two`, `few`, `many` and `other`, the categories `Intl.PluralRules` uses. `message.attachments` is such a text: after a page reload, the chat shows it under each message that had files.

The widget asks `Intl.PluralRules` which category the number falls into for the visitor's locale and shows the text for it. When the language has no text for that category, the widget shows the `other` text.

Each language uses only some categories:

- **English** uses `one` and `other`. Zero is `other` in English, so `message.attachments.zero` has no effect there.
- **Polish** uses `one`, `few`, `many` and `other` (fractions): 1 załącznik, 3 załączniki, 5 załączników.

To see the categories of another language, run `new Intl.PluralRules('cs').resolvedOptions().pluralCategories` in a browser console. Override every category the language uses: if you set only `one` and `other` on a Polish bot, `few` and `many` keep their Polish defaults.

## Add a language

The library has dictionaries for English and Polish only, and `widget.texts` has no per-language form. For another language, set a fixed `locale` and translate every key:

```ts
defineBot({
  // …
  widget: {
    locale: 'de',
    texts: {
      'header.title': 'Assistent',
      'composer.placeholder': 'Nachricht eingeben…',
      'message.attachments.one': '{count} Anhang',
      'message.attachments.other': '{count} Anhänge',
      // … and every other key
    },
  },
});
```

- Keys you leave out show English.
- Plurals follow the rules of the tag you set, so translate each category the language uses.
- Keep `locale` fixed. With `'auto'`, your translations would show to every visitor, whatever their language. For a site in several languages without a dictionary, define one bot per language, each with its own `locale` and `texts`.
- The chat document's `lang` attribute is your `locale` as soon as `widget.texts` has any key, so screen readers read your translation in the right language. Without your texts, a language without a built-in dictionary shows English, and `lang` says `en`.

## All texts

The table is generated from the library's dictionaries with `pnpm --filter @boldare/askdare docs:texts`.

<!-- BEGIN:generated-texts -->
<!-- Generated by `pnpm --filter @boldare/askdare docs:texts` from the dictionaries. Do not edit by hand. -->

| Key | English | Polish |
| --- | --- | --- |
| `header.title` | Assistant | Asystent |
| `header.newConversation` | Start a new conversation | Zacznij nową rozmowę |
| `header.close` | Close chat | Zamknij czat |
| `confirm.newConversation` | Start a new conversation? The current one will be deleted. | Zacząć nową rozmowę? Obecna zostanie usunięta. |
| `confirm.cancel` | Cancel | Anuluj |
| `confirm.accept` | Start new | Zacznij nową |
| `welcome.label` | Welcome | Powitanie |
| `welcome.greeting` | Hi! How can I help? | Cześć! W czym mogę pomóc? |
| `welcome.online` | Online | Online |
| `welcome.suggestions` | Suggested questions | Proponowane pytania |
| `composer.placeholder` | Type your message… | Napisz wiadomość… |
| `composer.send` | Send | Wyślij |
| `composer.attach` | Attach files | Dołącz pliki |
| `composer.dictate` | Dictate a message | Podyktuj wiadomość |
| `status.loading` | Loading the conversation… | Wczytuję rozmowę… |
| `status.thinking` | Thinking… | Myślę… |
| `status.searching` | Searching documents… | Przeszukuję dokumenty… |
| `status.tool` | Using {name}… | Korzystam z narzędzia {name}… |
| `status.typing` | The assistant is typing | Asystent pisze |
| `message.sources` | Sources | Źródła |
| `message.attachments.zero` | — | — |
| `message.attachments.one` | {count} attachment | {count} załącznik |
| `message.attachments.two` | — | — |
| `message.attachments.few` | — | {count} załączniki |
| `message.attachments.many` | — | {count} załączników |
| `message.attachments.other` | {count} attachments | {count} załącznika |
| `attachment.list` | Attachments | Załączniki |
| `attachment.uploading` | Uploading… | Wysyłam… |
| `attachment.remove` | Remove {name} | Usuń {name} |
| `attachment.unsupported` | This file type is not supported. | Ten typ pliku nie jest obsługiwany. |
| `attachment.tooLarge` | Too large (max {size}). | Za duży (maks. {size}). |
| `attachment.tooMany` | You can attach up to {count} files per message. | Limit plików w jednej wiadomości: {count}. |
| `dictation.listening` | Listening… | Słucham… |
| `dictation.transcribing` | Transcribing… | Przepisuję… |
| `dictation.cancel` | Cancel dictation | Anuluj dyktowanie |
| `dictation.done` | Done | Gotowe |
| `dictation.empty` | Nothing was recorded. Please try again. | Nic się nie nagrało. Spróbuj ponownie. |
| `microphone.blocked` | Microphone access is blocked. Allow it in your browser to dictate. | Dostęp do mikrofonu jest zablokowany. Zezwól na niego w przeglądarce. |
| `microphone.missing` | No microphone was found. | Nie znaleziono mikrofonu. |
| `microphone.failed` | The microphone could not be started. | Nie udało się włączyć mikrofonu. |
| `disclosure.text` | You’re chatting with an AI assistant. It can make mistakes. | Rozmawiasz z asystentem AI. Może popełniać błędy. |
| `disclosure.privacy` | Privacy policy | Polityka prywatności |
| `launcher.label` | Ask us | Zapytaj nas |
| `launcher.open` | Open chat | Otwórz czat |
| `launcher.close` | Close chat | Zamknij czat |
| `launcher.unavailable` | The chat couldn’t load. Please try again later. | Nie udało się załadować czatu. Spróbuj ponownie później. |
| `error.connection` | Connection problem. Please try again. | Problem z połączeniem. Spróbuj ponownie. |
| `error.history` | Could not load the previous conversation. | Nie udało się wczytać poprzedniej rozmowy. |
| `error.updated` | The assistant was updated. Please reload the page. | Asystent został zaktualizowany. Odśwież stronę. |
| `error.stalled` | The connection stalled. Please try again. | Połączenie zostało przerwane. Spróbuj ponownie. |
| `error.uploadFailed` | The file could not be uploaded. | Nie udało się wysłać pliku. |
| `error.transcriptionFailed` | The recording could not be transcribed. | Nie udało się przepisać nagrania. |
| `error.invalid_input` | The request was invalid. | Nieprawidłowe żądanie. |
| `error.unauthorized` | Authentication is required. | Wymagane jest uwierzytelnienie. |
| `error.session_expired` | Your session has expired. Please try again. | Sesja wygasła. Spróbuj ponownie. |
| `error.not_found` | Not found. | Nie znaleziono. |
| `error.content_blocked` | This message cannot be processed. | Nie możemy przetworzyć tej wiadomości. |
| `error.rate_limited` | Too many messages. Please wait a moment. | Zbyt wiele wiadomości. Poczekaj chwilę. |
| `error.budget_exceeded` | The assistant is unavailable for the rest of the day. | Asystent jest niedostępny do końca dnia. |
| `error.internal_error` | Something went wrong. Please try again. | Coś poszło nie tak. Spróbuj ponownie. |
| `error.upstream_error` | The assistant is temporarily unavailable. Please try again. | Asystent jest chwilowo niedostępny. Spróbuj ponownie. |
| `error.bot_unavailable` | The assistant is currently unavailable. | Asystent jest obecnie niedostępny. |
| `error.timeout` | The assistant took too long to respond. Please try again. | Odpowiedź trwała zbyt długo. Spróbuj ponownie. |
| `error.conversationTooLong` | This conversation is too long. Please start a new one. | Ta rozmowa jest zbyt długa. Zacznij nową. |
| `error.conversationGone` | This conversation is no longer available. | Ta rozmowa nie jest już dostępna. |
| `error.messageLength` | Messages can be up to {max} characters. | Wiadomość może mieć maksymalnie {max} znaków. |
| `error.attachmentExpired` | An attachment expired or is invalid. Please attach it again. | Załącznik wygasł lub jest nieprawidłowy. Dołącz go ponownie. |
| `error.filesNotAccepted` | This assistant does not accept files. | Ten asystent nie przyjmuje plików. |
| `error.tooManyFiles` | Attach up to {count} files per message. | Limit plików w jednej wiadomości: {count}. |
| `error.fileType.images` | Only images (PNG, JPEG, WebP, GIF) are supported. | Obsługujemy tylko obrazy (PNG, JPEG, WebP, GIF). |
| `error.fileType.pdf` | Only PDF files are supported. | Obsługujemy tylko pliki PDF. |
| `error.fileType.both` | Only images (PNG, JPEG, WebP, GIF) and PDF files are supported. | Obsługujemy tylko obrazy (PNG, JPEG, WebP, GIF) i pliki PDF. |
| `error.fileTooLarge` | Files can be up to {size}. | Plik może mieć maksymalnie {size}. |
| `error.pdfPages` | PDFs can have up to {max} pages. | PDF może mieć maksymalnie {max} stron. |
| `error.voiceNotAccepted` | This assistant does not accept voice input. | Ten asystent nie przyjmuje nagrań głosowych. |
| `error.recordingFormat` | This recording format is not supported. | Ten format nagrania nie jest obsługiwany. |
| `error.recordingTooLong` | This recording is too long. | To nagranie jest zbyt długie. |
| `error.dictationBusy` | Another dictation is still being transcribed. Please try again in a moment. | Poprzednie nagranie jest jeszcze przepisywane. Spróbuj za chwilę. |
| `error.dictationBudget` | Dictation is unavailable for the rest of the day. You can still type. | Dyktowanie jest niedostępne do końca dnia. Wiadomość możesz nadal wpisać. |

A dash (—) means the language has no text of its own for that plural category, so the widget shows the `other` text.
<!-- END:generated-texts -->
