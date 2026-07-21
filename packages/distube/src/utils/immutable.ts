function cloneValue(value: unknown, seen: WeakMap<object, unknown>): unknown {
  if (value === null || typeof value !== "object") return value;
  if (value instanceof Date) return new Date(value.getTime());
  const cached = seen.get(value);
  if (cached) return cached;
  if (Array.isArray(value)) {
    const result: unknown[] = [];
    seen.set(value, result);
    for (const entry of value) result.push(cloneValue(entry, seen));
    return Object.freeze(result);
  }
  if (value instanceof Map) {
    const result = new Map<unknown, unknown>();
    seen.set(value, result);
    for (const [key, entry] of value) result.set(cloneValue(key, seen), cloneValue(entry, seen));
    return result;
  }
  if (value instanceof Set) {
    const result = new Set<unknown>();
    seen.set(value, result);
    for (const entry of value) result.add(cloneValue(entry, seen));
    return result;
  }
  const result: Record<PropertyKey, unknown> = {};
  seen.set(value, result);
  for (const key of Reflect.ownKeys(value)) result[key] = cloneValue(Reflect.get(value, key), seen);
  return Object.freeze(result);
}

export function immutableClone<T>(value: T): T {
  return cloneValue(value, new WeakMap()) as T;
}
