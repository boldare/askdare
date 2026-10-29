import type OpenAI from 'openai';
import { NotFoundError } from 'openai';

/** Longest expiry OpenAI allows; attachments outlive no conversation by more than this. */
export const FILE_TTL_SECONDS: number = 30 * 24 * 60 * 60;
/** Items scanned for attachments before deleting a conversation (conversations are capped by maxTurns). */
const MAX_ITEMS = 1_000;

/** IDs of the files the visitor attached in a conversation. */
export async function attachedFileIds(client: OpenAI, conversationId: string): Promise<string[]> {
  const ids = new Set<string>();
  let scanned = 0;
  for await (const item of client.conversations.items.list(conversationId, { limit: 100 })) {
    scanned += 1;
    if (scanned > MAX_ITEMS) break;
    if (item.type !== 'message' || item.role !== 'user') continue;
    for (const part of item.content) {
      if ((part.type === 'input_image' || part.type === 'input_file') && part.file_id) {
        ids.add(part.file_id);
      }
    }
  }
  return [...ids];
}

/** Best effort: a file that fails to delete still expires on its own. */
export async function deleteFiles(client: OpenAI, fileIds: readonly string[]): Promise<void> {
  for (let index = 0; index < fileIds.length; index += 5) {
    await Promise.all(
      fileIds.slice(index, index + 5).map(async (fileId) => {
        try {
          await client.files.delete(fileId);
        } catch (error) {
          if (!(error instanceof NotFoundError)) {
            console.error('[chatdock] could not delete an attachment file:', fileId);
          }
        }
      }),
    );
  }
}
