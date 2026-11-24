import { BadRequestError, toFile } from 'openai';
import type { ModelGateway } from '../gateway';
import { deleteFiles, FILE_TTL_SECONDS } from './attachments';
import { createOpenAIClient, type OpenAIClientOptions } from './client';
import { diagnoseBot } from './diagnose';
import { fromOpenAIError } from './errors';
import { moderate } from './guardrails';
import { runTurn } from './turn';

export type OpenAIGatewayOptions = OpenAIClientOptions;

/** The default {@link ModelGateway}: the OpenAI Responses API (ADR-0002). */
export function createOpenAIGateway(options: OpenAIGatewayOptions): ModelGateway {
  const client = createOpenAIClient(options);

  return {
    async uploadFile({ bytes, filename, mime, signal }) {
      try {
        const file = await client.files.create(
          {
            file: await toFile(bytes, filename, { type: mime }),
            purpose: 'user_data',
            expires_after: { anchor: 'created_at', seconds: FILE_TTL_SECONDS },
          },
          signal ? { signal } : undefined,
        );
        return file.id;
      } catch (error) {
        throw fromOpenAIError(error, false);
      }
    },

    deleteFiles: (fileIds) => deleteFiles(client, fileIds),

    async transcribe({ bytes, filename, mime, model, languages, signal }) {
      const create = async (hints: readonly string[]) => {
        const result = await client.audio.transcriptions.create(
          {
            file: await toFile(bytes, filename, { type: mime }),
            model,
            ...(hints.length > 0 ? { languages: [...hints] } : {}),
          },
          signal ? { signal } : undefined,
        );
        return {
          text: result.text,
          seconds: result.usage?.type === 'duration' ? result.usage.seconds : undefined,
        };
      };
      try {
        try {
          return await create(languages);
        } catch (error) {
          // The API refuses language codes it doesn't support; the hint is optional.
          if (!(error instanceof BadRequestError) || languages.length === 0) throw error;
          return await create([]);
        }
      } catch (error) {
        throw fromOpenAIError(error, signal?.aborted ?? false);
      }
    },

    runTurn: (request) => runTurn(client, request),

    diagnose: (request) => diagnoseBot(client, request),

    async moderate(request) {
      try {
        return await moderate(client, request);
      } catch (error) {
        throw fromOpenAIError(error, false);
      }
    },
  };
}
