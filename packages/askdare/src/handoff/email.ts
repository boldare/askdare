import type { ChatHandoffReport } from './report';

/** The email `emailHandoff` asks your `send` function to deliver: plain text only. */
export interface HandoffEmail {
  readonly to: string | readonly string[];
  readonly from: string;
  /** The visitor's email, from the handoff form or the signed-in identity, so a reply reaches them. */
  readonly replyTo?: string | undefined;
  /** Fixed text with the bot and the reason; nothing the visitor typed. */
  readonly subject: string;
  readonly text: string;
}

export interface EmailHandoffOptions {
  /** Who gets the requests: your support inbox. */
  readonly to: string | readonly string[];
  /** The sender your mail provider accepts for your domain. */
  readonly from: string;
  /**
   * Sends one email with whatever your app already uses (Resend, Postmark, SES, nodemailer).
   * Throw when it was not sent; the visitor is then told the request failed.
   */
  readonly send: (email: HandoffEmail) => void | Promise<void>;
}

const REASONS: Readonly<Record<ChatHandoffReport['reason'], string>> = {
  visitor_asked: 'the visitor asked for a person',
  cannot_help: 'the bot could not help',
  complaint: 'a complaint',
  sensitive: 'a sensitive topic',
  sales: 'a sales question',
};
/** A plain address with no display name or anything a header could be bent with. */
const EMAIL = /^[^\s<>",;:@()[\]\\]+@[^\s<>",;:@()[\]\\]+$/;

/** Every header value goes through this, as a second guard after the fixed texts. */
const header = (value: string): string => value.replace(/[\r\n\u2028\u2029]+/g, ' ').trim();

function checkAddresses(name: string, value: string | readonly string[]): void {
  const list = typeof value === 'string' ? [value] : value;
  if (list.length === 0 || list.some((address) => header(address) !== address || !address)) {
    throw new TypeError(
      `[askdare] emailHandoff: \`${name}\` must be one or more addresses on a single line.`,
    );
  }
}

function replyTo(report: ChatHandoffReport): string | undefined {
  const candidate = report.contact?.['email'] ?? report.identity?.email;
  return typeof candidate === 'string' && EMAIL.test(candidate) ? candidate : undefined;
}

function body(report: ChatHandoffReport): string {
  const lines = [
    report.available
      ? 'A visitor asked to talk to a person.'
      : 'A visitor left a message while nobody was available.',
    '',
    `Bot: ${report.bot}`,
    `Reason: ${REASONS[report.reason]}`,
    `Requested by: ${report.trigger === 'visitor' ? 'the visitor (button)' : 'the bot'}`,
    `Language: ${report.locale}`,
    `Time: ${new Date(report.createdAt).toISOString()}`,
    `Handoff ID: ${report.id}`,
    `Conversation ID: ${report.conversationId}`,
    `Visitor: ${report.visitor}`,
  ];
  if (report.identity) {
    const { id, name, email } = report.identity;
    lines.push('', 'Signed-in user:', `  ID: ${id}`);
    if (name) lines.push(`  Name: ${name}`);
    if (email) lines.push(`  Email: ${email}`);
  }
  const contact = Object.entries(report.contact ?? {});
  if (contact.length > 0) {
    lines.push('', 'Contact details:');
    for (const [field, value] of contact) {
      lines.push(`  ${field}: ${typeof value === 'boolean' ? (value ? 'yes' : 'no') : value}`);
    }
  }
  if (report.summary) lines.push('', 'Summary from the bot:', report.summary);
  if (report.transcript && report.transcript.length > 0) {
    lines.push('', 'Conversation:');
    for (const message of report.transcript) {
      lines.push('', message.role === 'user' ? 'Visitor:' : 'Bot:', message.text);
    }
  }
  const reply = replyTo(report);
  lines.push(
    '',
    reply
      ? `Reply to this email to answer the visitor at ${reply}.`
      : 'The visitor left no email address.',
  );
  return `${lines.join('\n')}\n`;
}

/**
 * A handoff transport that formats the report as a plain-text email and passes it to your
 * `send` function. The visitor's email becomes `replyTo`, so the person answers them directly.
 * Throws when `send` throws.
 */
export function emailHandoff(
  options: EmailHandoffOptions,
): (report: ChatHandoffReport) => Promise<void> {
  checkAddresses('to', options.to);
  checkAddresses('from', options.from);
  const { to, from, send } = options;
  return async (report) => {
    const reply = replyTo(report);
    await send({
      to,
      from,
      ...(reply === undefined ? {} : { replyTo: header(reply) }),
      subject: header(`Handoff request from ${report.bot}: ${REASONS[report.reason]}`),
      text: body(report),
    });
  };
}
