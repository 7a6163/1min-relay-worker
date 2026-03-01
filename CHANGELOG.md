# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [4.0.1] - 2026-03-01

### Fixed
- **Image upload MIME type detection**: `processImageUrl` now returns the detected MIME type alongside binary data instead of always assuming `image/png`
  - Base64 data URIs: MIME type extracted via regex (`/^data:([^;,]+)/`) from the data URI header
  - HTTP URLs: MIME type read from the `Content-Type` response header, validated against the supported set (`image/jpeg`, `image/png`, `image/webp`, `image/gif`); falls back to `image/png` for unsupported types
- **Image upload filename extension**: Uploaded files now include the correct extension (`.jpg`, `.png`, `.webp`, `.gif`) based on the detected MIME type; previously all files were uploaded without an extension, causing 1min.ai to reject them with "file type isn't supported"
- **Error body logging**: 1min.ai API errors now include the full response body (truncated to 500 chars) in the log, making it easier to diagnose upstream failures

## [4.0.0] - 2026-02-18

### Added
- **Dynamic Model Registry**: Model data is now fetched live from the 1min.ai API instead of hardcoded lists
  - Two-tier caching: in-memory (5 min TTL) + Cloudflare KV (1 hr TTL)
  - Thundering herd protection via inflight promise deduplication
  - Stale cache fallback when the upstream API is unavailable
  - KV data shape validation to handle schema changes across deployments
  - API response validation to surface unexpected response shapes
- **Model Cache Warmup**: Non-blocking `waitUntil` warmup on every `/v1/*` request to pre-populate the cache
- **`MODEL_CACHE` KV Namespace**: New KV binding for caching model data across Worker isolates
- **`ONE_MIN_MODELS_API_URL` Environment Variable**: Configurable 1min.ai models API endpoint

### Changed
- **All model capability checks are now async** — `supportsVision()`, `supportsCodeInterpreter()`, `supportsImageGeneration()`, `getModelCapabilities()`, `validateModelCapabilities()`, `validateModelAndMessages()` now return Promises and require an `env` parameter
- **`handleModelsEndpoint()` is now async** and takes an `env` parameter; capabilities are derived from the registry
- **Web search support**: All chat models now support `:online` suffix — removed per-model validation
- **Model parser**: Removed `colonCount > 1` early rejection so future model IDs containing colons are handled correctly
- **Default models updated** to match 1min.ai API model IDs:
  - `DEFAULT_MODEL`: `mistral-nemo` → `open-mistral-nemo`
  - `DEFAULT_IMAGE_MODEL`: `flux-schnell` → `black-forest-labs/flux-schnell`
- **Optimized `getModelCapabilities()`**: Single `getModelData()` call instead of 4 parallel calls
- **Optimized `validateModelAndMessages()`**: Single `getModelData()` call for model existence + vision check

### Removed
- **`src/constants/models.ts`** — Deleted entirely (227 lines of hardcoded model lists)
  - `ALL_ONE_MIN_AVAILABLE_MODELS`, `VISION_SUPPORTED_MODELS`, `CODE_INTERPRETER_SUPPORTED_MODELS`, `RETRIEVAL_SUPPORTED_MODELS`, `IMAGE_GENERATION_MODELS`, `VARIATION_SUPPORTED_MODELS`, `TEXT_TO_SPEECH_MODELS`, `SPEECH_TO_TEXT_MODELS`
- **`supportsRetrieval()`** — All chat models support web search via request body settings
- **`supportsTextToSpeech()` / `supportsSpeechToText()`** — No TTS/STT endpoints exposed
- **`validateModelSupportsWebSearch()`** — No longer needed; any chat model accepts `:online`

### Breaking Changes
- **Model IDs now come from the 1min.ai API** — some IDs have changed (e.g., `flux-schnell` → `black-forest-labs/flux-schnell`). Clients must use the IDs returned by `GET /v1/models`.
- **Capability check functions are now async** — callers must `await` them
- **`handleModelsEndpoint()` signature changed** — now requires `env` parameter
- **Models not listed in the API are no longer available** — xAI (Grok), Perplexity (Sonar), and some OpenAI reasoning models are not currently exposed by the 1min.ai models API

### Migration Guide
1. Create a new KV namespace: `wrangler kv:namespace create "MODEL_CACHE"`
2. Add the KV binding and `ONE_MIN_MODELS_API_URL` to `wrangler.jsonc`
3. Update any hardcoded model IDs in client code to match `GET /v1/models` output

## [3.8.0] - 2026-02-18

### Added
- **GitHub Actions CI**: Added `.github/workflows/ci.yml` workflow
  - Runs on push to `main` and pull requests
  - Lint, format check, and TypeScript type check steps
- **Biome Linter**: New `npm run lint` and `npm run check` scripts for linting and comprehensive code checks

### Changed
- **Migrated from Prettier to Biome**: Replaced Prettier with Biome for formatting, linting, and import sorting
  - Formatting defaults match Prettier (2-space indent, 80 line width, double quotes)
  - Enabled recommended lint rules and automatic import organization
  - `npm run format` now runs `biome check --write src/`
- **Code quality fixes** (auto-applied by Biome linter):
  - Replaced `isNaN()` with `Number.isNaN()` for type-safe NaN checks
  - Replaced string concatenation with template literals
  - Simplified conditions with optional chaining (`?.`)
  - Removed useless `case` clause before `default` in switch statement
  - Prefixed intentionally unused parameters with `_`
  - Replaced non-null assertions with type predicates and guard checks

### Removed
- **Prettier**: Removed `prettier` dev dependency

## [3.7.1] - 2026-02-09

### Changed
- **Handler Refactoring**: Eliminated HIGH priority code duplication across `ChatHandler`, `ResponseHandler`, and `MessagesHandler`
  - Created `BaseTextHandler` base class with shared `env`/`apiService` constructor
  - Extracted `estimateInputTokens()` to shared `src/utils/tokens.ts` utility
  - Extracted `validateModelAndMessages()` to `src/utils/model-validation.ts` — consolidates model parsing, model list check, image processing, and vision validation into a single call that throws typed errors
  - Extracted `executeStreamingPipeline()` to `src/utils/streaming.ts` — eliminates duplicated TransformStream/reader/writer/UTF-8 decoder boilerplate; handlers now only provide `onStart`/`onChunk`/`onEnd` callbacks

### Fixed
- **Anthropic Image Error Status Code**: `extractAnthropicContent` now throws `ValidationError` (400) instead of bare `Error` (500) when unsupported image content blocks are sent via the Anthropic Messages API
- **Error Message Leakage**: Messages handler API calls now wrap upstream errors in `ApiError("Failed to process message")` to prevent leaking internal URLs or stack traces to clients
- **Unhandled Promise Rejection**: Fixed `void writer.close()` in streaming pipeline to properly handle the promise with `.catch()`

## [3.7.0] - 2026-02-08

### Added
- **Alibaba Qwen Chat Models** (new provider):
  - `qwen3-max` - Qwen3 Max
  - `qwen-plus` - Qwen Plus
  - `qwen-max` - Qwen Max
  - `qwen-flash` - Qwen Flash
- **New Anthropic Model**:
  - `claude-opus-4-1-20250805` - Claude 4.1 Opus
- **New Cohere Model**:
  - `command-r-08-2024` - Command R (replaces deprecated `command`)
- **New Mistral Models**:
  - `magistral-small-latest` - Magistral Small 1.2
  - `magistral-medium-latest` - Magistral Medium 1.2
  - `ministral-14b-latest` - Ministral 14B
  - `open-mistral-nemo` - Mistral Open Nemo (replaces `mistral-nemo`)
  - `mistral-medium-latest` - Mistral Medium 3.1
- **New OpenAI Reasoning Models**:
  - `o3` - OpenAI o3
  - `o3-pro` - OpenAI o3 Pro
  - `o3-deep-research` - OpenAI o3 Deep Research
  - `o4-mini-deep-research` - OpenAI o4 Mini Deep Research
- **New Perplexity Model**:
  - `sonar-deep-research` - Perplexity Deep Research
- **Alibaba Qwen Vision Models**:
  - `qwen-vl-max` - Qwen VL Max (vision)
  - `qwen-vl-plus` - Qwen VL Plus (vision)
  - `qwen3-vl-flash` - Qwen3 VL Flash (vision)
  - `qwen3-vl-plus` - Qwen3 VL Plus (vision)
- **Expanded Vision Support**: Updated `VISION_SUPPORTED_MODELS` based on 1min.ai `CHAT_WITH_IMAGE` capability data
  - Added all Anthropic Claude 4.x models (6 models)
  - Added all GoogleAI Gemini 2.5+ models (3 models)
  - Added OpenAI `gpt-5.1`, `gpt-5.2`
  - Added Alibaba Qwen VL series (4 models)
  - Total vision models: 8 → 25
- **Alibaba Qwen Coder Models**:
  - `qwen3-coder-plus` - Qwen3 Coder Plus
  - `qwen3-coder-flash` - Qwen3 Coder Flash
- **New xAI Model**:
  - `grok-code-fast-1` - Grok Code Fast 1
- All new chat models support web search/retrieval (`:online` suffix)

### Removed
- **Deprecated OpenAI Models**: `gpt-4`, `gpt-4.5-preview`, `o1`, `o1-mini`
- **Deprecated Anthropic Models**: `claude-2.1`, `claude-instant-1.2`, `claude-3-haiku-20240307`, `claude-3-sonnet-20240229`, `claude-3-opus-20240229`, `claude-3-5-haiku-20241022`, `claude-3-5-sonnet-20240620`, `claude-3-7-sonnet-20250219`
- **Deprecated GoogleAI Models**: `gemini-1.0-pro`, `gemini-1.5-flash`, `gemini-1.5-pro`, `gemini-2.0-flash`, `gemini-2.0-flash-lite`, `gemini-2.5-flash-preview-04-17`, `gemini-2.5-flash-preview-05-20`, `gemini-2.5-pro-preview-05-06`
- **Deprecated Mistral Models**: `mistral-nemo`, `open-mistral-7b`, `open-mixtral-8x22b`, `open-mixtral-8x7b`, `pixtral-12b`
- **Deprecated Cohere Model**: `command` (replaced by `command-r-08-2024`)
- **Deprecated Perplexity Model**: `sonar-reasoning`
- **Deprecated xAI Model**: `grok-2`

### Removed (Breaking)
- **Function Calling Support**: Removed prompt-engineering-based function calling emulation
  - Deleted `src/utils/function-calling.ts` and `src/types/function-calling.ts`
  - Removed `FUNCTION_CALLING_SUPPORTED_MODELS` constant
  - Removed `supportsFunctionCalling()` capability check
  - Removed `function_calling` from model capabilities in `/v1/models` response
  - Removed `function_call` and `tool_calls` fields from chat completion response types
  - Removed `function` and `tool` from Message role types
  - Simplified chat handler streaming logic (no more function call accumulation/parsing)
  - 1min.ai API does not natively support function calling; the emulation was unreliable

### Changed
- **Model Constants**: Synced `ALL_ONE_MIN_AVAILABLE_MODELS` with 1min.ai API docs (2026-02-08)
- **Retrieval Support**: Synced `RETRIEVAL_SUPPORTED_MODELS` with 1min.ai official web search list (52 → 18 models)
- **Code Interpreter**: Updated `CODE_INTERPRETER_SUPPORTED_MODELS` — removed deprecated Claude 3.x models

## [3.6.9] - 2025-02-05

### Added
- **New Qwen Models Support**:
  - `qwen-image-plus` - Qwen image generation plus model
  - `qwen-image-max` - Qwen image generation max model
  - `qwen-image-edit-plus` - Qwen image editing plus model
  - `qwen3-tts-flash` - Qwen text-to-speech flash model
  - `qwen3-asr-flash` - Qwen speech recognition flash model
  - `qwen3-livetranslate-flash` - Qwen live translation flash model

### Changed
- **Model Constants**: Updated `ALL_ONE_MIN_AVAILABLE_MODELS` to include new Qwen models
- **Image Generation Models**: Added `qwen-image-plus`, `qwen-image-max`, `qwen-image-edit-plus` to `IMAGE_GENERATION_MODELS`
- **Image Variation Models**: Added `qwen-image-edit-plus` to `VARIATION_SUPPORTED_MODELS`
- **Text-to-Speech Models**: Added `qwen3-tts-flash` to `TEXT_TO_SPEECH_MODELS`
- **Speech-to-Text Models**: Added `qwen3-asr-flash` to `SPEECH_TO_TEXT_MODELS`

## [3.6.8] - 2025-11-23

### Added
- **New OpenAI GPT-5.2 Models Support**:
  - `gpt-5.2` - Latest GPT-5.2 model
  - `gpt-5.2-pro` - GPT-5.2 Pro model with enhanced capabilities
  - Both models support web search/retrieval functionality (`:online` suffix)

### Changed
- **Model Constants**: Updated `ALL_ONE_MIN_AVAILABLE_MODELS` to include new GPT-5.2 models
- **Retrieval Support**: Added new GPT-5.2 models to `RETRIEVAL_SUPPORTED_MODELS` list

## [3.6.7] - 2025-11-23

### Changed
- **Model List Organization**: Sorted all model lists alphabetically within each provider category
  - `ALL_ONE_MIN_AVAILABLE_MODELS` - All models sorted alphabetically per provider
  - `VISION_SUPPORTED_MODELS` - Vision models sorted alphabetically
  - `CODE_INTERPRETER_SUPPORTED_MODELS` - Code interpreter models sorted alphabetically
  - `RETRIEVAL_SUPPORTED_MODELS` - Web search models sorted alphabetically
  - `FUNCTION_CALLING_SUPPORTED_MODELS` - Function calling models sorted alphabetically
  - `IMAGE_GENERATION_MODELS` - Image generation models sorted alphabetically
  - `VARIATION_SUPPORTED_MODELS` - Image variation models sorted alphabetically
  - Improved code readability and maintainability

## [3.6.6] - 2025-11-23

### Added
- **New Claude Model Support**:
  - `claude-opus-4-5-20251101` - Latest Claude Opus 4.5 model
  - Supports web search/retrieval functionality (`:online` suffix)

### Changed
- **Model Constants**: Updated `ALL_ONE_MIN_AVAILABLE_MODELS` to include new Claude model
- **Retrieval Support**: Added new Claude model to `RETRIEVAL_SUPPORTED_MODELS` list

## [3.6.5] - 2025-11-23

### Added
- **New OpenAI GPT-5.1 Models Support**:
  - `gpt-5.1` - Latest GPT-5.1 model
  - `gpt-5.1-codex` - GPT-5.1 model specialized for coding
  - `gpt-5.1-codex-mini` - Lightweight GPT-5.1 coding model
  - All models support web search/retrieval functionality (`:online` suffix)
- **New Google Gemini Model Support**:
  - `gemini-3-pro-preview` - Preview version of Gemini 3 Pro model
  - Supports web search/retrieval functionality (`:online` suffix)

### Changed
- **Model Constants**: Updated `ALL_ONE_MIN_AVAILABLE_MODELS` to include new OpenAI and Google models
- **Retrieval Support**: Added new models to `RETRIEVAL_SUPPORTED_MODELS` list

## [3.6.4] - 2025-11-23

### Changed
- **Code Refactoring**: Extracted shared message processing methods to common utility
  - Created `src/utils/message-processing.ts` with reusable functions
  - `checkForImages()` - Check if messages contain images
  - `processMessages()` - Process and convert image format for API
  - `parseAndValidateModel()` - Parse and validate model names
  - Reduced code duplication between `chat.ts` and `responses.ts`

### Removed
- **Unused Variables**: Removed unused `chunkCount` and `totalChars` variables in streaming handler
- **Debug Logs**: Removed unnecessary production logging in chat and image handlers
  - Removed streaming response start logs
  - Removed image request/response debug logs

### Fixed
- **Code Quality**: Improved maintainability by centralizing shared logic

## [3.6.3] - 2025-11-23

### Added
- **New Claude Models Support**:
  - `claude-haiku-4-5-20251001` - Latest Claude Haiku 4.5 model
  - `claude-sonnet-4-5-20250929` - Latest Claude Sonnet 4.5 model
  - Both models support web search/retrieval functionality (`:online` suffix)

### Changed
- **Model Constants**: Updated `ALL_ONE_MIN_AVAILABLE_MODELS` to include new Claude models
- **Retrieval Support**: Added new Claude models to `RETRIEVAL_SUPPORTED_MODELS` list

## [3.6.2] - 2025-11-23

### Added
- **Vision Support for Grok 4 Fast Models**:
  - `grok-4-fast-reasoning` now supports image input (vision capabilities)
  - `grok-4-fast-non-reasoning` now supports image input (vision capabilities)
  - Both models can process images alongside text in chat completions

### Changed
- **Vision Models**: Added Grok 4 fast models to `VISION_SUPPORTED_MODELS` list
- **Documentation**: Updated README to reflect new vision-capable models

## [3.6.1] - 2025-11-23

### Added
- **New xAI Grok 4 Fast Models Support**:
  - `grok-4-fast-reasoning` - Fast Grok 4 model with reasoning capabilities
  - `grok-4-fast-non-reasoning` - Fast Grok 4 model optimized for speed
  - Both models support web search/retrieval functionality (`:online` suffix)

### Changed
- **Model Constants**: Updated `ALL_ONE_MIN_AVAILABLE_MODELS` to include new Grok 4 fast models
- **Retrieval Support**: Added new Grok 4 fast models to `RETRIEVAL_SUPPORTED_MODELS` list

## [3.6.0] - 2025-10-11

### Added
- **New xAI Grok Models Support**:
  - `grok-3` - Latest Grok model with enhanced capabilities
  - `grok-3-mini` - Lightweight Grok model for faster responses
  - `grok-4-0709` - Advanced Grok model (version 0709)
  - All new Grok models support web search/retrieval functionality (`:online` suffix)
- **New OpenAI Models Support**:
  - `openai/gpt-oss-20b` - OpenAI open source model (20B parameters)
  - `openai/gpt-oss-120b` - OpenAI open source model (120B parameters)

### Changed
- **Model Constants**: Updated `ALL_ONE_MIN_AVAILABLE_MODELS` to include new Grok and OpenAI models
- **Retrieval Support**: Added new Grok models to `RETRIEVAL_SUPPORTED_MODELS` list

## [3.5.5] - 2025-09-01

### Fixed
- **Model List Correction**: Removed `o1-preview` model from supported models list
  - `o1-preview` model is no longer available in the 1min.ai API
  - Updated both main model list and retrieval-supported models list
  - Corrected README.md to reflect current model availability

### Changed
- **Model Constants**: Updated `ALL_ONE_MIN_AVAILABLE_MODELS` and `RETRIEVAL_SUPPORTED_MODELS` to reflect accurate model availability
  - Removed: `o1-preview` (no longer available)
  - Retained: `o1`, `o1-mini` (currently available o1 series models)

## [3.5.4] - 2025-08-20

### Fixed
- **Model List Correction**: Removed non-existent `o1-pro` model from supported models list
  - OpenAI's o1 series only includes: `o1`, and `o1-mini`
  - No `o1-pro` model exists in OpenAI's official API

### Changed
- **Model Constants**: Updated `ALL_ONE_MIN_AVAILABLE_MODELS` to reflect accurate OpenAI model availability
  - Removed: `o1-pro` (non-existent model)
  - Retained: `o1`, `o1-mini` (official o1 series models)

## [3.5.3] - 2025-08-20

### Fixed
- **UTF-8 Encoding Issue in Streaming Responses**: Fixed garbled Chinese characters in streaming chat responses
  - Multi-byte UTF-8 characters (Chinese, Japanese, etc.) were being split across chunk boundaries
  - Implemented `SimpleUTF8Decoder` with proper stream handling to preserve character integrity
  - Characters like `設定檔` no longer appear as `設定�` or `��` in streaming responses

### Added
- **UTF-8 Safe Decoder Utility**: New `src/utils/utf8-decoder.ts` module
  - `SimpleUTF8Decoder` class with proper stream handling for incomplete UTF-8 sequences
  - Prevents replacement characters (�) from appearing in multi-byte text

### Changed
- **Streaming Response Processing**: Updated chat handler to use UTF-8 safe decoding
  - Replaced standard `TextDecoder` with `SimpleUTF8Decoder` in streaming mode
  - Maintains character boundary integrity across chunk splits

### Removed
- **Debug Logging**: Removed extensive debug logging from production code
  - Cleaned up console.log statements in onemin-api.ts and chat.ts
  - Improved performance and reduced noise in production logs

### Technical Details
- The issue occurred because `TextDecoder.decode()` without `stream: true` treats each chunk independently
- Multi-byte UTF-8 characters split across chunks resulted in replacement characters
- New decoder uses `stream: true` option to properly handle incomplete byte sequences

## [3.5.2] - 2025-08-20

### Changed
- **Completed Migration to New Model Capabilities API**:
  - Replaced all usages of deprecated `isVisionSupportedModel` with `supportsVision`
  - Updated `src/handlers/chat.ts` to use `supportsVision`
  - Updated `src/handlers/responses.ts` to use `supportsVision`
  - Updated `src/services/onemin-api.ts` to use `supportsVision` (2 occurrences)

### Removed
- **Deprecated Function Removal**: Completely removed `isVisionSupportedModel` function from `src/utils/image.ts`
  - All functionality now uses the centralized model capabilities system
  - Cleaner codebase with no deprecated functions

### Technical Improvements
- Completed full migration to centralized model capabilities checking
- Improved code consistency across all modules
- Reduced technical debt by removing deprecated code
- Better maintainability with single source of truth for model capabilities

## [3.5.1] - 2025-08-20

### Fixed
- **GPT-5 Vision Support**: Fixed issue where GPT-5 series models (gpt-5, gpt-5-mini, gpt-5-chat-latest) were not properly recognized as vision-capable models
  - The `isVisionSupportedModel` function was using a hardcoded list instead of the centralized `VISION_SUPPORTED_MODELS` constant
  - Now correctly uses the single source of truth from constants

### Added
- **Model Capabilities Utilities**: New centralized model capabilities checking system
  - Added `src/utils/model-capabilities.ts` with comprehensive capability checking functions
  - Functions include: `supportsVision()`, `supportsCodeInterpreter()`, `supportsRetrieval()`, `supportsFunctionCalling()`
  - Added `getModelCapabilities()` to get all capabilities for a model at once
  - Added `validateModelCapabilities()` for validating model requirements

### Changed
- **Refactored Vision Support Check**: Updated `isVisionSupportedModel` to use the new capabilities system
  - Marked as deprecated in favor of `supportsVision()`
  - Maintains backward compatibility while encouraging migration to new API

### Technical Improvements
- Eliminated duplicate model capability definitions
- Established single source of truth for all model capabilities
- Improved maintainability and extensibility of model capability checks
- Better TypeScript type safety for model capabilities

## [3.5.0] - 2025-08-18

### Added
- **Function Calling Support**: Complete implementation of OpenAI-compatible function calling
  - Support for both modern `tools` and legacy `functions` parameters
  - Works with all models via prompt engineering (not limited to OpenAI models)
  - Automatic parsing of function calls from AI responses
  - Compatible with streaming and non-streaming endpoints
  - Support for multiple function calls in a single response
- **Enhanced Authentication**: Added `AUTH_TOKEN` secret configuration
  - Configurable authentication token via `wrangler secret put AUTH_TOKEN`
  - Backwards compatible: if `AUTH_TOKEN` not set, any Bearer token is accepted
  - More secure production deployment option

### Changed
- **Authentication**: Renamed API key references from `YOUR_API_KEY` to `your-auth-token` in documentation
- **Types**: Enhanced response types to support function calling (`tool_calls`, `function_call`)
- **Documentation**: Updated README with comprehensive AUTH_TOKEN setup instructions

### Technical Details
- New types: `Tool`, `FunctionDefinition`, `ToolCall`, `FunctionCall`, `ChatCompletionRequestWithTools`
- New utilities: Function calling conversion, parsing, and response transformation
- Enhanced chat handler with function calling detection and processing
- Streaming support for function calls with proper SSE formatting

## [3.4.0] - 2025-07-31

### Added

- **GPT-5 Series Models Support** - Added support for the complete GPT-5 model family
  - `gpt-5` - Latest GPT-5 base model with vision and code interpreter support
  - `gpt-5-mini` - Lightweight GPT-5 variant with vision support
  - `gpt-5-nano` - Ultra-lightweight GPT-5 for basic tasks
  - `gpt-5-chat-latest` - Latest GPT-5 chat model with vision and code interpreter support
- **Vision Support for GPT-5** - Enabled image input for gpt-5, gpt-5-mini, and gpt-5-chat-latest
- **Code Interpreter for GPT-5** - Enabled code interpreter for gpt-5 and gpt-5-chat-latest
- **Web Search for GPT-5** - All GPT-5 models support the :online suffix for web search

### Changed

- **Image Processing Optimization** - System now only processes images from the latest message, avoiding redundant processing of historical images
- **Removed Debug Logging** - Cleaned up all debug console.log statements for production readiness
- **Streaming Response Preservation** - Fixed logger middleware to not consume streaming response bodies

### Fixed

- **Streaming Response Issue** - Fixed bug where logging middleware was consuming SSE streams, preventing responses from reaching the client
- **Image Reprocessing Bug** - Fixed issue where historical images were being reprocessed with each new message
- **Git Conflict Resolution** - Resolved merge conflicts from TypeScript strict mode changes

## [3.3.0] - 2025-07-28

### Added

- **Strict Null Checks** - Enabled `strictNullChecks: true` for complete null/undefined safety
- **Full TypeScript Strict Mode** - All TypeScript strict checks are now enabled

### Changed

- **TypeScript Configuration** - Enabled `strictNullChecks: true` completing the strict mode migration
- **Null-safe String Operations** - Fixed potential undefined access in IP parsing logic

### Fixed

- **IP Header Parsing** - Fixed potential undefined access when splitting X-Forwarded-For headers
- **Response Type Safety** - Fixed type inference issues in models endpoint
- **Array Access Safety** - Ensured safe array element access with proper null checks

### Technical Details

- Only 4 errors needed fixing to enable strict null checks
- Improved null safety in rate limiting middleware
- Better type inference for JSON responses
- Codebase now fully compliant with TypeScript strict mode

## [3.2.0] - 2025-07-28

### Added

- **Strict TypeScript Type System** - Enabled `noImplicitAny` to enforce explicit typing throughout the codebase
- **Comprehensive Type Definitions** - Added new type definitions for messages, API responses, and 1min.ai specific types
- **Type-safe Message Handling** - Created proper types for text and image content in messages
- **Model Response Types** - Added structured types for model listings and capabilities

### Changed

- **TypeScript Configuration** - Enabled `noImplicitAny: true` for better type safety
- **Removed All `any` Types** - Replaced all implicit and explicit `any` types with proper TypeScript interfaces
- **Enhanced Type Inference** - Improved type narrowing and inference throughout the codebase
- **Service Layer Types** - Added complete typing for OneMinApiService methods and parameters

### Fixed

- **Type Safety Issues** - Fixed all TypeScript compilation errors related to implicit any types
- **Message Content Handling** - Fixed type issues with mixed text/image content arrays
- **Stream Response Types** - Corrected typing for streaming chat completion responses
- **Error Handler Types** - Fixed status code typing in error handler middleware

### Technical Details

- Added 6 new type definition files for comprehensive type coverage
- Migrated from loose typing to strict typing without breaking existing functionality
- Improved developer experience with better IDE autocompletion and type checking
- Prepared codebase for future `strictNullChecks` enablement

## [3.1.0] - 2025-07-28

### Added

- **Enhanced Error Handling System** - Complete rewrite of error handling to match OpenAI API format exactly
- **New Error Classes** - Added `ModelNotFoundError` for better error categorization
- **Unified Error Conversion** - New `toOpenAIError()` function for consistent error formatting
- **Error Response Helper** - Added `createErrorResponseFromError()` for automatic error conversion

### Changed

- **Error Response Format** - All errors now include proper `param` field indicating which parameter caused the error
- **Error Codes** - Added specific error codes like `model_not_found`, `invalid_api_key`, `rate_limit_exceeded`
- **Global Error Handler** - Simplified to use unified error conversion for all error types
- **Error Parameters** - Updated `createErrorResponse()` to accept `param` parameter

### Fixed

- **OpenAI API Compatibility** - Error responses now fully match OpenAI's error format specification
- **Missing Error Fields** - Fixed missing `param` and `code` fields in error responses
- **Error Type Consistency** - Ensured correct error types (`invalid_request_error`, `rate_limit_error`, `api_error`)

### Technical Details

- Centralized error handling logic in `src/utils/errors.ts`
- Updated all handlers to throw typed errors instead of returning error responses
- Global error handler now uses unified error formatting for consistency
- Better TypeScript support with proper error class hierarchy

## [3.0.1] - 2025-07-26

### Fixed

- **Image URL Processing** - Fixed User-Agent header issue preventing image downloads from certain websites
- **Image Placeholder Text** - Removed unnecessary Chinese placeholder text from image processing logic
- **HTTP Image Support** - Enhanced support for HTTP/HTTPS image URLs with proper headers

### Changed

- Improved `processImageUrl` function to include proper User-Agent header for better compatibility
- Cleaned up `extractTextFromContent` function to remove redundant image indicators
- Enhanced error handling for image URL fetching

## [3.0.0] - 2025-07-25

### 🎉 Major Release - Hono Framework Migration

This release represents a complete architectural overhaul, migrating from native Cloudflare Workers to the Hono framework while maintaining 100% API compatibility.

### Added

- **Hono Framework Integration** - Modern web framework with superior type safety and middleware support
- **Enhanced Type System** - Comprehensive TypeScript types with `HonoEnv` environment definitions
- **Unified Middleware Architecture**:
  - Global error handling middleware with structured error responses
  - CORS middleware using Hono's built-in support
  - Authentication middleware for consistent API key validation
  - Rate limiting middleware adapted from existing implementation
- **Modular Route Structure** - Clean separation of routes in dedicated files (`src/routes/`)
- **Custom Error Classes** - `ValidationError`, `AuthenticationError`, `RateLimitError`, `ApiError`
- **Enhanced Error Logging** - Detailed error tracking with stack traces and request context
- **Image Generation Authentication** - Added missing auth middleware to image generation endpoint

### Changed

- **Complete Architecture Rewrite** - Migrated from manual routing to Hono's declarative routing
- **Middleware Execution Order** - Proper middleware chain with error handler at the outermost layer
- **Error Response Format** - Standardized error responses matching OpenAI API format:
  ```json
  {
    "error": {
      "message": "Error description",
      "type": "error_type",
      "param": null,
      "code": "error_code"
    }
  }
  ```
- **File Organization** - New structure with `src/routes/`, dedicated middleware files, and enhanced types
- **Request Processing Flow** - Cleaner, more maintainable request handling pipeline
- **Dependencies** - Added `hono@^4.8.5` and `prettier@^3.6.2` as dev dependency

### Fixed

- **Authentication Error Handling** - Properly returns 401 with structured error when API key is missing
- **Image Generation Errors** - Better error messages with upstream API error details
- **JSON Parsing Errors** - Graceful handling of invalid JSON in request bodies
- **Unhandled Exceptions** - Global error catcher ensures all errors return structured responses

### Technical Details

- **Breaking Changes**: None - maintains full API compatibility
- **Performance**: Maintained edge performance characteristics
- **Type Safety**: Full TypeScript support with enhanced type definitions
- **Middleware Pattern**: Composable middleware with proper error boundaries

### Migration Notes

While this is a major version bump due to the architectural changes, the API remains 100% compatible. No changes are required for existing API consumers.

## [2.11.0] - 2025-07-24

### Added

- **Web Search Integration with `:online` Model Suffix**
  - Add `:online` suffix to any supported model name to enable web search functionality
  - Example usage: `gpt-4o:online`, `claude-3-5-sonnet-20240620:online`
  - Real-time information retrieval with search results integrated into AI responses
  - Supported on both `/v1/chat/completions` and `/v1/responses` endpoints
  - Full streaming support for web search enabled requests
- **Web Search Configuration Options**
  - `WEB_SEARCH_NUM_OF_SITE` environment variable (default: 1)
  - `WEB_SEARCH_MAX_WORD` environment variable (default: 500)
- **Graceful Degradation System**
  - Automatic fallback to standard mode when API doesn't support webSearch parameters
  - `X-WebSearch-Degraded` response header to indicate when degradation occurred
  - Enhanced error logging for monitoring and debugging

### Changed

- Enhanced `OneMinApiService` to support webSearch parameters in both chat and streaming requests
- Updated `ChatHandler` and `ResponseHandler` to integrate model name parsing
- Improved error handling with detailed validation messages for invalid model formats

### Technical

- Added `src/utils/model-parser.ts` - ModelParser class for parsing `:online` suffix and validation
- Updated `src/services/onemin-api.ts` - Added webSearch parameter support and graceful degradation
- Updated `src/handlers/chat.ts` - Integrated model parsing for chat completions
- Updated `src/handlers/responses.ts` - Integrated model parsing for structured responses
- Updated `src/types/env.ts` - Added optional web search configuration environment variables
- Enhanced error handling with automatic retry logic for unsupported webSearch parameters

## [2.10.0] - 2025-07-24

### Added

- New OpenAI models support:
  - `o3-mini`
  - `o4-mini`
  - `gpt-4.5-preview`
  - `gpt-4.1`
  - `gpt-4.1-nano`
  - `gpt-4.1-mini`
- New Claude models support:
  - `claude-3-5-haiku-20241022`
  - `claude-3-7-sonnet-20250219`
- New Gemini models support:
  - `gemini-2.0-flash`
  - `gemini-2.0-flash-lite`
  - `gemini-2.5-flash`
  - `gemini-2.5-pro`
  - `gemini-2.5-flash-preview-05-20`
  - `gemini-2.5-pro-preview-05-06`
- New Meta models support:
  - `meta/meta-llama-3.1-405b-instruct`
  - `meta/llama-4-maverick-instruct`
  - `meta/llama-4-scout-instruct`
- New DeepSeek models support:
  - `deepseek-chat`
  - `deepseek-reasoner`
- New Perplexity Sonar models support:
  - `sonar-reasoning-pro`
  - `sonar-reasoning`
  - `sonar-pro`
  - `sonar`
- New Flux model support:
  - `flux-1.1-pro`
- New Midjourney model support:
  - `midjourney_6_1`

## [2.9.0] - 2025-01-27

### Added

- **OpenAI Responses API** support (`/v1/responses`)
  - Structured output support with JSON objects and JSON schema validation
  - Reasoning effort control (low, medium, high)
  - Enhanced prompting for structured responses
  - Vision support with image inputs (same as Chat Completions)
  - Rate limiting and API key validation
- New `ResponseRequest` interface for Responses API
- `ResponseHandler` class for handling structured outputs and reasoning requests
- Enhanced system prompting based on response format and reasoning effort
- JSON parsing and validation for structured responses

### Changed

- Updated root endpoint to display all available API endpoints
- Enhanced API documentation with Responses API examples
- Improved error handling for structured response parsing

### Technical

- Added `src/handlers/responses.ts` - Main Responses API handler
- Updated `src/constants/config.ts` - Added RESPONSES endpoint constant
- Updated `src/types/requests.ts` - Added ResponseRequest interface
- Updated `src/index.ts` - Added routing and rate limiting for responses endpoint
- Updated `src/handlers/index.ts` - Exported ResponseHandler
- Created comprehensive testing documentation for both APIs

## [2.8.0] - 2025-01-27

### Changed

- Replaced custom UUID generation with native Cloudflare Workers Web Crypto API
- Removed `generateUUID()` wrapper function in favor of direct `crypto.randomUUID()` usage
- Simplified codebase by eliminating unnecessary UUID utility file

### Technical

- Deleted `src/utils/uuid.ts` file
- Updated all UUID generation calls to use `crypto.randomUUID()` directly
- Improved performance and security with native cryptographic UUID generation

## [2.7.0] - 2025-07-15

### Added

- New Claude models support:
  - `claude-sonnet-4-20250514`
  - `claude-opus-4-20250514`

## [2.6.0] - 2025-07-05

### Added

- New Gemini models support:
  - `gemini-2.0-flash`
  - `gemini-2.0-flash-lite`
  - `gemini-2.5-flash-preview-05-20`
  - `gemini-2.5-flash-preview-04-17`
  - `gemini-2.5-pro-preview-05-06`
- New Perplexity Sonar models support:
  - `sonar-reasoning-pro`
  - `sonar-reasoning`
  - `sonar-pro`
  - `sonar`

## [2.5.0] - 2025-07-04

### Added

- Image search capability
- Enhanced image processing and search functionality

## [2.0.0] - 2025-07-03

### Added

- Initial release
- 1min.ai API integration support
- Image generation functionality
- Cloudflare Workers deployment support
- Basic middleware and handler architecture
- Token validation and management features

### Changed

- Updated API response handling logic to use `temporaryUrl` field instead of `images` array

### Technical

- Established TypeScript project structure
- Configured Wrangler deployment environment
- Implemented modular architecture (handlers, services, middleware, utils)
