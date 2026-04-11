import assert from 'node:assert/strict';
import test from 'node:test';

import Anthropic from '@anthropic-ai/sdk';

import { createEmptyModelUsage } from '../runtime/models/types.js';
import { AnthropicProvider } from './anthropic.js';
import { collectEvents, collectResponse } from './test/provider-test-helpers.js';

function createAnthropicMessage(content: Anthropic.Message['content']): Anthropic.Message {
  return {
    container: null,
    content,
    id: 'msg_123',
    model: 'claude-test-model' as Anthropic.Message['model'],
    role: 'assistant',
    stop_details: null,
    stop_reason: 'tool_use',
    stop_sequence: null,
    type: 'message',
    usage: {
      cache_creation: null,
      cache_creation_input_tokens: null,
      cache_read_input_tokens: null,
      inference_geo: null,
      input_tokens: 1,
      output_tokens: 1,
      server_tool_use: null,
      service_tier: null,
    },
  };
}

test('AnthropicProvider passes systemPrompt as system parameter', async () => {
  const capturedRequests: Array<{ system?: string }> = [];
  const provider = new AnthropicProvider({
    apiKey: 'test-key',
    baseUrl: 'https://example.com',
    maxTokens: 256,
    model: 'claude-test-model',
  });

  (
    provider as unknown as {
      client: {
        messages: {
          create(request: { system?: string }): Promise<Anthropic.Message>;
        };
      };
    }
  ).client = {
    messages: {
      async create(request: { system?: string }): Promise<Anthropic.Message> {
        capturedRequests.push(request);

        return createAnthropicMessage([{ citations: null, text: 'ok', type: 'text' }]);
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
  assert.equal(capturedRequests[0].system, 'You are a helpful assistant.');

  await collectEvents(
    provider.generate({
      messages: [{ content: 'hello', role: 'user' }],
      stream: false,
    }),
  );

  assert.equal(capturedRequests.length, 2);
  assert.equal(capturedRequests[1].system, undefined);
});

test('AnthropicProvider forwards input.signal to create and stream SDK calls', async () => {
  const createSignals: Array<AbortSignal | null | undefined> = [];
  const streamSignals: Array<AbortSignal | null | undefined> = [];
  const provider = new AnthropicProvider({
    apiKey: 'test-key',
    baseUrl: 'https://example.com',
    maxTokens: 256,
    model: 'claude-test-model',
  });
  const controller = new AbortController();

  (
    provider as unknown as {
      client: {
        messages: {
          create(request: Record<string, unknown>, options?: { signal?: AbortSignal }): Promise<Anthropic.Message>;
          stream(
            request: Record<string, unknown>,
            options?: { signal?: AbortSignal },
          ): {
            [Symbol.asyncIterator](): AsyncIterator<
              | {
                  delta: { text: string; type: 'text_delta' };
                  index: number;
                  type: 'content_block_delta';
                }
              | {
                  type: 'message_stop';
                }
            >;
            finalMessage(): Promise<Anthropic.Message>;
          };
        };
      };
    }
  ).client = {
    messages: {
      async create(_request: Record<string, unknown>, options?: { signal?: AbortSignal }) {
        createSignals.push(options?.signal);
        return createAnthropicMessage([{ citations: null, text: 'ok', type: 'text' }]);
      },
      stream(_request: Record<string, unknown>, options?: { signal?: AbortSignal }) {
        streamSignals.push(options?.signal);
        return {
          async finalMessage(): Promise<Anthropic.Message> {
            return createAnthropicMessage([{ citations: null, text: 'ok', type: 'text' }]);
          },
          async *[Symbol.asyncIterator](): AsyncIterator<
            | {
                delta: { text: string; type: 'text_delta' };
                index: number;
                type: 'content_block_delta';
              }
            | {
                type: 'message_stop';
              }
          > {
            yield {
              delta: { text: 'ok', type: 'text_delta' },
              index: 0,
              type: 'content_block_delta',
            };
            yield { type: 'message_stop' };
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

test('AnthropicProvider forwards codec-produced messages and tools to messages.create', async () => {
  const capturedRequests: Array<Record<string, unknown>> = [];
  const provider = new AnthropicProvider({
    apiKey: 'test-key',
    baseUrl: 'https://example.com',
    maxTokens: 256,
    model: 'claude-test-model',
  });

  (
    provider as unknown as {
      client: {
        messages: {
          create(request: Record<string, unknown>): Promise<Anthropic.Message>;
        };
      };
    }
  ).client = {
    messages: {
      async create(request: Record<string, unknown>): Promise<Anthropic.Message> {
        capturedRequests.push(request);

        return createAnthropicMessage([
          {
            caller: { type: 'direct' },
            id: 'toolu_2',
            input: { command: 'pwd' },
            name: 'run_command',
            type: 'tool_use',
          },
        ]);
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
          toolCalls: [{ id: 'toolu_1', input: { path: 'note.txt' }, name: 'read_file' }],
        },
        { content: 'hello from file', name: 'read_file', role: 'tool', toolCallId: 'toolu_1' },
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

  assert.deepEqual(capturedRequests[0]?.messages, [
    { content: 'where am i?', role: 'user' },
    {
      content: [
        {
          id: 'toolu_1',
          input: { path: 'note.txt' },
          name: 'read_file',
          type: 'tool_use',
        },
      ],
      role: 'assistant',
    },
    {
      content: [
        {
          content: 'hello from file',
          tool_use_id: 'toolu_1',
          type: 'tool_result',
        },
      ],
      role: 'user',
    },
  ]);
  assert.deepEqual(capturedRequests[0]?.tools, [
    {
      description: 'Run a command.',
      input_schema: {
        properties: {
          command: { type: 'string' },
          cwd: { type: 'string' },
        },
        required: ['command'],
        type: 'object',
      },
      name: 'run_command',
    },
  ]);
  assert.deepEqual(response, {
    text: '',
    toolCalls: [{ id: 'toolu_2', input: { command: 'pwd' }, name: 'run_command' }],
    usage: {
      ...createEmptyModelUsage(),
      outputTokens: 1,
      uncachedInputTokens: 1,
    },
  });
});

test('AnthropicProvider streams text deltas and returns the final response', async () => {
  const capturedRequests: Array<Record<string, unknown>> = [];
  const provider = new AnthropicProvider({
    apiKey: 'test-key',
    baseUrl: 'https://example.com',
    maxTokens: 256,
    model: 'claude-test-model',
  });

  (
    provider as unknown as {
      client: {
        messages: {
          stream(request: Record<string, unknown>): {
            [Symbol.asyncIterator](): AsyncIterator<
              | {
                  delta: { text: string; type: 'text_delta' };
                  index: number;
                  type: 'content_block_delta';
                }
              | {
                  type: 'message_stop';
                }
            >;
            finalMessage(): Promise<Anthropic.Message>;
          };
        };
      };
    }
  ).client = {
    messages: {
      stream(request: Record<string, unknown>) {
        capturedRequests.push(request);

        return {
          async finalMessage(): Promise<Anthropic.Message> {
            return createAnthropicMessage([
              { citations: null, text: 'hello', type: 'text' },
              {
                caller: { type: 'direct' },
                id: 'toolu_1',
                input: { command: 'pwd' },
                name: 'run_command',
                type: 'tool_use',
              },
            ]);
          },
          async *[Symbol.asyncIterator](): AsyncIterator<
            | {
                delta: { text: string; type: 'text_delta' };
                index: number;
                type: 'content_block_delta';
              }
            | {
                type: 'message_stop';
              }
          > {
            yield {
              delta: { text: 'hel', type: 'text_delta' },
              index: 0,
              type: 'content_block_delta',
            };
            yield {
              delta: { text: 'lo', type: 'text_delta' },
              index: 0,
              type: 'content_block_delta',
            };
            yield { type: 'message_stop' };
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
      input_schema: {
        properties: {
          command: { type: 'string' },
        },
        required: ['command'],
        type: 'object',
      },
      name: 'run_command',
    },
  ]);

  assert.deepEqual(events, [
    { delta: 'hel', type: 'text_delta' },
    { delta: 'lo', type: 'text_delta' },
    {
      response: {
        text: 'hello',
        toolCalls: [{ id: 'toolu_1', input: { command: 'pwd' }, name: 'run_command' }],
        usage: {
          ...createEmptyModelUsage(),
          outputTokens: 1,
          uncachedInputTokens: 1,
        },
      },
      type: 'response_completed',
    },
  ]);
});
