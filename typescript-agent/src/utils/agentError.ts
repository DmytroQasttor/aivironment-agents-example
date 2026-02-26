// Domain error used to carry platform-friendly code/retry/status metadata.
export class AgentError extends Error {
  public readonly code: string;
  public readonly retryable: boolean;
  public readonly statusCode: number;

  constructor(
    code: string,
    message: string,
    retryable = false,
    statusCode = 400,
  ) {
    super(message);
    this.code = code;
    this.retryable = retryable;
    this.statusCode = statusCode;
  }
}
