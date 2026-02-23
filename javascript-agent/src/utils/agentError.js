export class AgentError extends Error {
  constructor(code, message, retryable = false, statusCode = 400) {
    super(message);
    this.code = code;
    this.retryable = retryable;
    this.statusCode = statusCode;
  }
}
