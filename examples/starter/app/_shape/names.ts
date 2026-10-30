/** Names shared by the page (a server component) and the shape, without loading three.js. */
export type ShapeTheme = 'aura' | 'sage' | 'halo' | 'care' | 'bldr';
export type LookName = 'liquid' | 'network';

export const LOOKS: readonly { readonly id: LookName; readonly name: string }[] = [
  { id: 'liquid', name: 'Liquid' },
  { id: 'network', name: 'Network' },
];
