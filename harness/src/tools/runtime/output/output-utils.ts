import type { ToolOutputLimitResult } from '../types.js';

const DEFAULT_MAX_TOOL_RESULT_BYTES = 32 * 1024;

export function getDefaultToolResultBytes(): number {
  return DEFAULT_MAX_TOOL_RESULT_BYTES;
}

export function limitText(text: string, maxBytes: number): ToolOutputLimitResult {
  const originalBytes = Buffer.byteLength(text, 'utf8');

  if (maxBytes <= 0) {
    return {
      originalBytes,
      text: '',
      truncated: originalBytes > 0,
    };
  }

  if (originalBytes <= maxBytes) {
    return {
      originalBytes,
      text,
      truncated: false,
    };
  }

  let limitedText = text;

  while (Buffer.byteLength(limitedText, 'utf8') > maxBytes) {
    limitedText = limitedText.slice(0, -1);
  }

  const lastCodeUnit = limitedText.charCodeAt(limitedText.length - 1);

  if (lastCodeUnit >= 0xd800 && lastCodeUnit <= 0xdbff) {
    limitedText = limitedText.slice(0, -1);
  }

  return {
    originalBytes,
    text: limitedText,
    truncated: true,
  };
}
