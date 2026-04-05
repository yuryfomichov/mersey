import { z } from 'zod';

import type { ToolInput, ToolInputSchema } from '../types.js';

export function parseToolInput<TSchema extends z.ZodType>(schema: TSchema, input: ToolInput): z.infer<TSchema> {
  const result = schema.safeParse(input);

  if (result.success) {
    return result.data;
  }

  throw new Error(result.error.issues[0]?.message ?? 'Invalid tool input.');
}

export function toToolInputSchema(schema: z.ZodType): ToolInputSchema {
  const jsonSchema = z.toJSONSchema(schema, { io: 'input' });
  const { $schema: _ignored, ...toolInputSchema } = jsonSchema;

  if (toolInputSchema.type !== 'object') {
    throw new Error('Tool input schema must be a JSON Schema object.');
  }

  return toolInputSchema as ToolInputSchema;
}
