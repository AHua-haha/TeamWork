export class AppError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 400) {
    super(message);
  }
}

export function identity(value: unknown, label = 'identity'): asserts value is string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(value)) {
    throw new AppError('invalid_input', `${label} must be 1–64 ASCII letters, digits, underscores or hyphens`);
  }
}

export function position(value: unknown): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new AppError('invalid_input', 'Position must be a nonnegative safe integer');
  }
}
