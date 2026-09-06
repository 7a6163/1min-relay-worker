import { Hono } from "hono";

import { ResponseHandler } from "../handlers";
import { authMiddleware } from "../middleware/auth";
import { createRateLimitMiddleware } from "../middleware/rate-limit-hono";
import type { ResponseRequest } from "../types";
import type { HonoEnv } from "../types/hono";
import { calculateResponseRequestTokens } from "../utils";
import { ValidationError } from "../utils/errors";

const app = new Hono<HonoEnv>();

app.post("/", authMiddleware, async (c) => {
  let body: ResponseRequest;
  try {
    body = await c.req.json();
  } catch {
    throw new ValidationError("Invalid JSON in request body");
  }

  const apiKey = c.get("apiKey");

  const rateLimitMiddleware = createRateLimitMiddleware(
    calculateResponseRequestTokens(body),
  );
  await rateLimitMiddleware(c, async () => {});

  const responseHandler = new ResponseHandler(c.env);
  const response = await responseHandler.handleResponsesWithBody(body, apiKey);

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
});

export default app;
