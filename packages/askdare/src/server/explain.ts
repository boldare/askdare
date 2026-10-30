import { type AskdareError, scrub } from '../errors';

/** Where the troubleshooting guide sits in an installed package: always the matching version. */
export const TROUBLESHOOTING = 'node_modules/@boldare/askdare/docs/troubleshooting.md';

const fieldsOf = (cause: unknown): { message: string; status?: unknown; code?: unknown } => {
  if (cause instanceof Error) {
    const { status, code } = cause as Error & { status?: unknown; code?: unknown };
    return { message: cause.message, status, code };
  }
  return { message: typeof cause === 'string' ? cause : '' };
};

/**
 * What went wrong with the setup, in words for the developer: a missing or weak secret, a key
 * OpenAI rejects, a model the project can't use. Undefined for everything else, whose generic
 * message is all anyone needs. Never contains a secret.
 */
export function explain(error: AskdareError): string | undefined {
  if (error.code !== 'bot_unavailable') return undefined;
  const { message, status, code } = fieldsOf(error.cause);
  const plain = scrub(message.replace(/^\[askdare\] /, ''));
  if (/is not configured/.test(plain)) {
    return `${plain.replace(' is not configured.', '')} is not set. Add it to .env.local (or your host's environment) and restart the app.`;
  }
  if (status === 401 || status === 403) {
    return `OpenAI rejected the API key (${String(status)}). Check OPENAI_API_KEY and the key's project permissions.`;
  }
  if (code === 'model_not_found') {
    return `The bot's model doesn't exist or this OpenAI project can't use it: ${plain}`;
  }
  return plain || undefined;
}
