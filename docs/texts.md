# Texts

Every text the chat shows has a key, such as `composer.placeholder`. The library ships each text in English, Czech, German, Spanish, French, Italian and Polish, and you can replace any of them per bot. The keys are public API ([ADR-0006](adr/0006-support-matrix-and-versioning.md)), so you can rely on them in your configuration.

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
- **Every language.** An override replaces the text in every language. With `locale: 'auto'`, visitors in every language see your override too. For different texts in each language, use [texts per language](#texts-per-language).
- **Placeholders.** Words in braces, such as `{count}`, `{name}`, `{size}` and `{max}`, are filled in by the widget. Keep the ones the default text has. A placeholder the widget doesn't fill for that key is shown as typed.
- **Bold.** In `welcome.greeting`, `**words**` are shown in bold.

A page can still set its own greeting with `askdare('configure', { greeting })`; see [Styling](styling.md#3-page-javascript).

## Languages

`widget.locale` picks the language:

| Value | Texts |
| --- | --- |
| `'en'` (default) | English |
| A tag of a built-in language (`cs`, `de`, `es`, `fr`, `it`, `pl`), such as `'de'` or `'pl-PL'` | That language |
| Any other BCP 47 tag, such as `'nl'` | English, unless you set `texts` |
| `'auto'` | The language of the page that embeds the chat (its `lang` attribute), else the visitor's browser language, else English |

`defineBot` throws on a value that is neither `'auto'` nor a valid BCP 47 tag. The language part of the tag picks the dictionary, and the full tag picks the plural rules.

With `'auto'`, the launcher on your page follows the same order. Your `instructions` function receives the chosen tag as `context.locale`, so you can tell the model which language to answer in.

### Texts per language

With `locale: 'auto'`, give `widget.texts` one set of overrides per language instead:

```ts
defineBot({
  // …
  widget: {
    locale: 'auto',
    texts: {
      en: { 'launcher.label': 'Questions?', 'welcome.greeting': 'Hi! How can I help?' },
      pl: { 'launcher.label': 'Pytania?', 'welcome.greeting': 'Cześć! W czym pomóc?' },
    },
  },
});
```

- **Which set a visitor gets.** The set for their language tag (`pl-PL`), else one for the same language (`pl`, or another `pl-…` set). A language without a built-in dictionary, such as Dutch, shows English, so it gets the `en` set. A language with a dictionary but no set of yours, such as Polish without `pl`, shows the built-in Polish texts.
- **The launcher on your page** follows the same sets, by language: a Dutch page shows your `nl` launcher texts, the rest in English.
- **Shortcuts.** `title`, `greeting`, `placeholder` and `launcherLabel` still apply in every language, but a set that gives the same key wins for its language.
- **Keys and tags.** The keys are checked as in the flat form. Each language must be a valid BCP 47 tag, once (`pl` and `PL` are the same language), and at most 20 languages are allowed.
- **One form or the other.** `texts` is either one set for every language or one set per language, not both.

### Switching the language on the page

A site that switches its language without a page load, such as a single-page app with a language menu, can switch the chat too:

- **`data-follow-lang`** on the script tag makes the chat follow the page's `<html lang>` whenever it changes.
- **`askdare('configure', { locale: 'pl' })`** switches it from your own code. It wins over `data-follow-lang` until the page's `lang` changes again.

The launcher's texts change at once, and the chat switches in place, without reloading. The visitor keeps their conversation, their unsent message and an answer still streaming, which finishes as usual. Earlier answers stay in the language they were written in; new answers and the interface follow the switch. Your `instructions` function gets the new tag as `context.locale` from the next message on.

If the chat can't load the new texts, or the switch happens before the chat has connected, it reloads in the new language instead and keeps the conversation. An answer still streaming then disappears from view, and the page hears `message.received` with `outcome: 'stopped'` ([Chat events](events.md)); the server still finishes and stores it.

Only a bot with `locale: 'auto'` switches. A bot with a fixed locale keeps its language, and the console says once that it ignored the change. The value is a BCP 47 tag; anything else is ignored with a console warning.

**Follow the page's language.** If your i18n library sets `<html lang>` when the visitor switches, add `data-follow-lang` and you're done:

```html
<script src="https://app.example.com/api/chat/widget.js?bot=support" data-follow-lang async></script>
```

```js
// Your language menu, or your i18n library, changes the attribute:
document.documentElement.lang = 'pl';
// The launcher turns Polish at once, and the chat reloads in Polish.
```

Setting the same language again does nothing.

**Switch from your own code.** Without `data-follow-lang`, or when the page's `lang` doesn't say what the chat should speak, call `configure` from your language menu:

```html
<select id="language" aria-label="Language">
  <option value="en">English</option>
  <option value="pl">Polski</option>
</select>

<script>
  window.askdare = window.askdare || function () {
    (window.askdare.q = window.askdare.q || []).push(arguments);
  };
  document.getElementById('language').addEventListener('change', function (event) {
    askdare('configure', { locale: event.target.value });
  });
</script>
```

A call with only `locale` keeps the greeting, starters and page context of earlier `configure` calls. Next to `data-follow-lang`, your call wins until the page's `lang` changes again.

**In React.** When only the `locale` of its config changes, `Root` switches the same chat to the new texts, and the conversation, the unsent message and an answer under way stay ([React](react.md#good-to-know)). Read the language in a Server Component, for example from a `[lang]` segment:

```tsx
// app/[lang]/help/page.tsx
import { getChatConfig } from '@boldare/askdare/next';
import { DefaultChat, Root } from '@boldare/askdare/react';
import { bots } from '@/askdare.config';

export default async function HelpPage({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params;
  const config = getChatConfig({ bots, bot: 'support', locale: lang });
  return (
    <Root config={config}>
      <DefaultChat className="help-chat" />
    </Root>
  );
}
```

A link from `/en/help` to `/pl/help` renders the chat in Polish with the same conversation. If the page keeps the language in client state instead, read the config for each language you offer on the server, pass them down, and give `Root` the one that matches:

```tsx
'use client';
import { useState } from 'react';
import { type ChatConfig, DefaultChat, Root } from '@boldare/askdare/react';

export function HelpChat({ configs }: { configs: Record<'en' | 'pl', ChatConfig> }) {
  const [lang, setLang] = useState<'en' | 'pl'>('en');
  return (
    <>
      <button type="button" onClick={() => setLang(lang === 'en' ? 'pl' : 'en')}>
        {lang === 'en' ? 'Polski' : 'English'}
      </button>
      <Root config={configs[lang]}>
        <DefaultChat className="help-chat" />
      </Root>
    </>
  );
}
```

```tsx
// In the Server Component that renders it:
<HelpChat
  configs={{
    en: getChatConfig({ bots, bot: 'support', locale: 'en' }),
    pl: getChatConfig({ bots, bot: 'support', locale: 'pl' }),
  }}
/>
```

## Plurals

A text with a number has one key per plural category: `zero`, `one`, `two`, `few`, `many` and `other`, the categories `Intl.PluralRules` uses. `message.attachments` is such a text: after a page reload, the chat shows it under each message that had files.

The widget asks `Intl.PluralRules` which category the number falls into for the visitor's locale and shows the text for it. When the language has no text for that category, the widget shows the `other` text.

Each language uses only some categories:

- **English** uses `one` and `other`. Zero is `other` in English, so `message.attachments.zero` has no effect there.
- **Polish** uses `one`, `few`, `many` and `other` (fractions): 1 załącznik, 3 załączniki, 5 załączników.
- **Czech** uses `one`, `few`, `many` (fractions) and `other`: 1 příloha, 3 přílohy, 5 příloh.
- **French, Spanish and Italian** also have `many`, for very large round numbers. The built-in texts leave it to `other`.

To see the categories of another language, run `new Intl.PluralRules('nl').resolvedOptions().pluralCategories` in a browser console. Override every category the language uses: if you set only `one` and `other` on a Polish bot, `few` and `many` keep their Polish defaults.

## Add a language

The library has dictionaries for English, Czech, German, Spanish, French, Italian and Polish. For another language, translate every key, either for a bot with a fixed `locale`:

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
- With `'auto'`, put the translation in its own set (`texts: { de: { … } }`, see [texts per language](#texts-per-language)). Flat texts would show to every visitor, whatever their language.
- The chat document's `lang` attribute is the visitor's language when a set of yours exists for it, or your fixed `locale` as soon as flat `widget.texts` has any key, so screen readers read your translation in the right language. Without your texts, a language without a built-in dictionary shows English, and `lang` says `en`.

## All texts

The table is generated from the library's dictionaries with `pnpm --filter @boldare/askdare docs:texts`.

<!-- BEGIN:generated-texts -->
<!-- Generated by `pnpm --filter @boldare/askdare docs:texts` from the dictionaries. Do not edit by hand. -->

| Key | English | Czech | German | Spanish | French | Italian | Polish |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `header.title` | Assistant | Asistent | Assistent | Asistente | Assistant | Assistente | Asystent |
| `header.newConversation` | Start a new conversation | Začít novou konverzaci | Neues Gespräch beginnen | Empezar una conversación nueva | Nouvelle conversation | Inizia una nuova conversazione | Zacznij nową rozmowę |
| `header.close` | Close chat | Zavřít chat | Chat schließen | Cerrar el chat | Fermer le chat | Chiudi la chat | Zamknij czat |
| `confirm.newConversation` | Start a new conversation? The current one will be deleted. | Začít novou konverzaci? Současná bude smazána. | Neues Gespräch beginnen? Das aktuelle wird gelöscht. | ¿Empezar una conversación nueva? La actual se eliminará. | Commencer une nouvelle conversation ? La conversation actuelle sera supprimée. | Iniziare una nuova conversazione? Quella attuale verrà eliminata. | Zacząć nową rozmowę? Obecna zostanie usunięta. |
| `confirm.cancel` | Cancel | Zrušit | Abbrechen | Cancelar | Annuler | Annulla | Anuluj |
| `confirm.accept` | Start new | Začít znovu | Neu beginnen | Empezar de nuevo | Recommencer | Ricomincia | Zacznij nową |
| `welcome.label` | Welcome | Vítejte | Willkommen | Bienvenida | Bienvenue | Benvenuto | Powitanie |
| `welcome.greeting` | Hi! How can I help? | Dobrý den! Jak vám mohu pomoci? | Hallo! Wie kann ich helfen? | ¡Hola! ¿En qué puedo ayudarte? | Bonjour ! Comment puis-je vous aider ? | Ciao! Come posso aiutarti? | Cześć! W czym mogę pomóc? |
| `welcome.online` | Online | Online | Online | En línea | En ligne | Online | Online |
| `welcome.suggestions` | Suggested questions | Navrhované otázky | Vorgeschlagene Fragen | Preguntas sugeridas | Questions suggérées | Domande suggerite | Proponowane pytania |
| `composer.placeholder` | Type your message… | Napište zprávu… | Nachricht eingeben… | Escribe tu mensaje… | Écrivez votre message… | Scrivi un messaggio… | Napisz wiadomość… |
| `composer.send` | Send | Odeslat | Senden | Enviar | Envoyer | Invia | Wyślij |
| `composer.attach` | Attach files | Přiložit soubory | Dateien anhängen | Adjuntar archivos | Joindre des fichiers | Allega file | Dołącz pliki |
| `composer.dictate` | Dictate a message | Nadiktovat zprávu | Nachricht diktieren | Dictar un mensaje | Dicter un message | Detta un messaggio | Podyktuj wiadomość |
| `status.loading` | Loading the conversation… | Načítám konverzaci… | Gespräch wird geladen… | Cargando la conversación… | Chargement de la conversation… | Caricamento della conversazione… | Wczytuję rozmowę… |
| `status.thinking` | Thinking… | Přemýšlím… | Denke nach… | Pensando… | Réflexion… | Sto pensando… | Myślę… |
| `status.searching` | Searching documents… | Prohledávám dokumenty… | Durchsuche Dokumente… | Buscando en los documentos… | Recherche dans les documents… | Cerco nei documenti… | Przeszukuję dokumenty… |
| `status.tool` | Using {name}… | Používám {name}… | Verwende {name}… | Usando {name}… | Utilisation de {name}… | Uso {name}… | Korzystam z narzędzia {name}… |
| `status.reconnecting` | Reconnecting… | Znovu se připojuji… | Verbindung wird wiederhergestellt… | Reconectando… | Reconnexion… | Riconnessione in corso… | Łączę ponownie… |
| `status.typing` | The assistant is typing | Asistent píše | Der Assistent schreibt | El asistente está escribiendo | L’assistant écrit | L’assistente sta scrivendo | Asystent pisze |
| `message.sources` | Sources | Zdroje | Quellen | Fuentes | Sources | Fonti | Źródła |
| `message.replies` | Suggested replies | Navrhované odpovědi | Vorgeschlagene Antworten | Respuestas sugeridas | Réponses suggérées | Risposte suggerite | Proponowane odpowiedzi |
| `history.earlier` | Show earlier messages | Zobrazit starší zprávy | Frühere Nachrichten anzeigen | Mostrar mensajes anteriores | Afficher les messages précédents | Mostra i messaggi precedenti | Pokaż wcześniejsze wiadomości |
| `history.loading` | Loading earlier messages… | Načítám starší zprávy… | Frühere Nachrichten werden geladen… | Cargando mensajes anteriores… | Chargement des messages précédents… | Caricamento dei messaggi precedenti… | Wczytuję wcześniejsze wiadomości… |
| `history.loaded` | Earlier messages loaded. | Starší zprávy jsou načtené. | Frühere Nachrichten geladen. | Mensajes anteriores cargados. | Messages précédents chargés. | Messaggi precedenti caricati. | Wczytano wcześniejsze wiadomości. |
| `feedback.label` | Rate this answer | Ohodnoťte tuto odpověď | Diese Antwort bewerten | Valora esta respuesta | Évaluer cette réponse | Valuta questa risposta | Oceń tę odpowiedź |
| `feedback.up` | Helpful | Užitečná | Hilfreich | Útil | Utile | Utile | Pomocna |
| `feedback.down` | Not helpful | Neužitečná | Nicht hilfreich | No es útil | Pas utile | Non utile | Niepomocna |
| `feedback.comment` | What went wrong? | Co bylo špatně? | Was war nicht in Ordnung? | ¿Qué salió mal? | Qu’est-ce qui n’allait pas ? | Cosa non andava? | Co było nie tak? |
| `feedback.send` | Send feedback | Odeslat hodnocení | Feedback senden | Enviar comentario | Envoyer l’avis | Invia feedback | Wyślij opinię |
| `feedback.skip` | Skip | Přeskočit | Überspringen | Omitir | Passer | Salta | Pomiń |
| `message.attachments.zero` | — | — | — | — | — | — | — |
| `message.attachments.one` | {count} attachment | {count} příloha | {count} Anhang | {count} archivo adjunto | {count} pièce jointe | {count} allegato | {count} załącznik |
| `message.attachments.two` | — | — | — | — | — | — | — |
| `message.attachments.few` | — | {count} přílohy | — | — | — | — | {count} załączniki |
| `message.attachments.many` | — | {count} přílohy | — | — | — | — | {count} załączników |
| `message.attachments.other` | {count} attachments | {count} příloh | {count} Anhänge | {count} archivos adjuntos | {count} pièces jointes | {count} allegati | {count} załącznika |
| `attachment.list` | Attachments | Přílohy | Anhänge | Archivos adjuntos | Pièces jointes | Allegati | Załączniki |
| `attachment.uploading` | Uploading… | Nahrávám… | Wird hochgeladen… | Subiendo… | Envoi… | Caricamento… | Wysyłam… |
| `attachment.remove` | Remove {name} | Odebrat {name} | {name} entfernen | Quitar {name} | Retirer {name} | Rimuovi {name} | Usuń {name} |
| `attachment.unsupported` | This file type is not supported. | Tento typ souboru není podporován. | Dieser Dateityp wird nicht unterstützt. | Este tipo de archivo no es compatible. | Ce type de fichier n’est pas pris en charge. | Questo tipo di file non è supportato. | Ten typ pliku nie jest obsługiwany. |
| `attachment.tooLarge` | Too large (max {size}). | Příliš velký (max. {size}). | Zu groß (max. {size}). | Demasiado grande (máx. {size}). | Trop volumineux (max. {size}). | Troppo grande (max {size}). | Za duży (maks. {size}). |
| `attachment.tooMany` | You can attach up to {count} files per message. | K jedné zprávě můžete přiložit nejvýše {count} souborů. | Du kannst bis zu {count} Dateien pro Nachricht anhängen. | Puedes adjuntar hasta {count} archivos por mensaje. | Vous pouvez joindre jusqu’à {count} fichiers par message. | Puoi allegare fino a {count} file per messaggio. | Limit plików w jednej wiadomości: {count}. |
| `dictation.listening` | Listening… | Poslouchám… | Ich höre zu… | Escuchando… | Écoute… | In ascolto… | Słucham… |
| `dictation.transcribing` | Transcribing… | Přepisuji… | Wird transkribiert… | Transcribiendo… | Transcription… | Trascrizione… | Przepisuję… |
| `dictation.cancel` | Cancel dictation | Zrušit diktování | Diktat abbrechen | Cancelar el dictado | Annuler la dictée | Annulla la dettatura | Anuluj dyktowanie |
| `dictation.done` | Done | Hotovo | Fertig | Listo | Terminé | Fatto | Gotowe |
| `dictation.empty` | Nothing was recorded. Please try again. | Nic se nenahrálo. Zkuste to znovu. | Es wurde nichts aufgenommen. Bitte versuche es erneut. | No se grabó nada. Inténtalo de nuevo. | Rien n’a été enregistré. Veuillez réessayer. | Non è stato registrato nulla. Riprova. | Nic się nie nagrało. Spróbuj ponownie. |
| `microphone.blocked` | Microphone access is blocked. Allow it in your browser to dictate. | Přístup k mikrofonu je zablokovaný. Povolte ho v prohlížeči, abyste mohli diktovat. | Der Zugriff auf das Mikrofon ist blockiert. Erlaube ihn im Browser, um zu diktieren. | El acceso al micrófono está bloqueado. Permítelo en tu navegador para dictar. | L’accès au micro est bloqué. Autorisez-le dans votre navigateur pour dicter. | L’accesso al microfono è bloccato. Consentilo nel browser per poter dettare. | Dostęp do mikrofonu jest zablokowany. Zezwól na niego w przeglądarce. |
| `microphone.missing` | No microphone was found. | Nebyl nalezen žádný mikrofon. | Kein Mikrofon gefunden. | No se encontró ningún micrófono. | Aucun micro trouvé. | Nessun microfono trovato. | Nie znaleziono mikrofonu. |
| `microphone.failed` | The microphone could not be started. | Mikrofon se nepodařilo spustit. | Das Mikrofon konnte nicht gestartet werden. | No se pudo iniciar el micrófono. | Le micro n’a pas pu démarrer. | Impossibile avviare il microfono. | Nie udało się włączyć mikrofonu. |
| `disclosure.text` | You’re chatting with an AI assistant. It can make mistakes. | Píšete si s asistentem s umělou inteligencí. Může dělat chyby. | Du chattest mit einem KI-Assistenten. Er kann Fehler machen. | Estás hablando con un asistente de IA. Puede cometer errores. | Vous discutez avec un assistant IA. Il peut faire des erreurs. | Stai chattando con un assistente IA. Può commettere errori. | Rozmawiasz z asystentem AI. Może popełniać błędy. |
| `disclosure.privacy` | Privacy policy | Zásady ochrany osobních údajů | Datenschutzerklärung | Política de privacidad | Politique de confidentialité | Informativa sulla privacy | Polityka prywatności |
| `launcher.label` | Ask us | Zeptejte se nás | Frag uns | Pregúntanos | Une question ? | Chiedi a noi | Zapytaj nas |
| `launcher.open` | Open chat | Otevřít chat | Chat öffnen | Abrir el chat | Ouvrir le chat | Apri la chat | Otwórz czat |
| `launcher.close` | Close chat | Zavřít chat | Chat schließen | Cerrar el chat | Fermer le chat | Chiudi la chat | Zamknij czat |
| `launcher.unavailable` | The chat couldn’t load. Please try again later. | Chat se nepodařilo načíst. Zkuste to prosím později. | Der Chat konnte nicht geladen werden. Bitte versuche es später erneut. | No se pudo cargar el chat. Inténtalo de nuevo más tarde. | Le chat n’a pas pu se charger. Veuillez réessayer plus tard. | Impossibile caricare la chat. Riprova più tardi. | Nie udało się załadować czatu. Spróbuj ponownie później. |
| `humanCheck.label` | Checking that you’re human | Ověřujeme, že jste člověk | Wir prüfen, ob du ein Mensch bist | Comprobando que eres una persona | Vérification que vous êtes humain | Verifichiamo che tu sia una persona | Sprawdzamy, czy jesteś człowiekiem |
| `error.humanCheck` | We couldn’t confirm you’re human. Please try again. | Nepodařilo se ověřit, že jste člověk. Zkuste to prosím znovu. | Wir konnten nicht bestätigen, dass du ein Mensch bist. Bitte versuche es erneut. | No pudimos confirmar que eres una persona. Inténtalo de nuevo. | Nous n’avons pas pu confirmer que vous êtes humain. Veuillez réessayer. | Non è stato possibile verificare che tu sia una persona. Riprova. | Nie udało się potwierdzić, że jesteś człowiekiem. Spróbuj ponownie. |
| `error.connection` | Connection problem. Please try again. | Problém s připojením. Zkuste to znovu. | Verbindungsproblem. Bitte versuche es erneut. | Problema de conexión. Inténtalo de nuevo. | Problème de connexion. Veuillez réessayer. | Problema di connessione. Riprova. | Problem z połączeniem. Spróbuj ponownie. |
| `error.history` | Could not load the previous conversation. | Předchozí konverzaci se nepodařilo načíst. | Das vorherige Gespräch konnte nicht geladen werden. | No se pudo cargar la conversación anterior. | Impossible de charger la conversation précédente. | Impossibile caricare la conversazione precedente. | Nie udało się wczytać poprzedniej rozmowy. |
| `error.earlier` | Could not load earlier messages. | Starší zprávy se nepodařilo načíst. | Frühere Nachrichten konnten nicht geladen werden. | No se pudieron cargar los mensajes anteriores. | Impossible de charger les messages précédents. | Impossibile caricare i messaggi precedenti. | Nie udało się wczytać wcześniejszych wiadomości. |
| `error.updated` | The assistant was updated. Please reload the page. | Asistent byl aktualizován. Načtěte stránku znovu. | Der Assistent wurde aktualisiert. Bitte lade die Seite neu. | El asistente se ha actualizado. Recarga la página. | L’assistant a été mis à jour. Veuillez recharger la page. | L’assistente è stato aggiornato. Ricarica la pagina. | Asystent został zaktualizowany. Odśwież stronę. |
| `error.stalled` | The connection stalled. Please try again. | Připojení se zastavilo. Zkuste to znovu. | Die Verbindung ist ins Stocken geraten. Bitte versuche es erneut. | La conexión se detuvo. Inténtalo de nuevo. | La connexion s’est interrompue. Veuillez réessayer. | La connessione si è interrotta. Riprova. | Połączenie zostało przerwane. Spróbuj ponownie. |
| `error.uploadFailed` | The file could not be uploaded. | Soubor se nepodařilo nahrát. | Die Datei konnte nicht hochgeladen werden. | No se pudo subir el archivo. | Le fichier n’a pas pu être envoyé. | Impossibile caricare il file. | Nie udało się wysłać pliku. |
| `error.transcriptionFailed` | The recording could not be transcribed. | Nahrávku se nepodařilo přepsat. | Die Aufnahme konnte nicht transkribiert werden. | No se pudo transcribir la grabación. | L’enregistrement n’a pas pu être transcrit. | Impossibile trascrivere la registrazione. | Nie udało się przepisać nagrania. |
| `error.invalid_input` | The request was invalid. | Požadavek je neplatný. | Die Anfrage war ungültig. | La solicitud no es válida. | La requête n’est pas valide. | La richiesta non è valida. | Nieprawidłowe żądanie. |
| `error.unauthorized` | Authentication is required. | Je vyžadováno přihlášení. | Eine Anmeldung ist erforderlich. | Es necesario autenticarse. | Une authentification est requise. | È necessaria l’autenticazione. | Wymagane jest uwierzytelnienie. |
| `error.session_expired` | Your session has expired. Please try again. | Platnost relace vypršela. Zkuste to znovu. | Deine Sitzung ist abgelaufen. Bitte versuche es erneut. | Tu sesión ha caducado. Inténtalo de nuevo. | Votre session a expiré. Veuillez réessayer. | La sessione è scaduta. Riprova. | Sesja wygasła. Spróbuj ponownie. |
| `error.not_found` | Not found. | Nenalezeno. | Nicht gefunden. | No encontrado. | Introuvable. | Non trovato. | Nie znaleziono. |
| `error.content_blocked` | This message cannot be processed. | Tuto zprávu nelze zpracovat. | Diese Nachricht kann nicht verarbeitet werden. | Este mensaje no se puede procesar. | Ce message ne peut pas être traité. | Questo messaggio non può essere elaborato. | Nie możemy przetworzyć tej wiadomości. |
| `error.rate_limited` | Too many messages. Please wait a moment. | Příliš mnoho zpráv. Chvíli počkejte. | Zu viele Nachrichten. Bitte warte einen Moment. | Demasiados mensajes. Espera un momento. | Trop de messages. Veuillez patienter un instant. | Troppi messaggi. Attendi un momento. | Zbyt wiele wiadomości. Poczekaj chwilę. |
| `error.budget_exceeded` | The assistant is unavailable for the rest of the day. | Asistent je do konce dne nedostupný. | Der Assistent ist für den Rest des Tages nicht verfügbar. | El asistente no está disponible durante el resto del día. | L’assistant n’est plus disponible pour aujourd’hui. | L’assistente non è disponibile per il resto della giornata. | Asystent jest niedostępny do końca dnia. |
| `error.internal_error` | Something went wrong. Please try again. | Něco se pokazilo. Zkuste to znovu. | Etwas ist schiefgelaufen. Bitte versuche es erneut. | Algo salió mal. Inténtalo de nuevo. | Une erreur s’est produite. Veuillez réessayer. | Qualcosa è andato storto. Riprova. | Coś poszło nie tak. Spróbuj ponownie. |
| `error.upstream_error` | The assistant is temporarily unavailable. Please try again. | Asistent je dočasně nedostupný. Zkuste to znovu. | Der Assistent ist vorübergehend nicht verfügbar. Bitte versuche es erneut. | El asistente no está disponible temporalmente. Inténtalo de nuevo. | L’assistant est momentanément indisponible. Veuillez réessayer. | L’assistente è temporaneamente non disponibile. Riprova. | Asystent jest chwilowo niedostępny. Spróbuj ponownie. |
| `error.bot_unavailable` | The assistant is currently unavailable. | Asistent je momentálně nedostupný. | Der Assistent ist derzeit nicht verfügbar. | El asistente no está disponible en este momento. | L’assistant est actuellement indisponible. | L’assistente al momento non è disponibile. | Asystent jest obecnie niedostępny. |
| `error.timeout` | The assistant took too long to respond. Please try again. | Odpověď trvala příliš dlouho. Zkuste to znovu. | Der Assistent hat zu lange gebraucht. Bitte versuche es erneut. | El asistente tardó demasiado en responder. Inténtalo de nuevo. | L’assistant a mis trop de temps à répondre. Veuillez réessayer. | L’assistente ha impiegato troppo tempo a rispondere. Riprova. | Odpowiedź trwała zbyt długo. Spróbuj ponownie. |
| `error.conversationTooLong` | This conversation is too long. Please start a new one. | Tato konverzace je příliš dlouhá. Začněte novou. | Dieses Gespräch ist zu lang. Bitte beginne ein neues. | Esta conversación es demasiado larga. Empieza una nueva. | Cette conversation est trop longue. Veuillez en commencer une nouvelle. | Questa conversazione è troppo lunga. Iniziane una nuova. | Ta rozmowa jest zbyt długa. Zacznij nową. |
| `error.conversationGone` | This conversation is no longer available. | Tato konverzace už není k dispozici. | Dieses Gespräch ist nicht mehr verfügbar. | Esta conversación ya no está disponible. | Cette conversation n’est plus disponible. | Questa conversazione non è più disponibile. | Ta rozmowa nie jest już dostępna. |
| `error.messageLength` | Messages can be up to {max} characters. | Zpráva může mít nejvýše {max} znaků. | Nachrichten dürfen höchstens {max} Zeichen lang sein. | Los mensajes pueden tener hasta {max} caracteres. | Les messages peuvent contenir jusqu’à {max} caractères. | I messaggi possono contenere fino a {max} caratteri. | Wiadomość może mieć maksymalnie {max} znaków. |
| `error.attachmentExpired` | An attachment expired or is invalid. Please attach it again. | Platnost přílohy vypršela nebo je neplatná. Přiložte ji znovu. | Ein Anhang ist abgelaufen oder ungültig. Bitte hänge ihn erneut an. | Un archivo adjunto caducó o no es válido. Vuelve a adjuntarlo. | Une pièce jointe a expiré ou n’est pas valide. Veuillez la joindre à nouveau. | Un allegato è scaduto o non è valido. Allegalo di nuovo. | Załącznik wygasł lub jest nieprawidłowy. Dołącz go ponownie. |
| `error.filesNotAccepted` | This assistant does not accept files. | Tento asistent nepřijímá soubory. | Dieser Assistent nimmt keine Dateien an. | Este asistente no acepta archivos. | Cet assistant n’accepte pas de fichiers. | Questo assistente non accetta file. | Ten asystent nie przyjmuje plików. |
| `error.tooManyFiles` | Attach up to {count} files per message. | K jedné zprávě přiložte nejvýše {count} souborů. | Hänge bis zu {count} Dateien pro Nachricht an. | Adjunta hasta {count} archivos por mensaje. | Joignez jusqu’à {count} fichiers par message. | Allega fino a {count} file per messaggio. | Limit plików w jednej wiadomości: {count}. |
| `error.fileType.images` | Only images (PNG, JPEG, WebP, GIF) are supported. | Podporovány jsou jen obrázky (PNG, JPEG, WebP, GIF). | Nur Bilder (PNG, JPEG, WebP, GIF) werden unterstützt. | Solo se admiten imágenes (PNG, JPEG, WebP, GIF). | Seules les images (PNG, JPEG, WebP, GIF) sont prises en charge. | Sono supportate solo immagini (PNG, JPEG, WebP, GIF). | Obsługujemy tylko obrazy (PNG, JPEG, WebP, GIF). |
| `error.fileType.pdf` | Only PDF files are supported. | Podporovány jsou jen soubory PDF. | Nur PDF-Dateien werden unterstützt. | Solo se admiten archivos PDF. | Seuls les fichiers PDF sont pris en charge. | Sono supportati solo file PDF. | Obsługujemy tylko pliki PDF. |
| `error.fileType.both` | Only images (PNG, JPEG, WebP, GIF) and PDF files are supported. | Podporovány jsou jen obrázky (PNG, JPEG, WebP, GIF) a soubory PDF. | Nur Bilder (PNG, JPEG, WebP, GIF) und PDF-Dateien werden unterstützt. | Solo se admiten imágenes (PNG, JPEG, WebP, GIF) y archivos PDF. | Seules les images (PNG, JPEG, WebP, GIF) et les fichiers PDF sont pris en charge. | Sono supportati solo immagini (PNG, JPEG, WebP, GIF) e file PDF. | Obsługujemy tylko obrazy (PNG, JPEG, WebP, GIF) i pliki PDF. |
| `error.fileTooLarge` | Files can be up to {size}. | Soubor může mít nejvýše {size}. | Dateien dürfen höchstens {size} groß sein. | Los archivos pueden ocupar hasta {size}. | Les fichiers peuvent faire jusqu’à {size}. | I file possono pesare fino a {size}. | Plik może mieć maksymalnie {size}. |
| `error.pdfPages` | PDFs can have up to {max} pages. | PDF může mít nejvýše {max} stran. | PDFs dürfen höchstens {max} Seiten haben. | Los PDF pueden tener hasta {max} páginas. | Les PDF peuvent compter jusqu’à {max} pages. | I PDF possono avere fino a {max} pagine. | PDF może mieć maksymalnie {max} stron. |
| `error.voiceNotAccepted` | This assistant does not accept voice input. | Tento asistent nepřijímá hlasový vstup. | Dieser Assistent nimmt keine Spracheingabe an. | Este asistente no acepta entrada de voz. | Cet assistant n’accepte pas la saisie vocale. | Questo assistente non accetta input vocali. | Ten asystent nie przyjmuje nagrań głosowych. |
| `error.recordingFormat` | This recording format is not supported. | Tento formát nahrávky není podporován. | Dieses Aufnahmeformat wird nicht unterstützt. | Este formato de grabación no es compatible. | Ce format d’enregistrement n’est pas pris en charge. | Questo formato di registrazione non è supportato. | Ten format nagrania nie jest obsługiwany. |
| `error.recordingTooLong` | This recording is too long. | Tato nahrávka je příliš dlouhá. | Diese Aufnahme ist zu lang. | Esta grabación es demasiado larga. | Cet enregistrement est trop long. | Questa registrazione è troppo lunga. | To nagranie jest zbyt długie. |
| `error.dictationBusy` | Another dictation is still being transcribed. Please try again in a moment. | Jiné diktování se ještě přepisuje. Zkuste to za chvíli. | Ein anderes Diktat wird noch transkribiert. Bitte versuche es gleich noch einmal. | Todavía se está transcribiendo otro dictado. Inténtalo en un momento. | Une autre dictée est en cours de transcription. Réessayez dans un instant. | Un’altra dettatura è ancora in trascrizione. Riprova tra un momento. | Poprzednie nagranie jest jeszcze przepisywane. Spróbuj za chwilę. |
| `error.dictationBudget` | Dictation is unavailable for the rest of the day. You can still type. | Diktování je do konce dne nedostupné. Psát můžete i nadále. | Diktieren ist für den Rest des Tages nicht verfügbar. Du kannst weiterhin tippen. | El dictado no está disponible durante el resto del día. Puedes seguir escribiendo. | La dictée n’est plus disponible pour aujourd’hui. Vous pouvez toujours écrire. | La dettatura non è disponibile per il resto della giornata. Puoi comunque scrivere. | Dyktowanie jest niedostępne do końca dnia. Wiadomość możesz nadal wpisać. |

A dash (—) means the language has no text of its own for that plural category, so the widget shows the `other` text.
<!-- END:generated-texts -->
