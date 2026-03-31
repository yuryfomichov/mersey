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
        } as unknown as OpenAI.Responses.Response;
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

test('OpenAILikeProvider passes systemPrompt as instructions to responses.create', async () => {
  const capturedRequests: Array<{ instructions?: string | null }> = [];
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
          create(request: { instructions?: string | null }): Promise<OpenAI.Responses.Response>;
        };
      };
    }
  ).client = {
    responses: {
      async create(request: { instructions?: string | null }): Promise<OpenAI.Responses.Response> {
        capturedRequests.push(request);

        return {
          created_at: 0,
          error: null,
          id: 'resp_789',
          incomplete_details: null,
          instructions: null,
          metadata: null,
          model: 'gpt-test-model',
          object: 'response',
          output: [],
          output_text: 'ok',
          parallel_tool_calls: false,
          temperature: null,
          tool_choice: 'auto',
        } as unknown as OpenAI.Responses.Response;
      },
    },
  };

  await provider.generate({
    messages: [{ content: 'hello', role: 'user' }],
    systemPrompt: 'You are a helpful assistant.',
  });

  assert.equal(capturedRequests.length, 1);
  assert.equal(capturedRequests[0].instructions, 'You are a helpful assistant.');

  await provider.generate({
    messages: [{ content: 'hello', role: 'user' }],
  });

  assert.equal(capturedRequests.length, 2);
  assert.equal(capturedRequests[1].instructions, undefined);
});

test('OpenAILikeProvider falls back when a non-tool reply is only whitespace', async () => {
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
          id: 'resp_456',
          incomplete_details: null,
          instructions: null,
          metadata: null,
          model: 'gpt-test-model',
          object: 'response',
          output: [],
          output_text: '   ',
          parallel_tool_calls: false,
          temperature: null,
          tool_choice: 'auto',
        } as unknown as OpenAI.Responses.Response;
      },
    },
  };

  const response = await provider.generate({
    messages: [{ content: 'hello', role: 'user' }],
  });

  assert.equal(response.text, 'I could not produce a response for that request.');
  assert.deepEqual(response.toolCalls, []);
});
