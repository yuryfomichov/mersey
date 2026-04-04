import type Anthropic from '@anthropic-ai/sdk';
import type {
  ContentBlockParam,
  Message,
  MessageParam,
  Tool,
  ToolUseBlock,
} from '@anthropic-ai/sdk/resources/messages/messages';

import { createEmptyModelUsage, type ModelRequest, type ModelResponse, type ModelUsage } from '../../models/types.js';

export class AnthropicCodec {
  getMessages(input: ModelRequest): MessageParam[] {
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

  getResponseText(response: Anthropic.Message): string {
    return response.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text.trim())
      .filter(Boolean)
      .join('\n\n');
  }

  getToolCalls(response: Message): ModelResponse['toolCalls'] {
    return response.content
      .filter((block): block is ToolUseBlock => block.type === 'tool_use')
      .map((block) => ({
        id: block.id,
        input: block.input as Record<string, unknown>,
        name: block.name,
      }));
  }

  getTools(input: ModelRequest): Tool[] | undefined {
    return input.tools?.map(
      (tool): Tool => ({
        description: tool.description,
        input_schema: tool.inputSchema,
        name: tool.name,
      }),
    );
  }

  getUsage(response: Message): ModelUsage {
    const usage = response.usage;
    if (!usage) {
      return createEmptyModelUsage();
    }
    return {
      cacheWriteInputTokens: usage.cache_creation_input_tokens ?? 0,
      cachedInputTokens: usage.cache_read_input_tokens ?? 0,
      outputTokens: usage.output_tokens,
      uncachedInputTokens: usage.input_tokens,
    };
  }
}
