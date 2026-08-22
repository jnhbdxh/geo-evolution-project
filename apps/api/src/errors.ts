export class DomainError extends Error {
  public constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "DomainError";
  }
}

export function notFound(message = "Resource not found"): DomainError {
  return new DomainError("NOT_FOUND", message, 404);
}

export function forbidden(message = "Access denied"): DomainError {
  return new DomainError("FORBIDDEN", message, 403);
}

export function conflict(message: string): DomainError {
  return new DomainError("CONFLICT", message, 409);
}
