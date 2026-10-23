import { AppError } from './errors.js';
export function invalid(message: string): never {
  throw new AppError('invalid_data', message);
}

export function object(value: unknown): asserts value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) invalid('Expected an object');
}

/** JSON is the persistence boundary. Optional undefined object properties are omitted, as in Pi. */
export function jsonValue(value: unknown, ancestors = new Set<object>()): void {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  if (typeof value !== 'object' || value === null) invalid('Unsupported JSON value');
  if (ancestors.has(value)) invalid('Cyclic data cannot be stored');
  if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
    invalid('Only plain JSON objects can be stored');
  }
  if (Object.getOwnPropertySymbols(value).length) invalid('Symbol keys cannot be stored');
  ancestors.add(value);
  if (Array.isArray(value)) {
    for (const item of value) jsonValue(item, ancestors);
  } else {
    for (const item of Object.values(value)) if (item !== undefined) jsonValue(item, ancestors);
  }
  ancestors.delete(value);
}
