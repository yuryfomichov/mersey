import { randomUUID } from 'node:crypto';

import type { HarnessEvent, HarnessEventListener } from './events/index.js';
import { emitRuntimeTrace, type HarnessLogger } from './logger/index.js';
import { createLoopObserver } from './loop-observer.js';
import { runLoop, streamLoop, type TurnChunk } from './loop.js';
import type { ModelToolCall, ModelToolInput, ModelProvider } from './models/index.js';
import { createProvider, type ProviderDefinition } from './providers/index.js';
import {
  MemorySessionStore,
  applySessionStatePatch,
  getTurnStatus,
  type Message,
  type PendingApprovalState,
  type Session,
  type SessionStatePatch,
  type SessionStore,
} from './sessions/index.js';
import { createToolContext, executeToolCall, getToolDefinitions, getToolMap } from './tools/index.js';
import type { Tool, ToolPolicy } from './tools/index.js';
import { findToolCall, findToolMessage, getCurrentTurnProgress } from './turn-state.js';

type AsyncQueue<T> = {
  end(): void;
  fail(error: unknown): void;
  iterable: AsyncIterable<T> & AsyncIterator<T>;
  push(value: T): void;
};

export type PendingApproval = {
  input: ModelToolInput;
  toolCallId: string;
  toolName: string;
  turnId: string;
};

export type TurnResult =
  | {
      message: Message;
      status: 'completed';
    }
  | {
      approval: PendingApproval;
      status: 'awaiting_approval';
    };

type ApprovedToolResult = Extract<PendingApprovalState, { stage: 'approved_executed' }>['toolResult'];
type DeniedToolResult = Extract<PendingApprovalState, { stage: 'denied_executed' }>['toolResult'];
type ResolvedApprovalState = Extract<PendingApprovalState, { stage: 'approved_executed' | 'denied_executed' }>;

export type Harness = {
  approvePendingTool(): Promise<TurnResult>;
  denyPendingTool(reason?: string): Promise<TurnResult>;
  getPendingApproval(): Promise<PendingApproval | null>;
  resumePendingTurn(): Promise<TurnResult | null>;
  session: Session;
  sendUserMessage(content: string): Promise<TurnResult>;
  streamUserMessage(content: string): AsyncIterable<TurnChunk>;
  subscribe(listener: HarnessEventListener): () => void;
};

export type CreateHarnessOptions = {
  debug?: boolean;
  loggers?: HarnessLogger[];
  providerInstance?: ModelProvider;
  provider?: ProviderDefinition;
  sessionStore?: SessionStore;
  sessionId?: string;
  stream?: boolean;
  systemPrompt?: string;
  toolPolicy?: ToolPolicy;
  tools?: Tool[];
};

function createAsyncQueue<T>(): AsyncQueue<T> {
  const values: IteratorResult<T>[] = [];
  const waiters: Array<{
    reject(error: unknown): void;
    resolve(result: IteratorResult<T>): void;
  }> = [];
  let done = false;
  let failure: unknown;
  let hasFailure = false;

  const close = (result: IteratorResult<T>): void => {
    const pendingWaiters = waiters.splice(0, waiters.length);

    for (const waiter of pendingWaiters) {
      waiter.resolve(result);
    }
  };

  return {
    end(): void {
      if (done || hasFailure) {
        return;
      }

      done = true;
      close({ done: true, value: undefined });
    },

    fail(error: unknown): void {
      if (done || hasFailure) {
        return;
      }

      hasFailure = true;
      failure = error;

      const pendingWaiters = waiters.splice(0, waiters.length);

      for (const waiter of pendingWaiters) {
        waiter.reject(error);
      }
    },

    iterable: {
      [Symbol.asyncIterator](): AsyncIterator<T> {
        return this;
      },

      next(): Promise<IteratorResult<T>> {
        const nextValue = values.shift();

        if (nextValue) {
          return Promise.resolve(nextValue);
        }

        if (hasFailure) {
          return Promise.reject(failure);
        }

        if (done) {
          return Promise.resolve({ done: true, value: undefined });
        }

        return new Promise((resolve, reject) => {
          waiters.push({ reject, resolve });
        });
      },

      return(): Promise<IteratorResult<T>> {
        done = true;
        values.length = 0;
        close({ done: true, value: undefined });

        return Promise.resolve({ done: true, value: undefined });
      },
    },

    push(value: T): void {
      if (done || hasFailure) {
        return;
      }

      const waiter = waiters.shift();

      if (waiter) {
        waiter.resolve({ done: false, value });
        return;
      }

      values.push({ done: false, value });
    },
  };
}

function createFanoutLogger(loggers: HarnessLogger[] | undefined): HarnessLogger | undefined {
  if (!loggers?.length) {
    return undefined;
  }

  return {
    log(event): void {
      for (const logger of loggers) {
        try {
          const result = logger.log(event);

          if (result && typeof (result as PromiseLike<unknown>).then === 'function') {
            void Promise.resolve(result).catch(() => {});
          }
        } catch {
          // Logger failures are best-effort and isolated.
        }
      }
    },
  };
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== 'object') {
    return value;
  }

  for (const nestedValue of Object.values(value)) {
    deepFreeze(nestedValue);
  }

  return Object.freeze(value);
}

export function createHarness(options: CreateHarnessOptions = {}): Harness {
  const provider = options.providerInstance ?? (options.provider ? createProvider(options.provider) : null);
  const runtimeLogger = createFanoutLogger(options.loggers);
  const sessionStore: SessionStore = options.sessionStore ?? new MemorySessionStore();
  const systemPrompt = options.systemPrompt;
  const toolPolicy = options.toolPolicy ?? { workspaceRoot: process.cwd() };
  const tools = options.tools ?? [];
  const listeners = new Set<HarnessEventListener>();

  if (!provider) {
    throw new Error('Missing provider. Pass providerInstance or provider config to createHarness().');
  }

  const resolvedProvider = provider;
  const toolDefinitions = getToolDefinitions(tools);
  const toolsByName = getToolMap(tools);
  const toolContext = createToolContext(toolPolicy);

  const session: Session = {
    id: options.sessionId ?? 'local-session',
    createdAt: new Date().toISOString(),
    messages: [],
    turnStatus: 'idle',
  };

  emitRuntimeTrace(runtimeLogger, 'session_started', {
    debug: Boolean(options.debug),
    provider: provider.name,
    runId: randomUUID(),
    sessionId: session.id,
    stream: Boolean(options.stream),
  });

  let initializedSessionPromise: Promise<void> | null = null;
  let sendQueue: Promise<void> = Promise.resolve();

  async function updateResolvedExecutionState(
    stage: ResolvedApprovalState['stage'],
    toolCallId: string,
    toolResult: ApprovedToolResult | DeniedToolResult,
  ): Promise<void> {
    let lastError: unknown;

    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        await updateSessionState({
          pendingApproval: {
            stage,
            toolCallId,
            toolResult,
          },
        });
        return;
      } catch (error: unknown) {
        lastError = error;
      }
    }

    throw lastError;
  }

  async function updateSessionState(patch: SessionStatePatch): Promise<void> {
    await sessionStore.updateSessionState(session.id, patch);
    applySessionStatePatch(session, patch);
  }

  function getPendingApprovalState(): PendingApprovalState {
    if (!session.pendingApproval) {
      throw new Error('Session is not awaiting approval.');
    }

    return session.pendingApproval;
  }

  function getApprovalLabel(toolCallId: string, toolName: string): string {
    return `${toolName} (${toolCallId})`;
  }

  function getInterruptedApprovalError(toolCallId: string, toolName: string): Error {
    return new Error(
      `Tool execution was already approved for ${getApprovalLabel(toolCallId, toolName)}, but its previous run did not finish cleanly. Automatic retry is blocked to avoid duplicate side effects.`,
    );
  }

  function getDeniedApprovalError(toolCallId: string, toolName: string): Error {
    return new Error(
      `Tool execution was already denied by user approval for ${getApprovalLabel(toolCallId, toolName)}.`,
    );
  }

  function getApprovedResolutionError(toolCallId: string, toolName: string): Error {
    return new Error(
      `Tool execution was already approved for ${getApprovalLabel(toolCallId, toolName)} and cannot be denied.`,
    );
  }

  function requirePendingApproval(): PendingApproval {
    const turnId = session.currentTurnId;
    const toolCallId = session.pendingApproval?.toolCallId;

    if (!turnId || !toolCallId) {
      throw new Error('Session is not awaiting approval.');
    }

    const toolCall = findToolCall(session.messages, toolCallId);

    if (!toolCall) {
      throw new Error(`Pending approval tool call was not found in session transcript: ${toolCallId}`);
    }

    return {
      input: toolCall.input,
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      turnId,
    };
  }

  function toTurnResult(result: Awaited<ReturnType<typeof runLoop>>): TurnResult {
    if (result.status === 'completed') {
      return result;
    }

    return {
      approval: requirePendingApproval(),
      status: 'awaiting_approval',
    };
  }

  async function appendToolMessage(message: Message): Promise<void> {
    await sessionStore.appendMessage(session.id, message);
    session.messages.push(message);
  }

  function emitHarnessEvent(event: HarnessEvent): void {
    const frozenEvent = deepFreeze(structuredClone(event));

    emitRuntimeTrace(runtimeLogger, 'event_emitted', {
      eventType: frozenEvent.type,
      sessionId: frozenEvent.sessionId,
      turnId: frozenEvent.turnId,
    });

    for (const listener of listeners) {
      try {
        const result = listener(frozenEvent);

        if (result && typeof (result as PromiseLike<unknown>).then === 'function') {
          void Promise.resolve(result).catch(() => {
            emitRuntimeTrace(runtimeLogger, 'listener_failed', {
              eventType: frozenEvent.type,
            });
          });
        }
      } catch {
        emitRuntimeTrace(runtimeLogger, 'listener_failed', {
          eventType: frozenEvent.type,
        });
      }
    }
  }

  async function continueTurn(turnId: string, resumeAfterToolCallId?: string): Promise<TurnResult> {
    return toTurnResult(
      await runLoop({
        debug: options.debug,
        emitEvent: emitHarnessEvent,
        logger: runtimeLogger,
        provider: resolvedProvider,
        resumeAfterToolCallId,
        session,
        sessionStore,
        systemPrompt,
        toolPolicy,
        tools,
        turnId,
      }),
    );
  }

  async function appendResolvedToolMessage(
    approval: PendingApproval,
    toolResult: ApprovedToolResult | DeniedToolResult,
  ): Promise<void> {
    if (!findToolMessage(session.messages, approval.toolCallId)) {
      await appendToolMessage({
        ...toolResult,
        createdAt: new Date().toISOString(),
        role: 'tool',
      });
    }
  }

  async function resumeResolvedPendingTurn(
    approval: PendingApproval,
    pendingApproval: PendingApprovalState,
  ): Promise<TurnResult | null> {
    if (pendingApproval.stage === 'approved_executed' || pendingApproval.stage === 'denied_executed') {
      await appendResolvedToolMessage(approval, pendingApproval.toolResult);
      return continueTurn(approval.turnId, approval.toolCallId);
    }

    return null;
  }

  async function ensureSession(): Promise<void> {
    if (initializedSessionPromise) {
      return initializedSessionPromise;
    }

    initializedSessionPromise = (async () => {
      try {
        const existingSession = await sessionStore.getSession(session.id);

        if (existingSession) {
          session.createdAt = existingSession.createdAt;
          session.currentTurnId = existingSession.currentTurnId;
          session.messages = existingSession.messages;
          session.pendingApproval = existingSession.pendingApproval;
          session.turnStatus = existingSession.turnStatus;
          return;
        }

        const createdSession = await sessionStore.createSession(session);

        session.createdAt = createdSession.createdAt;
        session.currentTurnId = createdSession.currentTurnId;
        session.messages = createdSession.messages;
        session.pendingApproval = createdSession.pendingApproval;
        session.turnStatus = createdSession.turnStatus;
      } catch (error: unknown) {
        initializedSessionPromise = null;
        throw error;
      }
    })();

    return initializedSessionPromise;
  }

  async function enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const waitForTurn = sendQueue;
    let releaseTurn!: () => void;

    sendQueue = new Promise((resolve) => {
      releaseTurn = resolve;
    });

    await waitForTurn;

    try {
      return await operation();
    } finally {
      releaseTurn();
    }
  }

  function enqueueStream(content: string): AsyncIterable<TurnChunk> & AsyncIterator<TurnChunk> {
    const queue = createAsyncQueue<TurnChunk>();
    const abortController = new AbortController();
    let started = false;

    const start = (): void => {
      if (started) {
        return;
      }

      started = true;

      const sessionReady = ensureSession();
      const waitForTurn = sendQueue;
      let releaseTurn!: () => void;

      sendQueue = new Promise((resolve) => {
        releaseTurn = resolve;
      });

      void (async () => {
        try {
          await sessionReady;
          await waitForTurn;

          if (getTurnStatus(session) === 'awaiting_approval') {
            const approval = requirePendingApproval();
            const pendingApproval = getPendingApprovalState();

            if (pendingApproval.stage === 'approved_executing') {
              throw getInterruptedApprovalError(approval.toolCallId, approval.toolName);
            }

            if (pendingApproval.stage === 'approved_executed' || pendingApproval.stage === 'denied_executed') {
              throw new Error(
                `Session has a resolved pending turn for tool call ${getApprovalLabel(approval.toolCallId, approval.toolName)}. Resume it with resumePendingTurn().`,
              );
            }

            throw new Error(
              `Session is awaiting approval for tool call ${getApprovalLabel(approval.toolCallId, approval.toolName)}. Resolve it with approvePendingTool() or denyPendingTool().`,
            );
          }

          const turnId = randomUUID();

          await updateSessionState({
            currentTurnId: turnId,
            pendingApproval: null,
            turnStatus: 'running',
          });

          for await (const chunk of streamLoop({
            content,
            debug: options.debug,
            emitEvent: emitHarnessEvent,
            logger: runtimeLogger,
            provider: resolvedProvider,
            signal: abortController.signal,
            session,
            sessionStore,
            stream: options.stream,
            systemPrompt,
            toolPolicy,
            tools,
            turnId,
          })) {
            queue.push(chunk);
          }

          queue.end();
        } catch (error: unknown) {
          queue.fail(error);
        } finally {
          releaseTurn();
        }
      })();
    };

    return {
      [Symbol.asyncIterator](): AsyncIterator<TurnChunk> {
        return this;
      },
      next(): Promise<IteratorResult<TurnChunk>> {
        start();
        return queue.iterable.next();
      },
      return(): Promise<IteratorResult<TurnChunk>> {
        if (!started) {
          return Promise.resolve({ done: true, value: undefined });
        }

        abortController.abort();
        return queue.iterable.return?.() ?? Promise.resolve({ done: true, value: undefined });
      },
    };
  }

  return {
    async approvePendingTool(): Promise<TurnResult> {
      await ensureSession();

      return enqueue(async () => {
        const approval = requirePendingApproval();
        const pendingApproval = getPendingApprovalState();
        let toolResult;
        const toolCall: ModelToolCall = {
          id: approval.toolCallId,
          input: approval.input,
          name: approval.toolName,
        };

        if (pendingApproval.stage === 'awaiting_user') {
          const observer = createLoopObserver({
            debug: options.debug,
            emitEvent: emitHarnessEvent,
            logger: runtimeLogger,
            provider: resolvedProvider,
            sessionId: session.id,
            toolDefinitions,
            turnId: approval.turnId,
          });
          const iteration = getCurrentTurnProgress(session.messages).iteration;

          await updateSessionState({
            pendingApproval: {
              stage: 'approved_executing',
              toolCallId: approval.toolCallId,
            },
          });

          observer.toolStarted(iteration, toolCall);
          const toolStartedAt = Date.now();
          toolResult = await executeToolCall(toolCall, toolsByName, toolContext);
          observer.toolFinished(iteration, toolCall, toolResult, Date.now() - toolStartedAt);

          await updateResolvedExecutionState('approved_executed', approval.toolCallId, toolResult);
        } else if (pendingApproval.stage === 'approved_executed') {
          toolResult = pendingApproval.toolResult;
        } else if (pendingApproval.stage === 'denied_executed') {
          throw getDeniedApprovalError(approval.toolCallId, approval.toolName);
        } else {
          throw getInterruptedApprovalError(approval.toolCallId, approval.toolName);
        }

        await appendResolvedToolMessage(approval, toolResult);

        return continueTurn(approval.turnId, approval.toolCallId);
      });
    },
    async denyPendingTool(reason?: string): Promise<TurnResult> {
      await ensureSession();

      return enqueue(async () => {
        const approval = requirePendingApproval();
        const pendingApproval = getPendingApprovalState();
        const toolResult: DeniedToolResult = {
          content: reason?.trim() || 'Tool execution denied by user approval.',
          isError: true,
          name: approval.toolName,
          toolCallId: approval.toolCallId,
        };

        if (pendingApproval.stage === 'approved_executing') {
          throw getInterruptedApprovalError(approval.toolCallId, approval.toolName);
        }

        if (pendingApproval.stage === 'approved_executed') {
          throw getApprovedResolutionError(approval.toolCallId, approval.toolName);
        }

        if (pendingApproval.stage === 'awaiting_user') {
          await updateResolvedExecutionState('denied_executed', approval.toolCallId, toolResult);
        }

        if (pendingApproval.stage === 'denied_executed') {
          const resumedTurn = await resumeResolvedPendingTurn(approval, pendingApproval);

          if (resumedTurn) {
            return resumedTurn;
          }
        }

        await appendResolvedToolMessage(approval, toolResult);

        return continueTurn(approval.turnId, approval.toolCallId);
      });
    },
    async getPendingApproval(): Promise<PendingApproval | null> {
      await ensureSession();

      if (getTurnStatus(session) !== 'awaiting_approval') {
        return null;
      }

      const approval = requirePendingApproval();
      const pendingApproval = getPendingApprovalState();

      if (pendingApproval.stage === 'approved_executing') {
        throw getInterruptedApprovalError(approval.toolCallId, approval.toolName);
      }

      if (pendingApproval.stage === 'approved_executed' || pendingApproval.stage === 'denied_executed') {
        return null;
      }

      return approval;
    },
    async resumePendingTurn(): Promise<TurnResult | null> {
      await ensureSession();

      return enqueue(async () => {
        if (getTurnStatus(session) !== 'awaiting_approval') {
          return null;
        }

        const approval = requirePendingApproval();
        const pendingApproval = getPendingApprovalState();

        if (pendingApproval.stage === 'approved_executing') {
          throw getInterruptedApprovalError(approval.toolCallId, approval.toolName);
        }

        return resumeResolvedPendingTurn(approval, pendingApproval);
      });
    },
    session,
    async sendUserMessage(content: string): Promise<TurnResult> {
      await ensureSession();

      return enqueue(async () => {
        if (getTurnStatus(session) === 'awaiting_approval') {
          const approval = requirePendingApproval();
          const pendingApproval = getPendingApprovalState();

          if (pendingApproval.stage === 'approved_executing') {
            throw getInterruptedApprovalError(approval.toolCallId, approval.toolName);
          }

          if (pendingApproval.stage === 'approved_executed' || pendingApproval.stage === 'denied_executed') {
            throw new Error(
              `Session has a resolved pending turn for tool call ${getApprovalLabel(approval.toolCallId, approval.toolName)}. Resume it with resumePendingTurn().`,
            );
          }

          throw new Error(
            `Session is awaiting approval for tool call ${getApprovalLabel(approval.toolCallId, approval.toolName)}. Resolve it with approvePendingTool() or denyPendingTool().`,
          );
        }

        const turnId = randomUUID();

        await updateSessionState({
          currentTurnId: turnId,
          pendingApproval: null,
          turnStatus: 'running',
        });

        return toTurnResult(
          await runLoop({
            debug: options.debug,
            emitEvent: emitHarnessEvent,
            logger: runtimeLogger,
            provider: resolvedProvider,
            session,
            sessionStore,
            startContent: content,
            systemPrompt,
            toolPolicy,
            tools,
            turnId,
          }),
        );
      });
    },
    streamUserMessage(content: string): AsyncIterable<TurnChunk> {
      return enqueueStream(content);
    },
    subscribe(listener: HarnessEventListener): () => void {
      listeners.add(listener);

      return () => {
        listeners.delete(listener);
      };
    },
  };
}
