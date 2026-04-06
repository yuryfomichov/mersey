import { useApp } from 'ink';
import { useCallback, useEffect, useRef, useState } from 'react';

import type {
  BeforeToolCallContext,
  Harness,
  HarnessEvent,
  HookDecision,
  Message,
} from '../../../../../harness/index.js';
import { TOOL_APPROVAL_TIMEOUT_MS } from '../constants.js';
import { createHarnessRuntime, type HarnessRuntime } from '../services/harness-runtime.js';
import { type PendingToolApproval, type ToolApprovalResult, type UsageState } from '../types.js';

export interface UseFtvControllerOptions {
  cache: boolean;
  debug: boolean;
  providerName: string;
  sessionId: string;
  sessionStoreDefinition: unknown;
}

export interface FtvControllerState {
  messages: Message[];
  streamingContent: string;
  isThinking: boolean;
  currentTool: string | null;
  turnCount: number;
  input: string;
  pendingApproval: PendingToolApproval | null;
  usage: UsageState;
  ready: boolean;
  providerModel: string | null;
}

export interface FtvControllerActions {
  setInput: (input: string) => void;
  approveTool: () => void;
  denyTool: () => void;
  submitMessage: () => void;
}

export interface UseFtvControllerResult {
  state: FtvControllerState;
  actions: FtvControllerActions;
  exit: () => void;
}

export function useFtvController(options: UseFtvControllerOptions): UseFtvControllerResult {
  const { exit } = useApp();
  const [state, setState] = useState<FtvControllerState>({
    messages: [],
    streamingContent: '',
    isThinking: false,
    currentTool: null,
    turnCount: 0,
    input: '',
    pendingApproval: null,
    usage: {
      cachedInputTokens: 0,
      cacheWriteInputTokens: 0,
      contextSize: 0,
      outputTokens: 0,
      uncachedInputTokens: 0,
    },
    ready: false,
    providerModel: null,
  });

  const harnessRef = useRef<Harness | null>(null);
  const runtimeRef = useRef<HarnessRuntime | null>(null);
  const pendingApprovalResolverRef = useRef<{
    resolve: (result: ToolApprovalResult) => void;
    timeoutId: ReturnType<typeof setTimeout>;
  } | null>(null);

  const resolvePendingApproval = useCallback((result: ToolApprovalResult) => {
    const pending = pendingApprovalResolverRef.current;
    if (!pending) return;

    pendingApprovalResolverRef.current = null;
    clearTimeout(pending.timeoutId);
    setState((s) => ({ ...s, pendingApproval: null }));
    pending.resolve(result);
  }, []);

  const blockAndAskUser = useCallback(
    (ctx: BeforeToolCallContext): Promise<HookDecision> => {
      if (pendingApprovalResolverRef.current) {
        return Promise.resolve({
          continue: false,
          reason: 'Tool call denied while another approval is pending.',
          exposeToModel: true,
        });
      }

      setState((s) => ({ ...s, pendingApproval: { toolName: ctx.toolCall.name } }));

      return new Promise<HookDecision>((resolve) => {
        const timeoutId = setTimeout(() => {
          resolvePendingApproval('timed_out');
        }, TOOL_APPROVAL_TIMEOUT_MS);

        pendingApprovalResolverRef.current = {
          resolve: (result: ToolApprovalResult) => {
            if (result === 'approved') {
              resolve({ continue: true });
              return;
            }
            resolve({
              continue: false,
              reason: result === 'timed_out' ? 'Tool call timed out.' : 'Tool call denied by user.',
              exposeToModel: true,
            });
          },
          timeoutId,
        };
      });
    },
    [resolvePendingApproval],
  );

  useEffect(() => {
    let disposed = false;

    void (async () => {
      try {
        const runtime = await createHarnessRuntime(
          {
            cache: options.cache,
            debug: options.debug,
            providerName: options.providerName as never,
            sessionId: options.sessionId,
            sessionStoreDefinition: options.sessionStoreDefinition as never,
            blockAndAskUser,
          },
          (event: HarnessEvent) => {
            switch (event.type) {
              case 'turn_started':
                setState((s) => ({
                  ...s,
                  isThinking: true,
                  streamingContent: '',
                }));
                break;
              case 'tool_started':
                setState((s) => ({ ...s, currentTool: event.toolName }));
                break;
              case 'tool_finished':
                setState((s) => ({ ...s, currentTool: null }));
                break;
              case 'turn_finished':
                setState((s) => ({
                  ...s,
                  isThinking: false,
                  streamingContent: '',
                  turnCount: s.turnCount + 1,
                }));
                void updateUsage();
                break;
              case 'turn_failed':
                setState((s) => ({
                  ...s,
                  isThinking: false,
                  streamingContent: `Error: ${event.errorMessage}`,
                }));
                void updateUsage();
                break;
            }
          },
        );

        if (disposed) {
          runtime.dispose();
          return;
        }

        harnessRef.current = runtime.harness;

        const updateUsage = async () => {
          const h = runtime.harness;
          const [usageSnapshot, contextSize] = await Promise.all([h.session.getUsage(), h.session.getContextSize()]);
          if (disposed) return;

          setState((s) => ({
            ...s,
            providerModel: runtime.providerModel,
            usage: {
              cachedInputTokens: usageSnapshot.cachedInputTokens,
              cacheWriteInputTokens: usageSnapshot.cacheWriteInputTokens,
              contextSize,
              outputTokens: usageSnapshot.outputTokens,
              uncachedInputTokens: usageSnapshot.uncachedInputTokens,
            },
          }));
        };

        await runtime.harness.session.ensure();
        if (disposed) {
          runtime.dispose();
          return;
        }

        setState((s) => ({
          ...s,
          messages: [...runtime.harness.session.messages],
          providerModel: runtime.providerModel,
        }));

        await updateUsage();
        runtimeRef.current = runtime;
      } catch (error: unknown) {
        if (disposed) return;

        setState((s) => ({
          ...s,
          isThinking: false,
          streamingContent: `Error: ${error instanceof Error ? error.message : String(error)}`,
        }));
      } finally {
        if (!disposed) {
          setState((s) => ({ ...s, ready: true }));
        }
      }
    })();

    return () => {
      disposed = true;
      resolvePendingApproval('denied');
      runtimeRef.current?.dispose();
    };
  }, [
    options.cache,
    options.debug,
    options.providerName,
    options.sessionId,
    options.sessionStoreDefinition,
    blockAndAskUser,
    resolvePendingApproval,
  ]);

  const setInput = useCallback((input: string) => {
    setState((s) => ({ ...s, input }));
  }, []);

  const submitMessage = useCallback(() => {
    const h = harnessRef.current;
    if (!h || state.isThinking || !state.input.trim()) return;

    const msg = state.input;
    setState((s) => ({
      ...s,
      input: '',
      isThinking: true,
      messages: [...s.messages, { role: 'user' as const, content: msg, createdAt: new Date().toISOString() }],
    }));

    (async () => {
      try {
        for await (const chunk of h.streamMessage(msg)) {
          switch (chunk.type) {
            case 'assistant_delta':
              setState((s) => ({
                ...s,
                streamingContent: s.streamingContent + chunk.delta,
              }));
              break;
            case 'final_message':
              setState((s) => ({
                ...s,
                messages: [...s.messages, chunk.message],
                streamingContent: '',
                isThinking: false,
              }));
              break;
          }
        }
      } catch (err) {
        setState((s) => ({
          ...s,
          streamingContent: `Error: ${err instanceof Error ? err.message : String(err)}`,
          isThinking: false,
        }));
      }
    })();
  }, [state.input, state.isThinking]);

  const approveTool = useCallback(() => {
    resolvePendingApproval('approved');
  }, [resolvePendingApproval]);

  const denyTool = useCallback(() => {
    resolvePendingApproval('denied');
  }, [resolvePendingApproval]);

  return {
    state,
    actions: { setInput, approveTool, denyTool, submitMessage },
    exit,
  };
}
