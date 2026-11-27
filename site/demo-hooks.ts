import type { ChatHandoffReport, ChatLeadReport } from '@boldare/askdare/next';
import { webhookHandoff } from '@boldare/askdare/next';

/*
 * Where the demo's handoffs and leads go. Brightloop has no support team, so nothing reaches a
 * person: with HANDOFF_WEBHOOK_URL and HANDOFF_WEBHOOK_SECRET, each request is posted to that test
 * webhook, signed (the e2e tests run a receiver); without them, the log gets one line. The lines
 * carry the bot, the reason and the form, never contact details or what the visitor wrote.
 */

const webhookUrl = process.env.HANDOFF_WEBHOOK_URL;
const webhookSecret = process.env.HANDOFF_WEBHOOK_SECRET;

const logHandoff = ({ bot, reason, trigger, available }: ChatHandoffReport): void =>
  console.log(
    `[demo] handoff for ${bot}: ${reason} (${trigger}${available ? '' : ', nobody available'})`,
  );

export const onHandoff: (report: ChatHandoffReport) => void | Promise<void> =
  webhookUrl && webhookSecret
    ? webhookHandoff({ url: webhookUrl, secret: webhookSecret })
    : logHandoff;

/** A real site would hand the lead to its CRM here. */
export const onLead = ({ bot, form, source }: ChatLeadReport): void =>
  console.log(`[demo] lead from the ${form} form of ${bot} (${source.kind})`);
