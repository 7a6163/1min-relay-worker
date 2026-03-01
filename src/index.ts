import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { corsMiddleware } from "./middleware/cors";
import { errorHandler } from "./middleware/error-handler";
import apiRoutes from "./routes/api";
// Logger middleware removed for production
import rootRoutes from "./routes/root";
import { getModelData } from "./services/model-registry";
import type { HonoEnv } from "./types/hono";
import {
  ApiError,
  AuthenticationError,
  ModelNotFoundError,
  RateLimitError,
  toAnthropicError,
  toOpenAIError,
  ValidationError,
} from "./utils/errors";

const app = new Hono<HonoEnv>();

// Global error handler must be first
app.use("*", errorHandler);
app.use("*", corsMiddleware);

// Warm up model cache (non-blocking, won't delay the request)
app.use("*", async (c, next) => {
  c.executionCtx.waitUntil(getModelData(c.env).catch(() => {}));
  await next();
});

const EXPECTED_ERRORS = [
  ValidationError,
  AuthenticationError,
  RateLimitError,
  ModelNotFoundError,
  ApiError,
] as const;

const isExpectedError = (err: unknown): boolean =>
  EXPECTED_ERRORS.some((cls) => err instanceof cls);

// Global unhandled error handler
app.onError((err, c) => {
  if (isExpectedError(err)) {
    console.info(
      `Request error [${err.constructor.name}]: ${(err as Error).message}`,
    );
  } else {
    console.error("Unhandled error:", err);
  }
  const path = new URL(c.req.url).pathname;
  if (path.startsWith("/v1/messages")) {
    const errorData = toAnthropicError(err);
    return c.json(
      {
        type: "error",
        error: { type: errorData.type, message: errorData.message },
      },
      errorData.status as ContentfulStatusCode,
    );
  }
  const errorData = toOpenAIError(err);
  return c.json(
    {
      error: {
        message: errorData.message,
        type: errorData.type,
        param: errorData.param,
        code: errorData.code,
      },
    },
    errorData.status as ContentfulStatusCode,
  );
});

// Routes
app.route("/", rootRoutes);
app.route("/v1", apiRoutes);

// 404 handler
app.notFound((c) => {
  return c.json({ error: "Not Found" }, 404);
});

export default app;
