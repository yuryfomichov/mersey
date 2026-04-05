const DEFAULT_TOOL_RESULT_BYTES = 16 * 1024;

type LimitTextOptions = {
  truncationMarker?: string;
};

export function getDefaultToolResultBytes(): number {
  return DEFAULT_TOOL_RESULT_BYTES;
}

function truncateToBytes(value: string, maxBytes: number): string {
  if (maxBytes <= 0) {
    return '';
  }

  const buffer = Buffer.from(value, 'utf8');

  if (buffer.byteLength <= maxBytes) {
    return value;
  }

  let slice = buffer.subarray(0, maxBytes);

  while (slice.length > 0) {
    const text = slice.toString('utf8');

    if (!text.includes('\ufffd')) {
      return text;
    }

    slice = slice.subarray(0, slice.length - 1);
  }

  return '';
}

export function limitText(
  text: string,
  maxBytes: number = getDefaultToolResultBytes(),
  options: LimitTextOptions = {},
): { originalBytes: number; text: string; truncated: boolean } {
  const originalBytes = Buffer.byteLength(text, 'utf8');

  if (originalBytes <= maxBytes) {
    return {
      originalBytes,
      text,
      truncated: false,
    };
  }

  const marker = options.truncationMarker ?? '';
  const markerBytes = Buffer.byteLength(marker, 'utf8');
  const contentBytes = Math.max(maxBytes - markerBytes, 0);
  const truncatedContent = truncateToBytes(text, contentBytes);

  return {
    originalBytes,
    text: `${truncatedContent}${marker}`,
    truncated: true,
  };
}
