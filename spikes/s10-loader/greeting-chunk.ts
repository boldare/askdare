// The second script of the "lazy" variant: draws the greeting in the loader's shadow root.
import css from './greeting-chunk.css?inline';

interface Env {
  shadow: ShadowRoot;
  launcher: HTMLButtonElement;
  texts: { greeting: string; dismiss: string };
  open: () => void;
  emit: (event: { type: string; bot: string }) => void;
  bot: string;
}

(window as unknown as { askdareGreet: (draw: (env: Env) => HTMLElement) => void }).askdareGreet(
  ({ shadow, launcher, texts, open, emit, bot }) => {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(css);
    shadow.adoptedStyleSheets = [...shadow.adoptedStyleSheets, sheet];
    const greeting = document.createElement('div');
    greeting.setAttribute('part', 'greeting');
    const say = document.createElement('button');
    say.type = 'button';
    say.textContent = texts.greeting;
    say.onclick = () => open();
    const dismiss = document.createElement('button');
    dismiss.type = 'button';
    dismiss.setAttribute('aria-label', texts.dismiss);
    dismiss.textContent = '×';
    dismiss.onclick = () => {
      greeting.remove();
      launcher.focus();
      emit({ type: 'greeting.dismissed', bot });
    };
    greeting.onkeydown = (event) => event.key === 'Escape' && dismiss.click();
    greeting.append(say, dismiss);
    shadow.insertBefore(greeting, launcher);
    emit({ type: 'greeting.shown', bot });
    return greeting;
  },
);
