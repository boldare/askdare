import type { ReactElement } from 'react';
import { useSkin } from './context';
import { SparkIcon } from './icons';

const initials = (title: string): string =>
  title
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? '')
    .join('') || 'AI';

/** The assistant's face: the configured picture, else the preset's orb, icon or initials. */
export function Avatar({ size }: { readonly size: 'small' | 'large' }): ReactElement | null {
  const { bot } = useSkin();
  const variant = bot.avatar ? 'image' : bot.variants.avatar;
  if (variant === 'none') return null;
  return (
    <span data-ask-part="avatar" data-kind={variant} data-size={size} aria-hidden="true">
      {variant === 'image' && <img src={bot.avatar} alt="" />}
      {variant === 'orb' && <span data-ask-part="orb" />}
      {variant === 'icon' && <SparkIcon size={size === 'large' ? 28 : 16} />}
      {variant === 'initials' && initials(bot.title)}
    </span>
  );
}
