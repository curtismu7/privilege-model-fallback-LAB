// A refusal from the caller: becomes a short JSON error with an HTTP status, never a stack trace.
// Messages are fixed text and never echo the caller's input.
export class InputError extends Error {
  constructor(code, message, status = 400) { super(message); this.code = code; this.status = status; }
}
export const refuse = (code, message, status = 400) => new InputError(code, message, status);
