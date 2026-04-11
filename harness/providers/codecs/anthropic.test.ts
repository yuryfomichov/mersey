import assert from 'node:assert/strict';
import test from 'node:test';

import Anthropic from '@anthropic-ai/sdk';

import { createEmptyModelUsage } from '../../runtime/models/types.js';
import { AnthropicCodec } from './anthropic.js';

const codec = new AnthropicCodec();

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

test('getMessages replays tool-only assistant responses without fake text', () => {
  const messages = codec.getMessages({
    messages: [
      { content: 'Read note.txt', role: 'user' },
      {
        content: '',
        role: 'assistant',
        toolCalls: [
          {
            id: 'toolu_123',
            input: { path: 'note.txt' },
            name: 'read_file',
          },
        ],
      },
      {
        content: 'hello from file',
        name: 'read_file',
        role: 'tool',
        toolCallId: 'toolu_123',
      },
    ],
    stream: false,
  });

  assert.deepEqual(messages[1], {
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

test('getMessages groups consecutive tool results into one user message', () => {
  const messages = codec.getMessages({
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
    stream: false,
  });

  assert.deepEqual(messages[2], {
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

test('getResponseText leaves empty non-tool replies blank', () => {
  assert.equal(codec.getResponseText(createAnthropicMessage([{ citations: null, text: '   ', type: 'text' }])), '');
});

test('getToolCalls extracts tool calls from tool-only responses', () => {
  assert.deepEqual(
    codec.getToolCalls(
      createAnthropicMessage([
        {
          caller: { type: 'direct' },
          id: 'toolu_123',
          input: { path: 'note.txt' },
          name: 'read_file',
          type: 'tool_use',
        },
      ]),
    ),
    [
      {
        id: 'toolu_123',
        input: { path: 'note.txt' },
        name: 'read_file',
      },
    ],
  );
});

test('getUsage preserves uncached, cached, and cache-write Anthropic input tokens', () => {
  const message = createAnthropicMessage([{ citations: null, text: 'hello', type: 'text' }]);

  message.usage = {
    ...message.usage,
    cache_creation_input_tokens: 7,
    cache_read_input_tokens: 11,
    input_tokens: 13,
    output_tokens: 17,
  };

  assert.deepEqual(codec.getUsage(message), {
    ...createEmptyModelUsage(),
    cacheWriteInputTokens: 7,
    cachedInputTokens: 11,
    outputTokens: 17,
    uncachedInputTokens: 13,
  });
});
