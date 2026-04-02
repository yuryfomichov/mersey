import assert from 'node:assert/strict';
import test from 'node:test';

import { z } from 'zod';

import { parseToolInput, toToolInputSchema } from './schema.js';

test('parseToolInput returns parsed object data', () => {
  const schema = z.object({
    path: z.string({ error: 'tool requires a string path.' }).min(1, { error: 'tool requires a string path.' }),
  });

  const result = parseToolInput(schema, { path: 'note.txt' });

  assert.deepEqual(result, { path: 'note.txt' });
});

test('parseToolInput throws the first zod error message', () => {
  const schema = z.object({
    path: z.string({ error: 'tool requires a string path.' }).min(1, { error: 'tool requires a string path.' }),
  });

  assert.throws(() => parseToolInput(schema, {}), /tool requires a string path\./);
});

test('toToolInputSchema converts zod schemas to JSON Schema objects', () => {
  const schema = z.object({
    path: z.string().describe('Path to read.'),
  });

  assert.deepEqual(toToolInputSchema(schema), {
    properties: {
      path: {
        description: 'Path to read.',
        type: 'string',
      },
    },
    required: ['path'],
    type: 'object',
  });
});
