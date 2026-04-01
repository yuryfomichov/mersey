export type HarnessRuntimeTraceType =
  | 'event_delivery_failed'
  | 'event_emitted'
  | 'listener_failed'
  | 'loop_iteration_started'
  | 'provider_request_started'
  | 'provider_response_finished'
  | 'session_started'
  | 'tool_execution_finished'
  | 'tool_execution_started';

export type HarnessRuntimeTrace = {
  detail: Record<string, unknown>;
  timestamp: string;
  type: HarnessRuntimeTraceType;
};

export interface HarnessLogger {
  log(event: HarnessRuntimeTrace): void | Promise<void>;
}
