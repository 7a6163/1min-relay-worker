import { createMiddleware } from "hono/factory";

import type { HonoEnv } from "../types/hono";
import { RateLimitError } from "../utils/errors";
import { RateLimiter } from "./rate-limit";

export const createRateLimitMiddleware = (tokenCount: number = 0) => {
  return createMiddleware<HonoEnv>(async (c, next) => {
    const rateLimiter = new RateLimiter(c.env);
    const result = await rateLimiter.middleware(c.req.raw, tokenCount);

    if (!result.allowed) {
      throw new RateLimitError("Rate limit exceeded");
    }

    await next();
  });
};
