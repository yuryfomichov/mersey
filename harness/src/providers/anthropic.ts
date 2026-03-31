import Anthropic from '@anthropic-ai/sdk';
import type {
  ContentBlockParam,
  MessageParam,
  Tool,
  ToolUseBlock,
} from '@anthropic-ai/sdk/resources/messages/messages';

import type { ModelProvider, ModelRequest, ModelResponse } from '../models/index.js';

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

export class AnthropicLikeProvider implements ModelProvider {
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

  async generate(input: ModelRequest): Promise<ModelResponse> {
    const response = await this.client.messages.create({
      max_tokens: this.maxTokens,
      messages: getAnthropicMessages(input),
      model: this.model,
      tools: getAnthropicTools(input),
    });
    const toolCalls = response.content
      .filter((block): block is ToolUseBlock => block.type === 'tool_use')
      .map((block) => ({
        id: block.id,
        input: block.input as Record<string, unknown>,
        name: block.name,
      }));
    const text = getResponseText(response);

    return {
      text: text || (toolCalls.length > 0 ? '' : 'I could not produce a response for that request.'),
      toolCalls,
    };
  }
}
