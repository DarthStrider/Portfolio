/** Errors the HTTP layer turns into status codes. */

export class NotFoundError extends Error {
  readonly status = 404;
}

export class ConflictError extends Error {
  readonly status = 409;
}

export class ValidationError extends Error {
  readonly status = 400;
  readonly problems: string[];

  constructor(problems: string[]) {
    super(problems.join("; "));
    this.problems = problems;
  }
}
