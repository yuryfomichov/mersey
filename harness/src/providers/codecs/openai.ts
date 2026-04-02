import type OpenAI from 'openai';
import type {
  EasyInputMessage,
  FunctionTool,
  Response,
  ResponseFunctionToolCall,
  ResponseInputItem,
} from 'openai/resources/responses/responses';

import type { ModelRequest, ModelResponse } from '../../models/types.js';

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

    const normalizedEntries = Object.entries(schema).map(([key, value]) => {
      if (key === 'properties' && value && typeof value === 'object' && !Array.isArray(value)) {
        return [
          key,
          Object.fromEntries(
            Object.entries(value).map(([propertyName, propertySchema]) => [
              propertyName,
              this.normalizeObjectSchema(propertySchema),
            ]),
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
      const propertyNames =
        normalizedSchema.properties &&
        typeof normalizedSchema.properties === 'object' &&
        !Array.isArray(normalizedSchema.properties)
          ? Object.keys(normalizedSchema.properties)
          : [];

      return {
        ...normalizedSchema,
        additionalProperties: normalizedSchema.additionalProperties ?? false,
        required: propertyNames,
      };
    }

    return normalizedSchema;
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
}
