import type OpenAI from 'openai';
import type {
  EasyInputMessage,
  FunctionTool,
  Response,
  ResponseFunctionToolCall,
  ResponseInputItem,
} from 'openai/resources/responses/responses';

import {
  createEmptyModelUsage,
  type ModelRequest,
  type ModelResponse,
  type ModelUsage,
} from '../../runtime/models/types.js';

export class OpenAICodec {
  getInputItems(input: ModelRequest): ResponseInputItem[] {
    return input.messages.flatMap((message) => {
      if (message.role === 'tool') {
        return [
          {
            call_id: message.toolCallId,
            output: message.content,
            type: 'function_call_output',
          } as ResponseInputItem,
        ];
      }

      const items: ResponseInputItem[] = [];

      if (message.role === 'user' || (message.role === 'assistant' && message.content)) {
        const openAIMessage: EasyInputMessage = {
          content: message.content,
          role: message.role,
          type: 'message',
        };

        items.push(openAIMessage);
      }

      if (message.role === 'assistant' && message.toolCalls?.length) {
        items.push(
          ...message.toolCalls.map(
            (toolCall) =>
              ({
                arguments: JSON.stringify(toolCall.input),
                call_id: toolCall.id,
                name: toolCall.name,
                type: 'function_call',
              }) as ResponseInputItem,
          ),
        );
      }

      return items;
    });
  }

  getResponseText(response: OpenAI.Responses.Response): string {
    const outputText =
      typeof response.output_text === 'string'
        ? response.output_text
        : response.output
            .flatMap((item) => {
              if (item.type !== 'message') {
                return [];
              }

              return item.content.flatMap((content) => (content.type === 'output_text' ? [content.text] : []));
            })
            .join('');

    return outputText.trim();
  }

  getToolCalls(response: Response): ModelResponse['toolCalls'] {
    const toolCalls = response.output.filter((item): item is ResponseFunctionToolCall => item.type === 'function_call');

    if (toolCalls.some((toolCall) => toolCall.status && toolCall.status !== 'completed')) {
      const reason = response.incomplete_details ? JSON.stringify(response.incomplete_details) : 'unknown reason';

      throw new Error(`OpenAI response returned incomplete tool calls: ${reason}`);
    }

    if (response.incomplete_details) {
      throw new Error(`OpenAI response was incomplete: ${JSON.stringify(response.incomplete_details)}`);
    }

    return toolCalls.map((item) => ({
      id: item.call_id,
      input: this.parseToolInput(item.arguments),
      name: item.name,
    }));
  }

  getTools(input: ModelRequest): FunctionTool[] | undefined {
    return input.tools?.map(
      (tool): FunctionTool => ({
        description: tool.description,
        name: tool.name,
        parameters: this.normalizeObjectSchema(tool.inputSchema) as FunctionTool['parameters'],
        strict: true,
        type: 'function',
      }),
    );
  }

  private normalizeObjectSchema(schema: unknown): unknown {
    if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
      return schema;
    }

    const objectSchema = schema as Record<string, unknown>;
    const requiredProperties = new Set(Array.isArray(objectSchema.required) ? objectSchema.required : []);

    const normalizedEntries = Object.entries(objectSchema).map(([key, value]) => {
      if (key === 'properties' && value && typeof value === 'object' && !Array.isArray(value)) {
        return [
          key,
          Object.fromEntries(
            Object.entries(value).map(([propertyName, propertySchema]) => {
              const normalizedPropertySchema = this.normalizeObjectSchema(propertySchema);

              return [
                propertyName,
                requiredProperties.has(propertyName)
                  ? normalizedPropertySchema
                  : this.makeSchemaNullable(normalizedPropertySchema),
              ];
            }),
          ),
        ];
      }

      if (key === 'items') {
        return [key, this.normalizeObjectSchema(value)];
      }

      if ((key === 'anyOf' || key === 'allOf' || key === 'oneOf') && Array.isArray(value)) {
        return [key, value.map((item) => this.normalizeObjectSchema(item))];
      }

      return [key, value];
    });

    const normalizedSchema = Object.fromEntries(normalizedEntries);

    if (normalizedSchema.type === 'object') {
      const properties =
        normalizedSchema.properties &&
        typeof normalizedSchema.properties === 'object' &&
        !Array.isArray(normalizedSchema.properties)
          ? normalizedSchema.properties
          : {};

      return {
        ...normalizedSchema,
        additionalProperties: normalizedSchema.additionalProperties ?? false,
        required: Object.keys(properties),
      };
    }

    return normalizedSchema;
  }

  private makeSchemaNullable(schema: unknown): unknown {
    if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
      return { anyOf: [schema, { type: 'null' }] };
    }

    const objectSchema = schema as Record<string, unknown>;

    if (typeof objectSchema.type === 'string') {
      if (objectSchema.type === 'null') {
        return schema;
      }

      return {
        ...objectSchema,
        type: [objectSchema.type, 'null'],
      };
    }

    if (Array.isArray(objectSchema.type)) {
      if (objectSchema.type.includes('null')) {
        return schema;
      }

      return {
        ...objectSchema,
        type: [...objectSchema.type, 'null'],
      };
    }

    if (Array.isArray(objectSchema.anyOf)) {
      if (
        objectSchema.anyOf.some(
          (entry) => entry && typeof entry === 'object' && !Array.isArray(entry) && entry.type === 'null',
        )
      ) {
        return schema;
      }

      return {
        ...objectSchema,
        anyOf: [...objectSchema.anyOf, { type: 'null' }],
      };
    }

    return {
      anyOf: [schema, { type: 'null' }],
    };
  }

  private parseToolInput(argumentsText: string): Record<string, unknown> {
    let parsed: unknown;

    try {
      parsed = JSON.parse(argumentsText) as unknown;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);

      throw new Error(`OpenAI function call arguments were not valid JSON: ${message}`);
    }

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('OpenAI function call arguments must be a JSON object.');
    }

    return parsed as Record<string, unknown>;
  }

  getUsage(response: Response): ModelUsage {
    const usage = response.usage;
    if (!usage) {
      return createEmptyModelUsage();
    }

    const cachedInputTokens = usage.input_tokens_details?.cached_tokens ?? 0;

    return {
      cacheWriteInputTokens: 0,
      cachedInputTokens,
      outputTokens: usage.output_tokens,
      uncachedInputTokens: usage.input_tokens - cachedInputTokens,
    };
  }
}
