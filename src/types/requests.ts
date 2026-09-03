/**
 * Request type definitions for API endpoints
 */

export interface ChatCompletionRequest {
  model?: string;
  messages: Array<{
    role: string;
    content:
      | string
      | Array<{
          type: string;
          text?: string;
          image_url?: {
            url: string;
          };
        }>;
  }>;
  // Accepted for OpenAI SDK compatibility but NOT forwarded upstream:
  // the 1min.ai Chat with AI API has no sampling parameters.
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
}

export interface ImageGenerationRequest {
  model?: string;
  prompt: string;
  n?: number;
  size?: string;
}

export interface JSONSchema {
  name: string;
  description?: string;
  schema: Record<string, unknown>;
  strict?: boolean;
}

export interface ResponseFormat {
  type: "text" | "json_object" | "json_schema";
  json_schema?: JSONSchema;
}

export interface ResponseRequest {
  model?: string;
  // Support both input (simple) and messages (conversational) formats
  input?: string | ResponseInputItem[];
  messages?: Array<{
    role: string;
    content:
      | string
      | Array<{
          type: string;
          text?: string;
          image_url?: {
            url: string;
          };
        }>;
  }>;
  instructions?: string;
  // Accepted for SDK compatibility but NOT forwarded upstream (no sampling
  // parameters in the 1min.ai API).
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
  response_format?: ResponseFormat;
  reasoning_effort?: "low" | "medium" | "high";
  tools?: ResponseTool[];
}

export interface ResponseInputItem {
  // Optional per the OpenAI Responses API spec: an item carrying only
  // `role` + `content` is implicitly a message item. Many clients (e.g. the
  // n8n OpenAI node) omit it.
  type?: string;
  role: "user" | "assistant" | "system";
  content: string | Array<{ type: string; text?: string }>;
}

export interface ResponseToolFunction {
  type: "function";
  name: string;
  description?: string;
  parameters: Record<string, unknown>;
  strict?: boolean;
}

export type ResponseTool = ResponseToolFunction;
