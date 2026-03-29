import OpenAI from 'openai';
import type {
  EasyInputMessage,
  FunctionTool,
  Response,
  ResponseFunctionToolCall,
  ResponseInputItem,
} from 'openai/resources/responses/responses';

import type { ModelProvider, ModelRequest, ModelResponse } from '../models/index.js';

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

    if (message.content) {
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
      parameters: tool.inputSchema,
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

  if (response.incomplete_details && toolCalls.length > 0) {
    throw new Error(
      `OpenAI response was incomplete before tool calls finished: ${JSON.stringify(response.incomplete_details)}`,
    );
  }

  return toolCalls.map((item) => ({
    id: item.call_id,
    input: parseToolInput(item.arguments),
    name: item.name,
  }));
}

export type OpenAILikeProviderConfig = {
  apiKey: string;
  baseUrl: string;
  model: string;
  maxTokens: number;
};

export type OpenAIConfig = OpenAILikeProviderConfig;

export class OpenAILikeProvider implements ModelProvider {
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

  async generate(input: ModelRequest): Promise<ModelResponse> {
    const response = await this.client.responses.create({
      input: getOpenAIInputItems(input),
      max_output_tokens: this.maxTokens,
      model: this.model,
      tools: getOpenAITools(input),
    });

    return {
      text: response.output_text.trim(),
      toolCalls: getOpenAIToolCalls(response),
    };
  }
}

export class OpenAIProvider extends OpenAILikeProvider {
  readonly name = 'openai';
}
