import { Hono } from "hono";

import { MEDIA_REQUEST_TOKEN_ESTIMATE } from "../constants/config";
import { ImageHandler } from "../handlers";
import { authMiddleware } from "../middleware/auth";
import { createRateLimitMiddleware } from "../middleware/rate-limit-hono";
import type { HonoEnv } from "../types/hono";

const app = new Hono<HonoEnv>();

app.post("/generations", authMiddleware, async (c) => {
  // Apply rate limiting with fixed token count for images
  const rateLimitMiddleware = createRateLimitMiddleware(
    MEDIA_REQUEST_TOKEN_ESTIMATE,
  );
  await rateLimitMiddleware(c, async () => {});

  // Get API key from context (set by auth middleware)
  const apiKey = c.get("apiKey");

  const imageHandler = new ImageHandler(c.env);
  const response = await imageHandler.handleImageGeneration(c.req.raw, apiKey);

  // Return the response directly since ImageHandler returns a Response object
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
});

export default app;
