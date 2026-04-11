import assert from 'node:assert/strict';
import test from 'node:test';

import type OpenAI from 'openai';

import { createEmptyModelUsage } from '../runtime/models/types.js';
import { OpenAIProvider } from './openai.js';
import { collectEvents, collectResponse } from './test/provider-test-helpers.js';

function createResponse(overrides: Partial<OpenAI.Responses.Response>): OpenAI.Responses.Response {
  return {
    created_at: 0,
    error: null,
    id: 'resp_123',
    incomplete_details: null,
    instructions: null,
    metadata: null,
    model: 'gpt-test-model',
    object: 'response',
    output: [],
    output_text: '',
    parallel_tool_calls: false,
    temperature: null,
    tool_choice: 'auto',
    usage: {
      input_tokens: 0,
      input_tokens_details: { cached_tokens: 0 },
      output_tokens: 0,
      total_tokens: 0,
    },
    ...overrides,
  } as unknown as OpenAI.Responses.Response;
}

test('OpenAIProvider passes systemPrompt as instructions to responses.create', async () => {
  const capturedRequests: Array<{ instructions?: string | null }> = [];
  const provider = new OpenAIProvider({
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

        return createResponse({ output_text: 'ok' });
      },
    },
  };

  await collectEvents(
    provider.generate({
      messages: [{ content: 'hello', role: 'user' }],
      stream: false,
      systemPrompt: 'You are a helpful assistant.',
    }),
  );

  assert.equal(capturedRequests.length, 1);
  assert.equal(capturedRequests[0].instructions, 'You are a helpful assistant.');

  await collectEvents(
    provider.generate({
      messages: [{ content: 'hello', role: 'user' }],
      stream: false,
    }),
  );

  assert.equal(capturedRequests.length, 2);
  assert.equal(capturedRequests[1].instructions, undefined);
});

test('OpenAIProvider forwards input.signal to create and stream SDK calls', async () => {
  const createSignals: Array<AbortSignal | null | undefined> = [];
  const streamSignals: Array<AbortSignal | null | undefined> = [];
  const provider = new OpenAIProvider({
    apiKey: 'test-key',
    baseUrl: 'https://example.com',
    maxTokens: 256,
    model: 'gpt-test-model',
  });
  const controller = new AbortController();

  (
    provider as unknown as {
      client: {
        responses: {
          create(
            request: Record<string, unknown>,
            options?: { signal?: AbortSignal },
          ): Promise<OpenAI.Responses.Response>;
          stream(
            request: Record<string, unknown>,
            options?: { signal?: AbortSignal },
          ): {
            [Symbol.asyncIterator](): AsyncIterator<{
              delta: string;
              type: 'response.output_text.delta';
            }>;
            finalResponse(): Promise<OpenAI.Responses.Response>;
          };
        };
      };
    }
  ).client = {
    responses: {
      async create(_request: Record<string, unknown>, options?: { signal?: AbortSignal }) {
        createSignals.push(options?.signal);
        return createResponse({ output_text: 'ok' });
      },
      stream(_request: Record<string, unknown>, options?: { signal?: AbortSignal }) {
        streamSignals.push(options?.signal);
        return {
          async finalResponse(): Promise<OpenAI.Responses.Response> {
            return createResponse({ output_text: 'ok' });
          },
          async *[Symbol.asyncIterator](): AsyncIterator<{
            delta: string;
            type: 'response.output_text.delta';
          }> {
            yield { delta: 'ok', type: 'response.output_text.delta' };
          },
        };
      },
    },
  };

  await collectEvents(
    provider.generate({
      messages: [{ content: 'hello', role: 'user' }],
      signal: controller.signal,
      stream: false,
    }),
  );

  await collectEvents(
    provider.generate({
      messages: [{ content: 'hello', role: 'user' }],
      signal: controller.signal,
      stream: true,
    }),
  );

  assert.deepEqual(createSignals, [controller.signal]);
  assert.deepEqual(streamSignals, [controller.signal]);
});

test('OpenAIProvider forwards codec-produced input and tools to responses.create', async () => {
  const capturedRequests: Array<Record<string, unknown>> = [];
  const provider = new OpenAIProvider({
    apiKey: 'test-key',
    baseUrl: 'https://example.com',
    maxTokens: 256,
    model: 'gpt-test-model',
  });

  (
    provider as unknown as {
      client: {
        responses: {
          create(request: Record<string, unknown>): Promise<OpenAI.Responses.Response>;
        };
      };
    }
  ).client = {
    responses: {
      async create(request: Record<string, unknown>): Promise<OpenAI.Responses.Response> {
        capturedRequests.push(request);

        return createResponse({
          output: [
            {
              arguments: '{"command":"pwd"}',
              call_id: 'call_2',
              name: 'run_command',
              status: 'completed',
              type: 'function_call',
            },
          ],
        });
      },
    },
  };

  const response = await collectResponse(
    provider.generate({
      messages: [
        { content: 'where am i?', role: 'user' },
        {
          content: '',
          role: 'assistant',
          toolCalls: [{ id: 'call_1', input: { path: 'note.txt' }, name: 'read_file' }],
        },
        { content: 'hello from file', isError: false, name: 'read_file', role: 'tool', toolCallId: 'call_1' },
      ],
      stream: false,
      tools: [
        {
          description: 'Run a command.',
          inputSchema: {
            properties: {
              command: { type: 'string' },
              cwd: { type: 'string' },
            },
            required: ['command'],
            type: 'object',
          },
          name: 'run_command',
        },
      ],
    }),
  );

  assert.deepEqual(capturedRequests[0]?.input, [
    { content: 'where am i?', role: 'user', type: 'message' },
    {
      arguments: '{"path":"note.txt"}',
      call_id: 'call_1',
      name: 'read_file',
      type: 'function_call',
    },
    {
      call_id: 'call_1',
      output: 'hello from file',
      type: 'function_call_output',
    },
  ]);
  assert.deepEqual(capturedRequests[0]?.tools, [
    {
      description: 'Run a command.',
      name: 'run_command',
      parameters: {
        additionalProperties: false,
        properties: {
          command: { type: 'string' },
          cwd: { type: 'string' },
        },
        required: ['command', 'cwd'],
        type: 'object',
      },
      strict: true,
      type: 'function',
    },
  ]);
  assert.deepEqual(response, {
    text: '',
    toolCalls: [{ id: 'call_2', input: { command: 'pwd' }, name: 'run_command' }],
    usage: createEmptyModelUsage(),
  });
});

test('OpenAIProvider streams text deltas and returns the final response', async () => {
  const capturedRequests: Array<Record<string, unknown>> = [];
  const provider = new OpenAIProvider({
    apiKey: 'test-key',
    baseUrl: 'https://example.com',
    maxTokens: 256,
    model: 'gpt-test-model',
  });

  (
    provider as unknown as {
      client: {
        responses: {
          stream(request: Record<string, unknown>): {
            [Symbol.asyncIterator](): AsyncIterator<{
              delta: string;
              type: 'response.output_text.delta';
            }>;
            finalResponse(): Promise<OpenAI.Responses.Response>;
          };
        };
      };
    }
  ).client = {
    responses: {
      stream(request: Record<string, unknown>) {
        capturedRequests.push(request);

        return {
          async finalResponse(): Promise<OpenAI.Responses.Response> {
            return createResponse({
              output: [
                {
                  arguments: '{"command":"pwd"}',
                  call_id: 'call_1',
                  name: 'run_command',
                  status: 'completed',
                  type: 'function_call',
                },
              ],
              output_text: 'hello',
            });
          },
          async *[Symbol.asyncIterator](): AsyncIterator<{
            delta: string;
            type: 'response.output_text.delta';
          }> {
            yield { delta: 'hel', type: 'response.output_text.delta' };
            yield { delta: 'lo', type: 'response.output_text.delta' };
          },
        };
      },
    },
  };

  const events = await collectEvents(
    provider.generate({
      messages: [{ content: 'hello', role: 'user' }],
      stream: true,
      tools: [
        {
          description: 'Run a command.',
          inputSchema: {
            properties: {
              command: { type: 'string' },
            },
            required: ['command'],
            type: 'object',
          },
          name: 'run_command',
        },
      ],
    }),
  );

  assert.deepEqual(capturedRequests[0]?.tools, [
    {
      description: 'Run a command.',
      name: 'run_command',
      parameters: {
        additionalProperties: false,
        properties: {
          command: { type: 'string' },
        },
        required: ['command'],
        type: 'object',
      },
      strict: true,
      type: 'function',
    },
  ]);

  assert.deepEqual(events, [
    { delta: 'hel', type: 'text_delta' },
    { delta: 'lo', type: 'text_delta' },
    {
      response: {
        text: 'hello',
        toolCalls: [{ id: 'call_1', input: { command: 'pwd' }, name: 'run_command' }],
        usage: createEmptyModelUsage(),
      },
      type: 'response_completed',
    },
  ]);
});

test('OpenAIProvider derives streamed final text from output items when output_text is undefined', async () => {
  const provider = new OpenAIProvider({
    apiKey: 'test-key',
    baseUrl: 'https://example.com',
    maxTokens: 256,
    model: 'gpt-test-model',
  });

  (
    provider as unknown as {
      client: {
        responses: {
          stream(): {
            [Symbol.asyncIterator](): AsyncIterator<{
              delta: string;
              type: 'response.output_text.delta';
            }>;
            finalResponse(): Promise<OpenAI.Responses.Response>;
          };
        };
      };
    }
  ).client = {
    responses: {
      stream() {
        return {
          async finalResponse(): Promise<OpenAI.Responses.Response> {
            return {
              created_at: 0,
              error: null,
              id: 'resp_stream_456',
              incomplete_details: null,
              instructions: null,
              metadata: null,
              model: 'gpt-test-model',
              object: 'response',
              output: [
                {
                  content: [
                    {
                      annotations: [],
                      text: 'hello',
                      type: 'output_text',
                    },
                  ],
                  id: 'msg_123',
                  role: 'assistant',
                  status: 'completed',
                  type: 'message',
                },
              ],
              output_text: undefined,
              parallel_tool_calls: false,
              temperature: null,
              tool_choice: 'auto',
            } as unknown as OpenAI.Responses.Response;
          },
          async *[Symbol.asyncIterator](): AsyncIterator<{
            delta: string;
            type: 'response.output_text.delta';
          }> {
            yield { delta: 'hello', type: 'response.output_text.delta' };
          },
        };
      },
    },
  };

  const events = await collectEvents(
    provider.generate({
      messages: [{ content: 'hello', role: 'user' }],
      stream: true,
    }),
  );

  assert.deepEqual(events, [
    { delta: 'hello', type: 'text_delta' },
    {
      response: { text: 'hello', toolCalls: [], usage: createEmptyModelUsage() },
      type: 'response_completed',
    },
  ]);
});

test('OpenAIProvider requests 24h prompt retention when cache is enabled', async () => {
  const requests: Array<Record<string, unknown>> = [];

  const provider = new OpenAIProvider({
    apiKey: 'test-key',
    baseUrl: 'https://example.com',
    cache: true,
    maxTokens: 256,
    model: 'gpt-5.4-mini',
  });

  (
    provider as unknown as {
      client: { responses: { create(request: Record<string, unknown>): Promise<OpenAI.Responses.Response> } };
    }
  ).client = {
    responses: {
      async create(request: Record<string, unknown>): Promise<OpenAI.Responses.Response> {
        requests.push(request);
        return createResponse({ output_text: 'ok' });
      },
    },
  };

  await collectEvents(
    provider.generate({
      messages: [{ content: 'hello', role: 'user' }],
      stream: false,
    }),
  );

  assert.equal(requests[0]?.prompt_cache_retention, '24h');
});
