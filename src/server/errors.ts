export class DomainError extends Error {
  constructor(
    public code: string,
    public status = 409,
  ) {
    super(code);
  }
}
export function requireThat(
  value: unknown,
  code: string,
  status = 409,
): asserts value {
  if (!value) throw new DomainError(code, status);
}
