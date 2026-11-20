import {
  Component,
  type ComponentProps,
  type ComponentType,
  createContext,
  type ReactElement,
  type ReactNode,
  useContext,
  useEffect,
} from 'react';
import type { ToolUi } from '../protocol/tool-ui';
import { useMessage } from './context';
import { safeUrl } from './markdown';

/**
 * What a tool's `ui` returns, read from its type (`typeof myTool`) with `import type`, so no server
 * code reaches the page. Structural, so the page needs only the tool's type.
 */
type ToolData<T> = T extends { readonly ui?: ((output: never) => infer Ui) | undefined }
  ? Exclude<Ui, null | undefined>
  : never;

/** Any tool: without a type argument, a component gets `data: unknown` and any name. */
interface AnyTool {
  readonly name: string;
  readonly ui?: ((output: never) => unknown) | undefined;
}

/** What a component registered for a tool gets (ADR-0017). */
export interface ToolRendererProps<T extends { readonly name: string } = AnyTool> {
  /** What the tool's `ui` picked from its result: plain JSON. Render it as text, never as HTML. */
  readonly data: ToolData<T>;
  /** The tool's name. */
  readonly name: T['name'];
  /** The call, stable for the answer. */
  readonly callId: string;
}

/**
 * Components by tool name for `Root`'s `toolRenderers`. Without a type argument, any component per
 * name; with your tools, each component checked against its tool's payload:
 * `{ find_slots: SlotList } satisfies ToolRenderers<[typeof findSlots]>`.
 */
export type ToolRenderers<Tools extends readonly { readonly name: string }[] = never> = [
  Tools,
] extends [never]
  ? Readonly<Record<string, ComponentType<ToolRendererProps<never>>>>
  : { readonly [T in Tools[number] as T['name']]?: ComponentType<ToolRendererProps<T>> };

export type { ToolUi };

const RenderersContext = createContext<ToolRenderers | undefined>(undefined);

/** Provides `Root`'s `toolRenderers` to `ToolResults`. */
export function ToolRenderersProvider({
  renderers,
  children,
}: {
  readonly renderers: ToolRenderers | undefined;
  readonly children?: ReactNode;
}): ReactElement {
  return <RenderersContext.Provider value={renderers}>{children}</RenderersContext.Provider>;
}

/** Tool names already reported as having no component, so the console hears about each once. */
const unregistered = new Set<string>();

/** One card: if the developer's component throws, the card is left out and the chat goes on. */
class Card extends Component<{ readonly name: string; readonly children: ReactNode }> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override componentDidCatch(error: unknown): void {
    console.error(`[askdare] the component for tool "${this.props.name}" failed:`, error);
  }

  override render(): ReactNode {
    return this.state.failed ? null : this.props.children;
  }
}

export type ToolResultsProps = ComponentProps<'div'>;

/**
 * The current message's tool payloads (ADR-0017), each drawn by the component registered for its
 * tool in `Root`'s `toolRenderers`, in call order: a group (`tool-results`) of cards
 * (`tool-result`, with `data-ask-tool`). A payload without a component shows nothing, and when
 * `toolRenderers` is set the console says so once per tool. Use it inside `MessageList`.
 */
export function ToolResults(props: ToolResultsProps): ReactElement | null {
  const { ui } = useMessage();
  const renderers = useContext(RenderersContext);
  const missing: string[] = [];
  const cards = (ui ?? []).flatMap(({ callId, name, data }) => {
    // Own names only: a tool may be called `constructor`.
    const Renderer = renderers && Object.hasOwn(renderers, name) ? renderers[name] : undefined;
    if (!Renderer) {
      if (renderers) missing.push(name);
      return [];
    }
    return [
      <div key={callId} data-ask-part="tool-result" data-ask-tool={name}>
        <Card name={name}>
          <Renderer data={data as never} name={name as never} callId={callId} />
        </Card>
      </div>,
    ];
  });
  const key = missing.join(' ');
  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` stands for the names
  useEffect(() => {
    for (const name of missing) {
      if (unregistered.has(name)) continue;
      unregistered.add(name);
      console.warn(
        `[askdare] no component in toolRenderers for tool "${name}"; its card is hidden.`,
      );
    }
  }, [key]);
  if (cards.length === 0) return null;
  return (
    <div data-ask-part="tool-results" {...props}>
      {cards}
    </div>
  );
}

export type LinkProps = Omit<ComponentProps<'a'>, 'href' | 'target' | 'rel'> & {
  readonly href: string;
};

/**
 * A link for a URL from a tool's payload: only `https:`, `http:` and `mailto:`, opened in a new
 * tab, as links in answers are. Any other URL (`javascript:`, `data:`, a relative path) renders
 * the text alone.
 */
export function Link({ href, children, ...props }: LinkProps): ReactElement {
  const safe = safeUrl(href);
  // The same props on the text, so its styling and accessible name don't depend on the URL.
  if (!safe) return <span {...(props as ComponentProps<'span'>)}>{children}</span>;
  return (
    <a {...props} href={safe} target="_blank" rel="noopener noreferrer nofollow">
      {children}
    </a>
  );
}
