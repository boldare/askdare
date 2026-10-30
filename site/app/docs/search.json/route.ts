import { searchIndex } from '../_lib/content';

// Generated at build time from the Markdown, like the pages (ADR-0010).
export const dynamic = 'force-static';

export async function GET(): Promise<Response> {
  return Response.json(await searchIndex());
}
