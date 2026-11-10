import { type Context, createContext, type RefObject, useContext } from 'react';

/** What the parts of the default look share; slots read it too. */
export interface Skin {
  /** Level of the chat's title; the welcome's heading is one below. */
  readonly headingLevel: 1 | 2 | 3 | 4 | 5;
  readonly onClose: (() => void) | undefined;
  /** Opens the question before a new conversation deletes the current one. */
  readonly askStartOver: () => void;
  /** The header's restart button, where focus returns when the question closes. */
  readonly restartRef: RefObject<HTMLButtonElement | null>;
}

export const SkinContext: Context<Skin | null> = createContext<Skin | null>(null);

export function useSkin(): Skin {
  const skin = useContext(SkinContext);
  if (!skin) throw new Error('[askdare] The default look only works inside <DefaultChat>.');
  return skin;
}

/** An h1–h6 tag name for a level, capped at 6. */
export const heading = (level: number): 'h1' => `h${Math.min(Math.max(level, 1), 6)}` as 'h1';
