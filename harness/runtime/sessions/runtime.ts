import type { ModelUsage } from '../models/types.js';
import type { Message } from './types.js';

export interface HarnessSession {
  readonly createdAt: string;
  readonly id: string;
  readonly messages: readonly Message[];

  commit(messages: Message[]): Promise<void>;
  ensure(): Promise<void>;
  getContextSize(): Promise<number>;
  getUsage(): Promise<ModelUsage>;
  runExclusive<T>(run: () => Promise<T>): Promise<T>;
}
