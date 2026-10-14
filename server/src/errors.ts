import type { ContentfulStatusCode } from 'hono/utils/http-status';

/** Thrown by handlers; rendered as { error: { code, message } } with the given status. */
export class HttpError extends Error {
  constructor(
    readonly status: ContentfulStatusCode,
    readonly code: string,
    message: string,
    readonly headers: Record<string, string> = {},
  ) {
    super(message);
  }
}

export const badRequest = (message: string, code = 'invalid_request') => new HttpError(400, code, message);
export const unauthorized = (message = 'Sign in to continue.', code = 'unauthorized') =>
  new HttpError(401, code, message);
export const notFound = (message = 'Not found.') => new HttpError(404, 'not_found', message);
