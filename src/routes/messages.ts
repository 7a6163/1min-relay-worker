import { Hono } from "hono";

import { MessagesHandler } from "../handlers/messages";
import { authMiddleware } from "../middleware/auth";
import { createRateLimitMiddleware } from "../middleware/rate-limit-hono";
import type { AnthropicMessageRequest } from "../types";
import type { HonoEnv } from "../types/hono";
import { calculateAnthropicRequestTokens } from "../utils";
import { ValidationError } from "../utils/errors";

const app = new Hono<HonoEnv>();

app.post("/", authMiddleware, async (c) => {
  let body: AnthropicMessageRequest;
  try {
    body = await c.req.json();
  } catch {
    throw new ValidationError("Invalid JSON in request body");
  }

  const apiKey = c.get("apiKey");

  const rateLimitMiddleware = createRateLimitMiddleware(
    calculateAnthropicRequestTokens(body),
  );
  await rateLimitMiddleware(c, async () => {});

  const messagesHandler = new MessagesHandler(c.env);
  const response = await messagesHandler.handleMessages(body, apiKey);

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
});

export default app;
