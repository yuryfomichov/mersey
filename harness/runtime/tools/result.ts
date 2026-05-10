import type { ToolContentPart } from '../models/types.js';
import type { ToolExecutionResult } from './catalog.js';

function stringifyJsonSafe(value: unknown, space?: number): string {
  const seen = new WeakSet<object>();
  const stringified = JSON.stringify(
    value,
    (_key, nestedValue: unknown) => {
      if (typeof nestedValue === 'bigint') {
        return nestedValue.toString();
      }

      if (typeof nestedValue === 'function') {
        return '[function]';
      }

      if (typeof nestedValue === 'symbol') {
        return nestedValue.toString();
      }

      if (nestedValue && typeof nestedValue === 'object') {
        if (seen.has(nestedValue)) {
          return '[circular]';
        }

        seen.add(nestedValue);
      }

      return nestedValue;
    },
    space,
  );

  return stringified ?? String(value);
}

function toJsonSafeValue(value: unknown): unknown {
  const stringified = stringifyJsonSafe(value);

  try {
    return JSON.parse(stringified) as unknown;
  } catch {
    return stringified;
  }
}

function projectPartToText(part: ToolContentPart): string {
  if (part.type === 'text') {
    return part.text;
  }

  if (part.type === 'json') {
    return stringifyJsonSafe(part.value, 2);
  }

  const resourceLabel = part.mimeType ? `${part.uri} (${part.mimeType})` : part.uri;

  if (part.text?.trim()) {
    return `${resourceLabel}\n${part.text}`;
  }

  return resourceLabel;
}

export function projectToolResultToText(result: ToolExecutionResult): string {
  return result.parts.map((part) => projectPartToText(part)).join('\n\n');
}

export function sanitizeToolExecutionResult(result: ToolExecutionResult): ToolExecutionResult {
  return {
    isError: result.isError,
    metadata: result.metadata ? (toJsonSafeValue(result.metadata) as Record<string, unknown>) : undefined,
    parts: result.parts.map((part) =>
      part.type === 'json'
        ? {
            type: 'json',
            value: toJsonSafeValue(part.value),
          }
        : part,
    ),
  };
}

export function getToolContentPartTelemetryLength(part: ToolContentPart): number {
  return stringifyJsonSafe(part).length;
}
