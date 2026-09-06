import { Hono } from "hono";

import { ChatHandler } from "../handlers";
import { authMiddleware } from "../middleware/auth";
import { createRateLimitMiddleware } from "../middleware/rate-limit-hono";
import type { ChatCompletionRequest } from "../types";
import type { HonoEnv } from "../types/hono";
import { calculateChatRequestTokens } from "../utils";
import { ValidationError } from "../utils/errors";

const app = new Hono<HonoEnv>();

app.post("/completions", authMiddleware, async (c) => {
  let body: ChatCompletionRequest;
  try {
    body = await c.req.json();
  } catch {
    throw new ValidationError("Invalid JSON in request body");
  }

  const apiKey = c.get("apiKey");

  const rateLimitMiddleware = createRateLimitMiddleware(
    calculateChatRequestTokens(body),
  );
  await rateLimitMiddleware(c, async () => {});

  const chatHandler = new ChatHandler(c.env);
  const response = await chatHandler.handleChatCompletionsWithBody(
    body,
    apiKey,
  );

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
});

export default app;
