/**
 * Turning a 1min.ai error response into something a client can act on.
 *
 * The upstream returns a structured body:
 *
 *   {"errorCode":"UNSUPPORTED_MODEL","message":"Model xxx is not supported"}
 *   {"errorCode":"MISSING_REQUIRED_FIELDS","message":"...: quality",
 *    "details":"[{\"field\":\"quality\",\"message\":\"Field 'quality' is required...\"}]"}
 *
 * Replacing all of that with a single generic sentence made real mistakes very
 * hard to diagnose. Worse, the upstream `message` is sometimes a canned line
 * that actively misleads — a parameter error can arrive as "The <provider>
 * service is a bit busy right now… please try again shortly", which invites an
 * endless retry — while the actual cause sits in `details`.
 *
 * Credential and server-side failures still get a generic message: their
 * bodies say nothing useful to the caller and may describe upstream internals.
 */

/** Fallback text by status, used when the body has nothing better. */
function genericUpstreamMessage(status: number): string {
  if (status === 401) return "Authentication failed with upstream provider";
  if (status === 403) return "Access denied by upstream provider";
  if (status === 404) return "Resource not found on upstream provider";
  if (status === 429) return "Rate limited by upstream provider";
  if (status >= 500) return "Upstream provider returned an internal error";
  return "Upstream request failed";
}

const MAX_MESSAGE_LENGTH = 500;
const MAX_DETAIL_ITEMS = 5;

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * Collect `message` strings out of a `details` payload, which arrives either as
 * a JSON-encoded string or an already-parsed value, and may be an array of
 * field errors or a nested provider response.
 *
 * Only `message` fields are collected: sibling keys can carry upstream
 * internals (provider request paths, request ids) that should not be echoed.
 */
export function collectDetailMessages(details: unknown): string[] {
  const parsed = typeof details === "string" ? safeJsonParse(details) : details;
  if (!parsed || typeof parsed !== "object") return [];

  const found: string[] = [];
  const seen = new Set<string>();

  const walk = (node: unknown, depth: number): void => {
    if (found.length >= MAX_DETAIL_ITEMS || depth > 6) return;
    if (Array.isArray(node)) {
      for (const item of node) walk(item, depth + 1);
      return;
    }
    if (!node || typeof node !== "object") return;

    const record = node as Record<string, unknown>;
    const message = record.message;
    if (typeof message === "string" && message.trim() && !seen.has(message)) {
      seen.add(message);
      found.push(message.trim());
    }
    for (const value of Object.values(record)) {
      if (value && typeof value === "object") walk(value, depth + 1);
    }
  };

  walk(parsed, 0);
  return found;
}

export interface UpstreamErrorInfo {
  message: string;
  code?: string;
}

export function describeUpstreamError(
  status: number,
  rawBody: string,
): UpstreamErrorInfo {
  const generic = genericUpstreamMessage(status);

  // Never echo credential or server-internal failures
  if (status === 401 || status === 403 || status >= 500) {
    return { message: generic };
  }

  const parsed = safeJsonParse(rawBody);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { message: generic };
  }

  const body = parsed as Record<string, unknown>;
  const code = typeof body.errorCode === "string" ? body.errorCode : undefined;
  const base =
    typeof body.message === "string" && body.message.trim()
      ? body.message.trim()
      : generic;

  const details = collectDetailMessages(body.details).filter((d) => d !== base);
  const message = details.length > 0 ? `${base} (${details.join("; ")})` : base;

  return {
    message:
      message.length > MAX_MESSAGE_LENGTH
        ? `${message.slice(0, MAX_MESSAGE_LENGTH - 1)}…`
        : message,
    code,
  };
}
