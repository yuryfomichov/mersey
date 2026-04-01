import assert from 'node:assert/strict';
import test from 'node:test';

import type OpenAI from 'openai';

import type { ModelStreamEvent } from '../../models/types.js';
import { OpenAILikeProvider } from '../openai.js';

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

  assert.equal(response.text, '');
  assert.deepEqual(response.toolCalls, []);
});

test('OpenAILikeProvider rejects incomplete non-tool responses', async () => {
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
          id: 'resp_789',
          incomplete_details: { reason: 'max_output_tokens' },
          instructions: null,
          metadata: null,
          model: 'gpt-test-model',
          object: 'response',
          output: [],
          output_text: 'partial answer',
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
        messages: [{ content: 'hello', role: 'user' }],
      }),
    /OpenAI response was incomplete/,
  );
});

test('OpenAILikeProvider adds additionalProperties false to function schemas', async () => {
  let capturedTools: unknown;
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
          create(request: { tools?: unknown }): Promise<OpenAI.Responses.Response>;
        };
      };
    }
  ).client = {
    responses: {
      async create(request: { tools?: unknown }): Promise<OpenAI.Responses.Response> {
        capturedTools = request.tools;

        return {
          created_at: 0,
          error: null,
          id: 'resp_999',
          incomplete_details: null,
          instructions: null,
          metadata: null,
          model: 'gpt-test-model',
          object: 'response',
          output: [],
          output_text: 'done',
          parallel_tool_calls: false,
          temperature: null,
          tool_choice: 'auto',
        } as unknown as OpenAI.Responses.Response;
      },
    },
  };

  await provider.generate({
    messages: [{ content: 'hello', role: 'user' }],
    tools: [
      {
        description: 'Read a file.',
        inputSchema: {
          properties: {
            options: {
              properties: {
                path: { type: 'string' },
              },
              type: 'object',
            },
          },
          required: ['options'],
          type: 'object',
        },
        name: 'read_file',
      },
    ],
  });

  assert.deepEqual(capturedTools, [
    {
      description: 'Read a file.',
      name: 'read_file',
      parameters: {
        additionalProperties: false,
        properties: {
          options: {
            additionalProperties: false,
            properties: {
              path: { type: 'string' },
            },
            required: ['path'],
            type: 'object',
          },
        },
        required: ['options'],
        type: 'object',
      },
      strict: true,
      type: 'function',
    },
  ]);
});

test('OpenAILikeProvider requires optional function properties for strict schemas', async () => {
  let capturedTools: unknown;
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
          create(request: { tools?: unknown }): Promise<OpenAI.Responses.Response>;
        };
      };
    }
  ).client = {
    responses: {
      async create(request: { tools?: unknown }): Promise<OpenAI.Responses.Response> {
        capturedTools = request.tools;

        return {
          created_at: 0,
          error: null,
          id: 'resp_1000',
          incomplete_details: null,
          instructions: null,
          metadata: null,
          model: 'gpt-test-model',
          object: 'response',
          output: [],
          output_text: 'done',
          parallel_tool_calls: false,
          temperature: null,
          tool_choice: 'auto',
        } as unknown as OpenAI.Responses.Response;
      },
    },
  };

  await provider.generate({
    messages: [{ content: 'hello', role: 'user' }],
    tools: [
      {
        description: 'Write a file.',
        inputSchema: {
          properties: {
            content: { type: 'string' },
            overwrite: { type: 'boolean' },
            path: { type: 'string' },
          },
          required: ['content', 'path'],
          type: 'object',
        },
        name: 'write_file',
      },
    ],
  });

  assert.deepEqual(capturedTools, [
    {
      description: 'Write a file.',
      name: 'write_file',
      parameters: {
        additionalProperties: false,
        properties: {
          content: { type: 'string' },
          overwrite: { type: 'boolean' },
          path: { type: 'string' },
        },
        required: ['content', 'overwrite', 'path'],
        type: 'object',
      },
      strict: true,
      type: 'function',
    },
  ]);
});

test('OpenAILikeProvider streams text deltas and returns the final response', async () => {
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
              id: 'resp_stream_123',
              incomplete_details: null,
              instructions: null,
              metadata: null,
              model: 'gpt-test-model',
              object: 'response',
              output: [],
              output_text: 'hello',
              parallel_tool_calls: false,
              temperature: null,
              tool_choice: 'auto',
            } as unknown as OpenAI.Responses.Response;
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
  })) {
    events.push(event);
  }

  assert.deepEqual(events, [
    { delta: 'hel', type: 'text_delta' },
    { delta: 'lo', type: 'text_delta' },
    { response: { text: 'hello', toolCalls: [] }, type: 'response_completed' },
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

test('OpenAILikeProvider preserves empty-string user messages in request input', async () => {
  let capturedInput: unknown;
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
          create(request: { input?: unknown }): Promise<OpenAI.Responses.Response>;
        };
      };
    }
  ).client = {
    responses: {
      async create(request: { input?: unknown }): Promise<OpenAI.Responses.Response> {
        capturedInput = request.input;

        return {
          created_at: 0,
          error: null,
          id: 'resp_empty_message_123',
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
    messages: [{ content: '', role: 'user' }],
  });

  assert.deepEqual(capturedInput, [
    {
      content: '',
      role: 'user',
      type: 'message',
    },
  ]);
});

test('OpenAILikeProvider skips empty assistant placeholder text while keeping tool calls', async () => {
  let capturedInput: unknown;
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
          create(request: { input?: unknown }): Promise<OpenAI.Responses.Response>;
        };
      };
    }
  ).client = {
    responses: {
      async create(request: { input?: unknown }): Promise<OpenAI.Responses.Response> {
        capturedInput = request.input;

        return {
          created_at: 0,
          error: null,
          id: 'resp_empty_assistant_123',
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
    messages: [
      {
        content: '',
        role: 'assistant',
        toolCalls: [{ id: 'call_1', input: { path: 'note.txt' }, name: 'read_file' }],
      },
    ],
  });

  assert.deepEqual(capturedInput, [
    {
      arguments: '{"path":"note.txt"}',
      call_id: 'call_1',
      name: 'read_file',
      type: 'function_call',
    },
  ]);
});
