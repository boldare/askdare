import { getEmbedConfig } from '@boldare/askdare/next';
import { notFound } from 'next/navigation';
import { bots } from '@/askdare.config';
import { FramedChat } from './framed-chat';

type Search = Promise<Record<string, string | string[] | undefined>>;

/**
 * The page a bot's `embedPath` points to (ADR-0018): the chat route sends the widget's iframe here
 * with the visitor's language and the mode. Only bots that chose this page get one.
 */
export default async function OwnPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ bot: string }>;
  readonly searchParams: Search;
}) {
  const { bot } = await params;
  if (!bots.some((item) => item.id === bot && item.embedPath === `/askdare/${bot}`)) notFound();
  const config = getEmbedConfig({ bots, bot, searchParams: await searchParams });
  return <FramedChat config={config} />;
}
