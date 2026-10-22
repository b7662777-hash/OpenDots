/**
 * AI provider configuration.
 *
 * Supports two providers:
 * - `openai` (default): uses OPENAI_API_KEY, OPENAI_MODEL, and OPENAI_BASE_URL.
 * - `gemini`: uses GEMINI_API_KEY and GEMINI_MODEL with Google's
 *   OpenAI-compatible endpoint at generativelanguage.googleapis.com.
 *
 * The selected provider is set with the AI_PROVIDER environment variable.
 * Both providers use the existing `openaiCompatibleText` TanStack AI adapter
 * so streaming, tool calling, and multi-turn conversations work identically.
 */

export type AIProvider = 'openai' | 'gemini';
const VALID_PROVIDERS: readonly AIProvider[] = ['openai', 'gemini'];

const GEMINI_OPENAI_COMPATIBLE_BASE_URL =
  'https://generativelanguage.googleapis.com/v1beta/openai/';

export interface ProviderCredentials {
  provider: AIProvider;
  apiKey?: string;
  model?: string;
  baseUrl: string;
}

/**
 * Resolve provider credentials from environment variables.
 *
 * Never logs or exposes API keys. Returns typed credentials for use
 * in the adapter and setup-status logic.
 */
export function resolveProvider(
  env: Record<string, string | undefined>,
): ProviderCredentials {
  const raw = env.AI_PROVIDER?.trim().toLowerCase();
  const provider: AIProvider =
    raw && VALID_PROVIDERS.includes(raw as AIProvider)
      ? (raw as AIProvider)
      : raw
        ? (() => {
            throw new Error(
              `AI_PROVIDER must be "openai" or "gemini"; got "${raw}".`,
            );
          })()
        : 'openai';

  if (provider === 'gemini') {
    return {
      provider,
      apiKey: env.GEMINI_API_KEY?.trim() || undefined,
      model: env.GEMINI_MODEL?.trim() || undefined,
      baseUrl: GEMINI_OPENAI_COMPATIBLE_BASE_URL,
    };
  }

  return {
    provider,
    apiKey: env.OPENAI_API_KEY?.trim() || undefined,
    model: env.OPENAI_MODEL?.trim() || undefined,
    baseUrl: env.OPENAI_BASE_URL?.trim() || 'https://api.openai.com/v1',
  };
}

/**
 * Return human-readable labels for missing credentials based on the
 * selected provider. Used in setup-status reporting.
 */
export function missingProviderLabels(
  credentials: ProviderCredentials,
): string[] {
  if (credentials.provider === 'gemini') {
    return [
      !credentials.apiKey && 'GEMINI_API_KEY',
      !credentials.model && 'GEMINI_MODEL',
    ].filter((item): item is string => !!item);
  }
  return [
    !credentials.apiKey && 'OPENAI_API_KEY',
    !credentials.model && 'OPENAI_MODEL',
  ].filter((item): item is string => !!item);
}
