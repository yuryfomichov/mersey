export function freezeDeep<T>(value: T): T {
  return freezeDeepInternal(value, new WeakSet<object>());
}

export function snapshot<T>(value: T): T {
  return freezeDeep(structuredClone(value));
}

function freezeDeepInternal<T>(value: T, visited: WeakSet<object>): T {
  if (!value || typeof value !== 'object') {
    return value;
  }

  const objectValue = value as object;

  if (visited.has(objectValue)) {
    return value;
  }

  visited.add(objectValue);

  for (const nestedValue of Object.values(value)) {
    freezeDeepInternal(nestedValue, visited);
  }

  return Object.freeze(value);
}
