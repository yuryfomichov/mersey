import OpenAI from 'openai';
import type { FunctionTool, ResponseInputItem } from 'openai/resources/responses/responses';

import type { StreamingModelProvider } from '../models/provider.js';
import type { ModelRequest, ModelResponse, ModelStreamEvent } from '../models/types.js';
import { OpenAICodec } from './codecs/openai.js';

export type OpenAILikeProviderConfig = {
  apiKey: string;
  baseUrl: string;
  model: string;
  maxTokens: number;
};

export type OpenAIConfig = OpenAILikeProviderConfig;

export class OpenAILikeProvider implements StreamingModelProvider {
  private readonly codec = new OpenAICodec();
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
      input: this.codec.getInputItems(input),
      instructions: input.systemPrompt,
      max_output_tokens: this.maxTokens,
      model: this.model,
      tools: this.codec.getTools(input),
    };
  }

  async generate(input: ModelRequest): Promise<ModelResponse> {
    const response = await this.client.responses.create(this.getRequest(input), { signal: input.signal });
    const toolCalls = this.codec.getToolCalls(response);
    const text = this.codec.getResponseText(response);

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
        text: this.codec.getResponseText(response),
        toolCalls: this.codec.getToolCalls(response),
      },
      type: 'response_completed',
    };
  }
}

export class OpenAIProvider extends OpenAILikeProvider {
  readonly name = 'openai';
}
