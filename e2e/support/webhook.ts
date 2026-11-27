import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * The test webhook the site's handoffs go to (e2e/servers/webhook.mjs): HTTPS with a certificate
 * it makes at start, which the site trusts through NODE_EXTRA_CA_CERTS.
 */
export const WEBHOOK_PORT = 4120;
export const WEBHOOK_URL = `https://127.0.0.1:${WEBHOOK_PORT}/handoff`;
/** Plain HTTP, for the health check and for tests to read what arrived. */
export const WEBHOOK_DEBUG = 'http://127.0.0.1:4121';
/** A Standard Webhooks secret for tests only: `whsec_` and 32 bytes in base64. */
export const WEBHOOK_SECRET = `whsec_${Buffer.from('e2e-webhook-secret-of-32-bytes!!').toString('base64')}`;
export const WEBHOOK_CERT_DIR = join(tmpdir(), 'askdare-e2e-webhook');

/** A handoff report as the webhook received it (ADR-0030's `ChatHandoffReport`). */
export interface ReceivedHandoff {
  readonly id: string;
  readonly webhookId: string;
  readonly bot: string;
  readonly trigger: 'model' | 'visitor';
  readonly reason: string;
  readonly available: boolean;
  readonly visitor: string;
  readonly conversationId: string;
  readonly contact?: Readonly<Record<string, string | boolean>>;
  readonly summary?: string;
  readonly transcript?: unknown;
}

export interface WebhookLog {
  readonly handoffs: readonly ReceivedHandoff[];
  readonly refused: number;
  readonly unreachable: number;
}

export async function webhookLog(): Promise<WebhookLog> {
  const response = await fetch(`${WEBHOOK_DEBUG}/debug/handoffs`);
  return (await response.json()) as WebhookLog;
}
