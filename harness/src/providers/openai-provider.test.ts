import assert from 'node:assert/strict';
import test from 'node:test';

import type OpenAI from 'openai';

import type { ModelStreamEvent } from '../models/types.js';
import { OpenAILikeProvider } from './openai.js';

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
    ...overrides,
  } as unknown as OpenAI.Responses.Response;
}

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

test('OpenAILikeProvider forwards input.signal to create and stream SDK calls', async () => {
  const createSignals: Array<AbortSignal | null | undefined> = [];
  const streamSignals: Array<AbortSignal | null | undefined> = [];
  const provider = new OpenAILikeProvider({
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

  await provider.generate({
    messages: [{ content: 'hello', role: 'user' }],
    signal: controller.signal,
  });

  for await (const _event of provider.stream({
    messages: [{ content: 'hello', role: 'user' }],
    signal: controller.signal,
  })) {
    // consume stream
  }

  assert.deepEqual(createSignals, [controller.signal]);
  assert.deepEqual(streamSignals, [controller.signal]);
});

test('OpenAILikeProvider forwards codec-produced input and tools to responses.create', async () => {
  const capturedRequests: Array<Record<string, unknown>> = [];
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

  const response = await provider.generate({
    messages: [
      { content: 'where am i?', role: 'user' },
      {
        content: '',
        role: 'assistant',
        toolCalls: [{ id: 'call_1', input: { path: 'note.txt' }, name: 'read_file' }],
      },
      { content: 'hello from file', isError: false, name: 'read_file', role: 'tool', toolCallId: 'call_1' },
    ],
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
  });

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
        required: ['command'],
        type: 'object',
      },
      strict: true,
      type: 'function',
    },
  ]);
  assert.deepEqual(response, {
    text: '',
    toolCalls: [{ id: 'call_2', input: { command: 'pwd' }, name: 'run_command' }],
  });
});

test('OpenAILikeProvider streams text deltas and returns the final response', async () => {
  const capturedRequests: Array<Record<string, unknown>> = [];
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

  const events: ModelStreamEvent[] = [];

  for await (const event of provider.stream({
    messages: [{ content: 'hello', role: 'user' }],
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
  })) {
    events.push(event);
  }

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
      },
      type: 'response_completed',
    },
  ]);
});

test('OpenAILikeProvider derives streamed final text from output items when output_text is undefined', async () => {
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

  const events: ModelStreamEvent[] = [];

  for await (const event of provider.stream({
    messages: [{ content: 'hello', role: 'user' }],
  })) {
    events.push(event);
  }

  assert.deepEqual(events, [
    { delta: 'hello', type: 'text_delta' },
    { response: { text: 'hello', toolCalls: [] }, type: 'response_completed' },
  ]);
});
