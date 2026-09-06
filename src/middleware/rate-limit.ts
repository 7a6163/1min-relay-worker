/**
 * Rate limiting middleware using Cloudflare KV
 * Uses a simple sliding-window counter instead of storing full timestamp arrays.
 */

import { RATE_LIMIT_CONFIG } from "../constants";
import type { Env, RateLimitConfig, RateLimitRecord } from "../types";

export class RateLimiter {
  private env: Env;
  private config: RateLimitConfig;

  constructor(env: Env, config: RateLimitConfig = RATE_LIMIT_CONFIG) {
    this.env = env;
    this.config = config;
  }

  // ponytail: read-modify-write on KV, so concurrent requests for the same
  // client can read the same counter and overshoot the limit by roughly the
  // number of in-flight requests. KV has no atomic increment; move the counter
  // into a Durable Object if the limit ever needs to be exact.
  async checkRateLimit(
    clientId: string,
    tokenCount: number = 0,
  ): Promise<{ allowed: boolean }> {
    if (!this.env.RATE_LIMIT_STORE) {
      return { allowed: true };
    }

    const now = Date.now();

    try {
      const existingRecord = await this.env.RATE_LIMIT_STORE.get(clientId);
      let record: RateLimitRecord = existingRecord
        ? JSON.parse(existingRecord)
        : { requestCount: 0, tokenCount: 0, windowStart: now };

      // Reset if window has expired
      if (now - record.windowStart >= this.config.windowMs) {
        record = { requestCount: 0, tokenCount: 0, windowStart: now };
      }

      // Check request count limit
      if (record.requestCount >= this.config.maxRequests) {
        return { allowed: false };
      }

      // Check token count limit (if configured)
      if (
        this.config.maxTokens &&
        record.tokenCount + tokenCount > this.config.maxTokens
      ) {
        return { allowed: false };
      }

      // Update counters
      record.requestCount += 1;
      record.tokenCount += tokenCount;

      await this.env.RATE_LIMIT_STORE.put(clientId, JSON.stringify(record), {
        expirationTtl: Math.ceil(this.config.windowMs / 1000) + 60,
      });

      return { allowed: true };
    } catch (error) {
      console.error("Rate limiting error:", error);
      return { allowed: true };
    }
  }

  async middleware(
    request: Request,
    tokenCount: number = 0,
  ): Promise<{ allowed: boolean }> {
    const clientId = await getClientId(request);
    return this.checkRateLimit(clientId, tokenCount);
  }
}

/**
 * Extract client identifier from request headers for rate limiting.
 */
export async function getClientId(request: Request): Promise<string> {
  const authHeader = request.headers.get("Authorization");
  if (authHeader) {
    const hashBuffer = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(authHeader),
    );
    const hashHex = Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
      .slice(0, 16);
    return `auth:${hashHex}`;
  }

  const cfConnectingIp = request.headers.get("CF-Connecting-IP");
  if (cfConnectingIp) {
    return `ip:${cfConnectingIp}`;
  }

  const xForwardedFor = request.headers.get("X-Forwarded-For");
  if (xForwardedFor) {
    const firstIp = xForwardedFor.split(",")[0];
    return firstIp ? `ip:${firstIp.trim()}` : "anonymous";
  }

  return "anonymous";
}
