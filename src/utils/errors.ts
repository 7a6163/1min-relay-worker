/**
 * Custom error classes for better error handling and OpenAI API compatibility
 */

export class ValidationError extends Error {
  public readonly type = "invalid_request_error";
  public readonly code: string | null;
  public readonly param: string | null;
  public readonly status = 400;

  constructor(message: string, param?: string, code?: string) {
    super(message);
    this.name = "ValidationError";
    this.param = param || null;
    this.code = code || null;
  }
}

export class AuthenticationError extends Error {
  public readonly type = "authentication_error";
  public readonly code = "invalid_api_key";
  public readonly param = "authorization";
  public readonly status = 401;

  constructor(message: string = "Invalid or missing API key") {
    super(message);
    this.name = "AuthenticationError";
  }
}

export class RateLimitError extends Error {
  public readonly type = "rate_limit_error";
  public readonly code = "rate_limit_exceeded";
  public readonly param: string | null = null;
  public readonly status = 429;

  constructor(message: string) {
    super(message);
    this.name = "RateLimitError";
  }
}

export class ModelNotFoundError extends Error {
  public readonly type = "invalid_request_error";
  public readonly code = "model_not_found";
  public readonly param = "model";
  public readonly status = 404;

  constructor(model: string) {
    super(`The model '${model}' does not exist`);
    this.name = "ModelNotFoundError";
  }
}

export class ApiError extends Error {
  public readonly type = "api_error";
  public readonly code: string | null;
  public readonly param: string | null = null;
  public readonly status: number;

  constructor(message: string, status: number = 500, code?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code ?? null;
  }
}

/**
 * Converts an error to OpenAI API error format
 */
export function toOpenAIError(error: unknown): {
  message: string;
  type: string;
  param: string | null;
  code: string | null;
  status: number;
} {
  if (
    error instanceof ValidationError ||
    error instanceof AuthenticationError ||
    error instanceof RateLimitError ||
    error instanceof ModelNotFoundError ||
    error instanceof ApiError
  ) {
    return {
      message: error.message,
      type: error.type,
      param: error.param,
      code: error.code,
      status: error.status,
    };
  }

  // Default error handling — never leak internal details to clients
  if (error instanceof Error) {
    return {
      message: "An internal error occurred",
      type: "api_error",
      param: null,
      code: null,
      status: 500,
    };
  }

  return {
    message: "An unknown error occurred",
    type: "api_error",
    param: null,
    code: null,
    status: 500,
  };
}

/**
 * Converts an error to Anthropic API error format
 */
export function toAnthropicError(error: unknown): {
  type: string;
  message: string;
  status: number;
} {
  if (error instanceof AuthenticationError) {
    return {
      type: "authentication_error",
      message: error.message,
      status: 401,
    };
  }

  if (error instanceof RateLimitError) {
    return {
      type: "rate_limit_error",
      message: error.message,
      status: 429,
    };
  }

  if (error instanceof ModelNotFoundError) {
    return {
      type: "not_found_error",
      message: error.message,
      status: 404,
    };
  }

  if (error instanceof ValidationError) {
    return {
      type: "invalid_request_error",
      message: error.message,
      status: 400,
    };
  }

  if (error instanceof ApiError) {
    return {
      type: "api_error",
      message: error.message,
      status: error.status,
    };
  }

  // Never leak internal details to clients
  if (error instanceof Error) {
    return {
      type: "api_error",
      message: "An internal error occurred",
      status: 500,
    };
  }

  return {
    type: "api_error",
    message: "An unknown error occurred",
    status: 500,
  };
}
