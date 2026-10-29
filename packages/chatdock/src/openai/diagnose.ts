import type OpenAI from 'openai';
import { APIConnectionError, APIError, toFile } from 'openai';
import type { DiagnoseRequest } from '../gateway';
import type { DoctorCheck } from '../protocol/doctor';

/** Doctor requests fail fast instead of retrying: the operator is waiting at a terminal. */
const OPTIONS = { timeout: 20_000, maxRetries: 0 } as const;

interface Failure {
  readonly status: number | undefined;
  readonly code: string | undefined;
}

/** Only the status and code: OpenAI messages may quote part of the key. */
function failureOf(error: unknown): Failure {
  if (error instanceof APIConnectionError) return { status: undefined, code: 'connection' };
  if (error instanceof APIError) {
    return { status: error.status, code: typeof error.code === 'string' ? error.code : undefined };
  }
  return { status: undefined, code: undefined };
}

const KEY_REJECTED: DoctorCheck = {
  status: 'fail',
  title: 'OpenAI rejected OPENAI_API_KEY.',
  fix: "Create a key in the bot's OpenAI project and set OPENAI_API_KEY where the app runs.",
};

/** The common outcomes; `forbidden` names the permission a restricted key needs. */
function failed(what: string, failure: Failure, forbidden: string): DoctorCheck {
  if (failure.status === 401) return KEY_REJECTED;
  if (failure.status === 403) {
    return { status: 'fail', title: `The key may not ${what}.`, fix: forbidden };
  }
  if (failure.code === 'insufficient_quota') {
    return {
      status: 'fail',
      title: 'The OpenAI project is out of credit or reached its spend limit.',
      fix: "Check the project's billing and limits in the OpenAI dashboard.",
    };
  }
  if (failure.code === 'connection') {
    return { status: 'fail', title: `Could not reach the OpenAI API to ${what}.` };
  }
  const detail = [failure.status && `HTTP ${failure.status}`, failure.code].filter(Boolean);
  return { status: 'fail', title: `Could not ${what} (${detail.join(', ') || 'unknown error'}).` };
}

/** One second of silent 16 kHz mono PCM: the smallest honest transcription request. */
function silentWav(): Uint8Array {
  const rate = 16_000;
  const size = rate * 2;
  const view = new DataView(new ArrayBuffer(44 + size));
  const ascii = (offset: number, text: string) => {
    for (let index = 0; index < text.length; index++) {
      view.setUint8(offset + index, text.charCodeAt(index));
    }
  };
  ascii(0, 'RIFF');
  view.setUint32(4, 36 + size, true);
  ascii(8, 'WAVEfmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, 'data');
  view.setUint32(40, size, true);
  return new Uint8Array(view.buffer);
}

async function checkModel(client: OpenAI, model: string, use: string): Promise<DoctorCheck> {
  try {
    await client.models.retrieve(model, OPTIONS);
    return { status: 'ok', title: `Model ${model} is available.` };
  } catch (error) {
    const failure = failureOf(error);
    if (failure.status === 404) {
      return {
        status: 'fail',
        title: `Model ${model} isn't available to this OpenAI project.`,
        fix: `Check ${use} in defineBot, and the project's model allowlist.`,
      };
    }
    if (failure.status === 403) {
      return {
        status: 'warn',
        title: 'The key may not look up models, so the model name was not checked.',
        fix: 'Allow "List models: Read" for the key, or ignore this.',
      };
    }
    return failed(`look up ${model}`, failure, 'Allow "List models: Read" for the key.');
  }
}

/**
 * Live checks for `chatdock doctor`, each the cheapest request that proves a feature works with
 * this key: a 16-token response, a conversation and a file that are deleted straight away, and
 * one second of silence for dictation.
 */
export async function diagnoseBot(
  client: OpenAI,
  request: DiagnoseRequest,
): Promise<readonly DoctorCheck[]> {
  const model = await checkModel(client, request.model, 'model');
  if (model === KEY_REJECTED) return [model];
  const checks: DoctorCheck[] = [model];

  if (model.status !== 'fail') {
    try {
      await client.responses.create(
        { model: request.model, input: 'Reply with OK.', max_output_tokens: 16, store: false },
        OPTIONS,
      );
      checks.push({ status: 'ok', title: `The key can create responses with ${request.model}.` });
    } catch (error) {
      checks.push(
        failed(
          `create responses with ${request.model}`,
          failureOf(error),
          'Allow "Responses API: Write" for the key.',
        ),
      );
    }
  }

  try {
    const conversation = await client.conversations.create(
      { metadata: { chatdock_doctor: 'true' } },
      OPTIONS,
    );
    await client.conversations.delete(conversation.id, OPTIONS);
    checks.push({ status: 'ok', title: 'The key can create and delete conversations.' });
  } catch (error) {
    checks.push(
      failed(
        'create and delete conversations',
        failureOf(error),
        'Give the key write access to conversations; chat history lives there.',
      ),
    );
  }

  if (request.vectorStoreId !== undefined) {
    checks.push(await checkVectorStore(client, request.vectorStoreId));
  }

  if (request.transcriptionModel !== undefined) {
    const voice = await checkModel(client, request.transcriptionModel, 'voice.model');
    checks.push(voice);
    if (voice.status !== 'fail') {
      try {
        await client.audio.transcriptions.create(
          {
            file: await toFile(silentWav(), 'chatdock-doctor.wav', { type: 'audio/wav' }),
            model: request.transcriptionModel,
          },
          OPTIONS,
        );
        checks.push({ status: 'ok', title: 'The key can transcribe speech.' });
      } catch (error) {
        checks.push(
          failed(
            'transcribe speech',
            failureOf(error),
            'Allow "Model capabilities: Request" for the key.',
          ),
        );
      }
    }
  }

  if (request.attachments) {
    try {
      const file = await client.files.create(
        {
          file: await toFile(new TextEncoder().encode('chatdock doctor'), 'chatdock-doctor.txt', {
            type: 'text/plain',
          }),
          purpose: 'user_data',
          expires_after: { anchor: 'created_at', seconds: 3600 },
        },
        OPTIONS,
      );
      await client.files.delete(file.id, OPTIONS);
      checks.push({ status: 'ok', title: "The key can upload visitors' files." });
    } catch (error) {
      checks.push(failed('upload files', failureOf(error), 'Allow "Files: Write" for the key.'));
    }
  }
  return checks;
}

async function checkVectorStore(client: OpenAI, id: string): Promise<DoctorCheck> {
  try {
    const store = await client.vectorStores.retrieve(id, OPTIONS);
    const { completed, failed: broken, in_progress: indexing } = store.file_counts;
    const resync = 'Run `npx @boldare/chatdock kb sync <folder>` with this project’s key.';
    if (store.status === 'expired') {
      return { status: 'fail', title: `Vector store ${id} has expired.`, fix: resync };
    }
    if (completed === 0) {
      return {
        status: 'warn',
        title: `Vector store ${id} has no searchable documents.`,
        fix: resync,
      };
    }
    if (broken > 0 || indexing > 0) {
      return {
        status: 'warn',
        title: `Vector store ${id}: ${completed} documents ready, ${indexing} indexing, ${broken} failed.`,
        fix: broken > 0 ? resync : 'Wait for indexing to finish.',
      };
    }
    return { status: 'ok', title: `Vector store ${id}: ${completed} documents ready.` };
  } catch (error) {
    const failure = failureOf(error);
    if (failure.status === 404) {
      return {
        status: 'fail',
        title: `Vector store ${id} doesn't exist in this OpenAI project.`,
        fix: 'Stores belong to one project: run kb sync with this project’s key and use the ID it prints.',
      };
    }
    return failed(`read vector store ${id}`, failure, 'Allow "Vector Stores: Read" for the key.');
  }
}
