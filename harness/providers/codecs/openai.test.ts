import assert from 'node:assert/strict';
import test from 'node:test';

import type OpenAI from 'openai';

import type { ModelRequest } from '../../runtime/models/types.js';
import { RunCommandTool } from '../../tools/run-command.js';
import { WriteFileTool } from '../../tools/write-file.js';
import { OpenAICodec } from './openai.js';

const codec = new OpenAICodec();

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

test('getToolCalls rejects incomplete function calls', () => {
  const response = createResponse({
    incomplete_details: { reason: 'max_output_tokens' },
    output: [
      {
        arguments: '{"path":"note.txt"',
        call_id: 'call_123',
        name: 'read_file',
        status: 'incomplete',
        type: 'function_call',
      },
    ],
  });

  assert.throws(() => codec.getToolCalls(response), /OpenAI response returned incomplete tool calls/);
});

test('getToolCalls rejects incomplete non-tool responses', () => {
  const response = createResponse({
    incomplete_details: { reason: 'max_output_tokens' },
    output_text: 'partial answer',
  });

  assert.throws(() => codec.getToolCalls(response), /OpenAI response was incomplete/);
});

test('getTools adds strict object requirements to function schemas', () => {
  const request: ModelRequest = {
    messages: [{ content: 'hello', role: 'user' }],
    stream: false,
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
  };

  assert.deepEqual(codec.getTools(request), [
    {
      description: 'Read a file.',
      name: 'read_file',
      parameters: {
        additionalProperties: false,
        properties: {
          options: {
            additionalProperties: false,
            properties: {
              path: { type: ['string', 'null'] },
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

test('getTools converts optional properties into nullable required fields for strict schemas', () => {
  const request: ModelRequest = {
    messages: [{ content: 'hello', role: 'user' }],
    stream: false,
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
  };

  assert.deepEqual(codec.getTools(request), [
    {
      description: 'Write a file.',
      name: 'write_file',
      parameters: {
        additionalProperties: false,
        properties: {
          content: { type: 'string' },
          overwrite: { type: ['boolean', 'null'] },
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

test('getTools normalizes real built-in tool schemas for strict OpenAI responses', () => {
  const request: ModelRequest = {
    messages: [{ content: 'hello', role: 'user' }],
    stream: false,
    tools: [
      new WriteFileTool({ policy: { workspaceRoot: process.cwd() } }),
      new RunCommandTool({ policy: { workspaceRoot: process.cwd() } }),
    ],
  };

  assert.deepEqual(codec.getTools(request), [
    {
      description: 'Write a UTF-8 text file to disk.',
      name: 'write_file',
      parameters: {
        additionalProperties: false,
        properties: {
          content: {
            description: 'UTF-8 text content to write to the file.',
            type: 'string',
          },
          overwrite: {
            description: 'Whether to overwrite an existing file. Defaults to false.',
            type: ['boolean', 'null'],
          },
          path: {
            description: 'Absolute path or a path relative to the workspace root.',
            minLength: 1,
            type: 'string',
          },
        },
        required: ['content', 'overwrite', 'path'],
        type: 'object',
      },
      strict: true,
      type: 'function',
    },
    {
      description:
        'Run one allowed executable directly inside the workspace without a shell. Put the executable in `command` and only trailing arguments in `args`. Example: `{ "command": "pwd" }` or `{ "command": "git", "args": ["status"] }`.',
      name: 'run_command',
      parameters: {
        additionalProperties: false,
        properties: {
          args: {
            description:
              'Arguments after the executable only. Do not repeat command here. Example: for `git status`, use command=`git` and args=`["status"]`. For `pwd`, omit args.',
            items: { type: 'string' },
            type: ['array', 'null'],
          },
          command: {
            description:
              'Executable name only, run directly without a shell. Do not include the command again in args and do not use shell wrappers like `bash -lc`. Example: `pwd` or `git`.',
            minLength: 1,
            type: 'string',
          },
          cwd: {
            description:
              'Optional working directory inside the workspace. Use an absolute path or a path relative to the workspace root.',
            minLength: 1,
            type: ['string', 'null'],
          },
          timeoutMs: {
            description:
              'Optional timeout in milliseconds. Use this only when the command may take longer than the default limit.',
            exclusiveMinimum: 0,
            maximum: 9007199254740991,
            type: ['integer', 'null'],
          },
        },
        required: ['args', 'command', 'cwd', 'timeoutMs'],
        type: 'object',
      },
      strict: true,
      type: 'function',
    },
  ]);
});

test('getInputItems preserves empty-string user messages', () => {
  assert.deepEqual(
    codec.getInputItems({
      messages: [{ content: '', role: 'user' }],
      stream: false,
    }),
    [
      {
        content: '',
        role: 'user',
        type: 'message',
      },
    ],
  );
});

test('getInputItems skips empty assistant placeholder text while keeping tool calls', () => {
  assert.deepEqual(
    codec.getInputItems({
      messages: [
        {
          content: '',
          role: 'assistant',
          toolCalls: [{ id: 'call_1', input: { path: 'note.txt' }, name: 'read_file' }],
        },
      ],
      stream: false,
    }),
    [
      {
        arguments: '{"path":"note.txt"}',
        call_id: 'call_1',
        name: 'read_file',
        type: 'function_call',
      },
    ],
  );
});

test('getResponseText trims whitespace-only replies to empty text', () => {
  assert.equal(codec.getResponseText(createResponse({ output_text: '   ' })), '');
});

test('getResponseText derives text from output items when output_text is undefined', () => {
  const response = createResponse({
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
  });

  assert.equal(codec.getResponseText(response), 'hello');
});
