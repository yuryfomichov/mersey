export function freezeDeep<T>(value: T): T {
  if (!value || typeof value !== 'object') {
    return value;
  }

  for (const nestedValue of Object.values(value)) {
    freezeDeep(nestedValue);
  }

  return Object.freeze(value);
}
