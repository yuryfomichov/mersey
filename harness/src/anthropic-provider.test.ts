import assert from 'node:assert/strict';
import test from 'node:test';

import Anthropic from '@anthropic-ai/sdk';

import type { ModelRequest } from './models/index.js';
import { AnthropicLikeProvider } from './providers/anthropic.js';

function createAnthropicMessage(content: Anthropic.Message['content']): Anthropic.Message {
  return {
    container: null,
    content,
    id: 'msg_123',
    model: 'claude-test-model' as Anthropic.Message['model'],
    role: 'assistant',
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

test('AnthropicLikeProvider replays tool-only responses without fake text', async () => {
  const anthropicRequests: Array<{ messages: unknown }> = [];
  const provider = new AnthropicLikeProvider({
    apiKey: 'test-key',
    baseUrl: 'https://example.com',
    maxTokens: 256,
    model: 'claude-test-model',
  });

  (
    provider as unknown as {
      client: {
        messages: {
          create(request: { messages: unknown }): Promise<Anthropic.Message>;
        };
      };
    }
  ).client = {
    messages: {
      async create(request: { messages: unknown }): Promise<Anthropic.Message> {
        anthropicRequests.push(request);

        return createAnthropicMessage([
          {
            caller: { type: 'direct' },
            id: 'toolu_123',
            input: { path: 'note.txt' },
            name: 'read_file',
            type: 'tool_use',
          },
        ]);
      },
    },
  };

  const firstRequest: ModelRequest = {
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
  };
  const firstResponse = await provider.generate(firstRequest);

  const secondRequest: ModelRequest = {
    messages: [
      ...firstRequest.messages,
      {
        content: firstResponse.text,
        role: 'assistant',
        toolCalls: firstResponse.toolCalls,
      },
      {
        content: 'hello from file',
        name: 'read_file',
        role: 'tool',
        toolCallId: 'toolu_123',
      },
    ],
    tools: firstRequest.tools,
  };

  await provider.generate(secondRequest);

  assert.equal(firstResponse.text, '');

  const secondAnthropicMessage = anthropicRequests[1]?.messages as Array<{
    content: Array<{ text?: string; type: string }> | string;
    role: string;
  }>;

  assert.deepEqual(secondAnthropicMessage[1], {
    content: [
      {
        id: 'toolu_123',
        input: { path: 'note.txt' },
        name: 'read_file',
        type: 'tool_use',
      },
    ],
    role: 'assistant',
  });
});

test('AnthropicLikeProvider passes systemPrompt as system parameter', async () => {
  const capturedRequests: Array<{ system?: string }> = [];
  const provider = new AnthropicLikeProvider({
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

  await provider.generate({
    messages: [{ content: 'hello', role: 'user' }],
    systemPrompt: 'You are a helpful assistant.',
  });

  assert.equal(capturedRequests.length, 1);
  assert.equal(capturedRequests[0].system, 'You are a helpful assistant.');

  await provider.generate({
    messages: [{ content: 'hello', role: 'user' }],
  });

  assert.equal(capturedRequests.length, 2);
  assert.equal(capturedRequests[1].system, undefined);
});

test('AnthropicLikeProvider groups consecutive tool results into one user message', async () => {
  const anthropicRequests: Array<{ messages: unknown }> = [];
  const provider = new AnthropicLikeProvider({
    apiKey: 'test-key',
    baseUrl: 'https://example.com',
    maxTokens: 256,
    model: 'claude-test-model',
  });

  (
    provider as unknown as {
      client: {
        messages: {
          create(request: { messages: unknown }): Promise<Anthropic.Message>;
        };
      };
    }
  ).client = {
    messages: {
      async create(request: { messages: unknown }): Promise<Anthropic.Message> {
        anthropicRequests.push(request);

        return createAnthropicMessage([{ citations: null, text: 'done', type: 'text' }]);
      },
    },
  };

  await provider.generate({
    messages: [
      { content: 'Read two files', role: 'user' },
      {
        content: '',
        role: 'assistant',
        toolCalls: [
          {
            id: 'toolu_1',
            input: { path: 'a.txt' },
            name: 'read_file',
          },
          {
            id: 'toolu_2',
            input: { path: 'b.txt' },
            name: 'read_file',
          },
        ],
      },
      {
        content: 'A',
        name: 'read_file',
        role: 'tool',
        toolCallId: 'toolu_1',
      },
      {
        content: 'B',
        name: 'read_file',
        role: 'tool',
        toolCallId: 'toolu_2',
      },
    ],
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
  });

  const anthropicMessages = anthropicRequests[0]?.messages as Array<{
    content: Array<{ content?: string; tool_use_id?: string; type: string }> | string;
    role: string;
  }>;

  assert.deepEqual(anthropicMessages[2], {
    content: [
      {
        content: 'A',
        tool_use_id: 'toolu_1',
        type: 'tool_result',
      },
      {
        content: 'B',
        tool_use_id: 'toolu_2',
        type: 'tool_result',
      },
    ],
    role: 'user',
  });
});
