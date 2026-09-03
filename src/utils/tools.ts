/**
 * Guard for tool / function-calling parameters.
 *
 * The 1min.ai Chat with AI API has no tool-calling mechanism, so a `tools`
 * array cannot be honoured no matter which endpoint receives it. Accepting one
 * and answering with plain prose looks like the model chose not to call a
 * tool, which is a confusing failure for the client to debug — reject it
 * instead.
 */

import { ValidationError } from "./errors";

export function assertToolsUnsupported(tools: unknown): void {
  if (!Array.isArray(tools) || tools.length === 0) return;

  throw new ValidationError(
    "Function calling is not supported: the upstream 1min.ai API has no " +
      "tool-calling mechanism, so `tools` cannot be honoured. Remove the " +
      "field to send this request as a plain completion.",
    "tools",
    "unsupported_parameter",
  );
}
