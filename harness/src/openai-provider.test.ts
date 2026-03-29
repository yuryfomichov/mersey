import assert from 'node:assert/strict';
import test from 'node:test';

import type OpenAI from 'openai';

import { OpenAILikeProvider } from './providers/openai.js';

test('OpenAILikeProvider rejects incomplete function calls', async () => {
  const provider = new OpenAILikeProvider({
    apiKey: 'test-key',
    baseUrl: 'https://example.com',
    maxTokens: 256,
    model: 'gpt-test-model',
  });

  (
    provider as unknown as {
      client: {
        responses: {
          create(): Promise<OpenAI.Responses.Response>;
        };
      };
    }
  ).client = {
    responses: {
      async create(): Promise<OpenAI.Responses.Response> {
        return {
          created_at: 0,
          error: null,
          id: 'resp_123',
          incomplete_details: { reason: 'max_output_tokens' },
          instructions: null,
          metadata: null,
          model: 'gpt-test-model',
          object: 'response',
          output: [
            {
              arguments: '{"path":"note.txt"',
              call_id: 'call_123',
              name: 'read_file',
              status: 'incomplete',
              type: 'function_call',
            },
          ],
          output_text: '',
          parallel_tool_calls: false,
          temperature: null,
          tool_choice: 'auto',
        } as OpenAI.Responses.Response;
      },
    },
  };

  await assert.rejects(
    () =>
      provider.generate({
        messages: [{ content: 'Read note.txt', role: 'user' }],
        tools: [
          {
            description: 'Read a file.',
            inputSchema: {
              properties: {
                path: { type: 'string' },
              },
              required: ['path'],
              type: 'object',
            },
            name: 'read_file',
          },
        ],
      }),
    /OpenAI response returned incomplete tool calls/,
  );
});
