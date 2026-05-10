import type { ModelMessage } from '../models/types.js';

export type TurnContextContribution =
  | {
      kind: 'message';
      sourceId: string;
      message: ModelMessage;
      priority?: number;
    }
  | {
      kind: 'resource';
      sourceId: string;
      uri: string;
      mimeType?: string;
      text?: string;
      priority?: number;
    }
  | {
      kind: 'metadata';
      sourceId: string;
      key: string;
      value: unknown;
    };

export type NormalizedTurnContext = {
  messages: readonly {
    sourceId: string;
    message: ModelMessage;
  }[];
  metadata: Readonly<Record<string, { sourceId: string; value: unknown }>>;
  resources: readonly {
    sourceId: string;
    uri: string;
    mimeType?: string;
    text?: string;
  }[];
};
