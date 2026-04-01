import Anthropic from '@anthropic-ai/sdk';
import type {
  ContentBlockParam,
  MessageParam,
  Message,
  Tool,
  ToolUseBlock,
} from '@anthropic-ai/sdk/resources/messages/messages';

import type { ModelRequest, ModelResponse, ModelStreamEvent, StreamingModelProvider } from '../models/index.js';

export type AnthropicLikeProviderConfig = {
  apiKey: string;
  baseUrl: string;
  model: string;
  maxTokens: number;
};

function getResponseText(response: Anthropic.Message): string {
  return response.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text.trim())
    .filter(Boolean)
    .join('\n\n');
}

function getAnthropicMessages(input: ModelRequest): MessageParam[] {
  const messages: MessageParam[] = [];
  let pendingToolResults: ContentBlockParam[] = [];

  function flushToolResults(): void {
    if (pendingToolResults.length === 0) {
      return;
    }

    messages.push({
      content: pendingToolResults,
      role: 'user',
    });
    pendingToolResults = [];
  }

  for (const message of input.messages) {
    if (message.role === 'tool') {
      const toolResult: ContentBlockParam = {
        content: message.content,
        tool_use_id: message.toolCallId,
        type: 'tool_result',
      };

      if (message.isError) {
        toolResult.is_error = true;
      }

      pendingToolResults.push(toolResult);
      continue;
    }

    flushToolResults();

    if (message.role === 'assistant' && message.toolCalls?.length) {
      const content: ContentBlockParam[] = [];

      if (message.content) {
        content.push({
          text: message.content,
          type: 'text',
        });
      }

      content.push(
        ...message.toolCalls.map(
          (toolCall): ContentBlockParam => ({
            id: toolCall.id,
            input: toolCall.input,
            name: toolCall.name,
            type: 'tool_use',
          }),
        ),
      );

      messages.push({
        content,
        role: 'assistant',
      });
      continue;
    }

    messages.push({
      content: message.content,
      role: message.role,
    });
  }

  flushToolResults();
  return messages;
}

function getAnthropicTools(input: ModelRequest): Tool[] | undefined {
  return input.tools?.map(
    (tool): Tool => ({
      description: tool.description,
      input_schema: tool.inputSchema,
      name: tool.name,
    }),
  );
}

function getAnthropicToolCalls(response: Message): ModelResponse['toolCalls'] {
  return response.content
    .filter((block): block is ToolUseBlock => block.type === 'tool_use')
    .map((block) => ({
      id: block.id,
      input: block.input as Record<string, unknown>,
      name: block.name,
    }));
}

export class AnthropicLikeProvider implements StreamingModelProvider {
  protected readonly client: Anthropic;
  readonly maxTokens: number;
  readonly model: string;
  readonly name: string = 'anthropic-compatible';

  constructor(config: AnthropicLikeProviderConfig) {
    this.client = new Anthropic({
      apiKey: config.apiKey,
      baseURL: config.baseUrl,
    });
    this.maxTokens = config.maxTokens;
    this.model = config.model;
  }

  private getRequest(input: ModelRequest): {
    max_tokens: number;
    messages: MessageParam[];
    model: string;
    system: ModelRequest['systemPrompt'];
    tools: Tool[] | undefined;
  } {
    return {
      max_tokens: this.maxTokens,
      messages: getAnthropicMessages(input),
      model: this.model,
      system: input.systemPrompt,
      tools: getAnthropicTools(input),
    };
  }

  async generate(input: ModelRequest): Promise<ModelResponse> {
    const response = await this.client.messages.create(this.getRequest(input));
    const toolCalls = getAnthropicToolCalls(response);
    const text = getResponseText(response);

    return {
      text,
      toolCalls,
    };
  }

  async *stream(input: ModelRequest): AsyncIterable<ModelStreamEvent> {
    const stream = this.client.messages.stream(this.getRequest(input));

    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        yield {
          delta: event.delta.text,
          type: 'text_delta',
        };
      }
    }

    const response = await stream.finalMessage();

    yield {
      response: {
        text: getResponseText(response),
        toolCalls: getAnthropicToolCalls(response),
      },
      type: 'response_completed',
    };
  }
}
