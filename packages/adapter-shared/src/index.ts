/**
 * @chat-adapter/shared
 *
 * Shared utilities for chat SDK adapters.
 * Reduces code duplication across adapter implementations.
 */

// Adapter utilities
export { extractCard, extractFiles } from "./adapter-utils";

// Card conversion utilities
export {
  BUTTON_STYLE_MAPPINGS,
  cardToFallbackText,
  createEmojiConverter,
  type FallbackTextOptions,
  mapButtonStyle,
  type PlatformName,
} from "./card-utils";

// Standardized adapter errors
export {
  AdapterError,
  AdapterRateLimitError,
  AuthenticationError,
  NetworkError,
  PermissionError,
  ResourceNotFoundError,
  ValidationError,
} from "./errors";
