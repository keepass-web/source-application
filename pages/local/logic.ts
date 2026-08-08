// Pure logic for local: just the must() guard, kept here so its throw branch is unit-testable.

export function must<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) {
    throw new Error('expected element not found');
  }
  return value;
}
