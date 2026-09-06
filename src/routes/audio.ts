import { Hono } from "hono";

import { MEDIA_REQUEST_TOKEN_ESTIMATE } from "../constants/config";
import { AudioHandler } from "../handlers";
import { authMiddleware } from "../middleware/auth";
import { createRateLimitMiddleware } from "../middleware/rate-limit-hono";
import type { HonoEnv } from "../types/hono";

const app = new Hono<HonoEnv>();

app.post("/transcriptions", authMiddleware, async (c) => {
  // Apply rate limiting with fixed token count for audio
  const rateLimitMiddleware = createRateLimitMiddleware(
    MEDIA_REQUEST_TOKEN_ESTIMATE,
  );
  await rateLimitMiddleware(c, async () => {});

  const apiKey = c.get("apiKey");
  const audioHandler = new AudioHandler(c.env);
  const response = await audioHandler.handleTranscription(c.req.raw, apiKey);

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
});

app.post("/translations", authMiddleware, async (c) => {
  const rateLimitMiddleware = createRateLimitMiddleware(
    MEDIA_REQUEST_TOKEN_ESTIMATE,
  );
  await rateLimitMiddleware(c, async () => {});

  const apiKey = c.get("apiKey");
  const audioHandler = new AudioHandler(c.env);
  const response = await audioHandler.handleTranslation(c.req.raw, apiKey);

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
});

export default app;
