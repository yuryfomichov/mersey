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
