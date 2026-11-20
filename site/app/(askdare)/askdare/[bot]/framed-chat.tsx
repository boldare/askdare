'use client';

import { type EmbedChatConfig, EmbedRoot } from '@boldare/askdare/embed';
import * as Chat from '@boldare/askdare/react';
import { toolRenderers } from '@/components/tool-cards';

/** The default look with the site's tool cards, in the widget's iframe on any embedding site. */
export function FramedChat({ config }: { readonly config: EmbedChatConfig }) {
  return (
    <EmbedRoot config={config} toolRenderers={toolRenderers}>
      <Chat.DefaultChat className="framed-chat" />
    </EmbedRoot>
  );
}
