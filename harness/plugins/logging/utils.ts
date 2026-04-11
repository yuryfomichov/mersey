import type { HarnessEvent } from '../../runtime/events/types.js';

function hasUnsafeStringContent(value: string): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0);

    if (code <= 0x20 || code === 0x7f || character === '"' || character === '\\') {
      return true;
    }
  }

  return false;
}

function formatValue(value: unknown): string {
  if (typeof value === 'string') {
    return hasUnsafeStringContent(value) ? JSON.stringify(value) : value;
  }

  if (typeof value === 'number' || typeof value === 'boolean' || value === null) {
    return String(value);
  }

  if (value === undefined || typeof value === 'bigint' || typeof value === 'symbol' || typeof value === 'function') {
    return String(value);
  }

  try {
    const json = JSON.stringify(value);

    return json === undefined ? String(value) : json;
  } catch {
    return String(value);
  }
}

export function toEventTextLine(event: HarnessEvent): string {
  const detail = Object.entries(event)
    .filter(([key]) => key !== 'timestamp' && key !== 'type')
    .map(([key, value]) => `${key}=${formatValue(value)}`)
    .join(' ');

  return detail ? `${event.timestamp} ${event.type} ${detail}` : `${event.timestamp} ${event.type}`;
}
