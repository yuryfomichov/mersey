import OpenAI from 'openai';
import type {
  EasyInputMessage,
  FunctionTool,
  Response,
  ResponseFunctionToolCall,
  ResponseInputItem,
} from 'openai/resources/responses/responses';

import type { ModelRequest, ModelResponse, ModelStreamEvent, StreamingModelProvider } from '../models/index.js';

function normalizeOpenAIObjectSchema(schema: unknown): unknown {
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
            normalizeOpenAIObjectSchema(propertySchema),
          ]),
        ),
      ];
    }

    if (key === 'items') {
      return [key, normalizeOpenAIObjectSchema(value)];
    }

    if ((key === 'anyOf' || key === 'allOf' || key === 'oneOf') && Array.isArray(value)) {
      return [key, value.map((item) => normalizeOpenAIObjectSchema(item))];
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

function parseToolInput(argumentsText: string): Record<string, unknown> {
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

function getOpenAIInputItems(input: ModelRequest): ResponseInputItem[] {
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

function getOpenAITools(input: ModelRequest): FunctionTool[] | undefined {
  return input.tools?.map(
    (tool): FunctionTool => ({
      description: tool.description,
      name: tool.name,
      parameters: normalizeOpenAIObjectSchema(tool.inputSchema) as FunctionTool['parameters'],
      strict: true,
      type: 'function',
    }),
  );
}

function getOpenAIToolCalls(response: Response): ModelResponse['toolCalls'] {
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
    input: parseToolInput(item.arguments),
    name: item.name,
  }));
}

function getOpenAIResponseText(response: Response): string {
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

export type OpenAILikeProviderConfig = {
  apiKey: string;
  baseUrl: string;
  model: string;
  maxTokens: number;
};

export type OpenAIConfig = OpenAILikeProviderConfig;

export class OpenAILikeProvider implements StreamingModelProvider {
  protected readonly client: OpenAI;
  readonly maxTokens: number;
  readonly model: string;
  readonly name: string = 'openai-compatible';

  constructor(config: OpenAILikeProviderConfig) {
    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseUrl,
    });
    this.maxTokens = config.maxTokens;
    this.model = config.model;
  }

  private getRequest(input: ModelRequest): {
    input: ResponseInputItem[];
    instructions: ModelRequest['systemPrompt'];
    max_output_tokens: number;
    model: string;
    tools: FunctionTool[] | undefined;
  } {
    return {
      input: getOpenAIInputItems(input),
      instructions: input.systemPrompt,
      max_output_tokens: this.maxTokens,
      model: this.model,
      tools: getOpenAITools(input),
    };
  }

  async generate(input: ModelRequest): Promise<ModelResponse> {
    const response = await this.client.responses.create(this.getRequest(input), { signal: input.signal });
    const toolCalls = getOpenAIToolCalls(response);
    const text = getOpenAIResponseText(response);

    return {
      text,
      toolCalls,
    };
  }

  async *stream(input: ModelRequest): AsyncIterable<ModelStreamEvent> {
    const stream = this.client.responses.stream(this.getRequest(input), { signal: input.signal });

    for await (const event of stream) {
      if (event.type === 'response.output_text.delta') {
        yield {
          delta: event.delta,
          type: 'text_delta',
        };
      }
    }

    const response = await stream.finalResponse();

    yield {
      response: {
        text: getOpenAIResponseText(response),
        toolCalls: getOpenAIToolCalls(response),
      },
      type: 'response_completed',
    };
  }
}

export class OpenAIProvider extends OpenAILikeProvider {
  readonly name = 'openai';
}
