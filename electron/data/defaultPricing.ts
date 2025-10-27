// Default pricing for LLM providers
// Rates are per 1 million tokens in USD
// Updated: January 2025
// Users can customize these rates in Settings

export type ModelPricing = {
  inputCostPer1M: number        // Cost per 1M input tokens
  outputCostPer1M: number       // Cost per 1M output tokens
  cachedInputCostPer1M?: number // Cost per 1M cached input tokens (for Gemini context caching)
}

export type ProviderPricing = {
  [modelId: string]: ModelPricing
}

export type PricingConfig = {
  openai: ProviderPricing
  anthropic: ProviderPricing
  gemini: ProviderPricing
  fireworks: ProviderPricing
  customRates: boolean  // Flag to indicate if user has customized rates
}

export const DEFAULT_PRICING: PricingConfig = {
  openai: {
    // GPT-5 models
    'gpt-5': { inputCostPer1M: 1.25, outputCostPer1M: 10.00 },
    'gpt-5-mini': { inputCostPer1M: 0.25, outputCostPer1M: 2.00 },
    'gpt-5-nano': { inputCostPer1M: 0.05, outputCostPer1M: 0.40 },
    'gpt-5-chat-latest': { inputCostPer1M: 1.25, outputCostPer1M: 10.00 },
    'gpt-5-codex': { inputCostPer1M: 1.25, outputCostPer1M: 10.00 },
    'gpt-5-pro': { inputCostPer1M: 15.00, outputCostPer1M: 120.00 },

    // GPT-4.1 models
    'gpt-4.1': { inputCostPer1M: 2.00, outputCostPer1M: 8.00 },
    'gpt-4.1-mini': { inputCostPer1M: 0.40, outputCostPer1M: 1.60 },
    'gpt-4.1-nano': { inputCostPer1M: 0.10, outputCostPer1M: 0.40 },

    // GPT-4o models
    'gpt-4o': { inputCostPer1M: 2.50, outputCostPer1M: 10.00 },
    'gpt-4o-2024-11-20': { inputCostPer1M: 2.50, outputCostPer1M: 10.00 },
    'gpt-4o-2024-08-06': { inputCostPer1M: 2.50, outputCostPer1M: 10.00 },
    'gpt-4o-2024-05-13': { inputCostPer1M: 5.00, outputCostPer1M: 15.00 },
    'gpt-4o-mini': { inputCostPer1M: 0.15, outputCostPer1M: 0.60 },
    'gpt-4o-mini-2024-07-18': { inputCostPer1M: 0.15, outputCostPer1M: 0.60 },

    // Realtime models
    'gpt-realtime': { inputCostPer1M: 4.00, outputCostPer1M: 16.00 },
    'gpt-realtime-mini': { inputCostPer1M: 0.60, outputCostPer1M: 2.40 },
    'gpt-4o-realtime-preview': { inputCostPer1M: 5.00, outputCostPer1M: 20.00 },
    'gpt-4o-mini-realtime-preview': { inputCostPer1M: 0.60, outputCostPer1M: 2.40 },

    // Audio models
    'gpt-audio': { inputCostPer1M: 2.50, outputCostPer1M: 10.00 },
    'gpt-audio-mini': { inputCostPer1M: 0.60, outputCostPer1M: 2.40 },
    'gpt-4o-audio-preview': { inputCostPer1M: 2.50, outputCostPer1M: 10.00 },
    'gpt-4o-mini-audio-preview': { inputCostPer1M: 0.15, outputCostPer1M: 0.60 },

    // o-series models
    'o1': { inputCostPer1M: 15.00, outputCostPer1M: 60.00 },
    'o1-2024-12-17': { inputCostPer1M: 15.00, outputCostPer1M: 60.00 },
    'o1-preview': { inputCostPer1M: 15.00, outputCostPer1M: 60.00 },
    'o1-preview-2024-09-12': { inputCostPer1M: 15.00, outputCostPer1M: 60.00 },
    'o1-mini': { inputCostPer1M: 1.10, outputCostPer1M: 4.40 },
    'o1-mini-2024-09-12': { inputCostPer1M: 1.10, outputCostPer1M: 4.40 },
    'o1-pro': { inputCostPer1M: 150.00, outputCostPer1M: 600.00 },
    'o3-pro': { inputCostPer1M: 20.00, outputCostPer1M: 80.00 },
    'o3': { inputCostPer1M: 2.00, outputCostPer1M: 8.00 },
    'o3-deep-research': { inputCostPer1M: 10.00, outputCostPer1M: 40.00 },
    'o3-mini': { inputCostPer1M: 1.10, outputCostPer1M: 4.40 },
    'o4-mini': { inputCostPer1M: 1.10, outputCostPer1M: 4.40 },
    'o4-mini-deep-research': { inputCostPer1M: 2.00, outputCostPer1M: 8.00 },

    // Codex models
    'codex-mini-latest': { inputCostPer1M: 1.50, outputCostPer1M: 6.00 },

    // Search models
    'gpt-4o-mini-search-preview': { inputCostPer1M: 0.15, outputCostPer1M: 0.60 },
    'gpt-4o-search-preview': { inputCostPer1M: 2.50, outputCostPer1M: 10.00 },

    // Computer use
    'computer-use-preview': { inputCostPer1M: 3.00, outputCostPer1M: 12.00 },

    // Image generation (output cost is 0 as it's priced per image, not per token)
    'gpt-image-1': { inputCostPer1M: 5.00, outputCostPer1M: 0.00 },
    'gpt-image-1-mini': { inputCostPer1M: 2.00, outputCostPer1M: 0.00 },

    // GPT-4 Turbo (legacy)
    'gpt-4-turbo': { inputCostPer1M: 10.00, outputCostPer1M: 30.00 },
    'gpt-4-turbo-2024-04-09': { inputCostPer1M: 10.00, outputCostPer1M: 30.00 },
    'gpt-4-turbo-preview': { inputCostPer1M: 10.00, outputCostPer1M: 30.00 },

    // GPT-4 (legacy)
    'gpt-4': { inputCostPer1M: 30.00, outputCostPer1M: 60.00 },
    'gpt-4-0613': { inputCostPer1M: 30.00, outputCostPer1M: 60.00 },

    // GPT-3.5 Turbo (legacy)
    'gpt-3.5-turbo': { inputCostPer1M: 0.50, outputCostPer1M: 1.50 },
    'gpt-3.5-turbo-0125': { inputCostPer1M: 0.50, outputCostPer1M: 1.50 },
  },

  anthropic: {
    // Claude Opus 4.1
    'claude-opus-4.1': { inputCostPer1M: 15.00, outputCostPer1M: 75.00, cachedInputCostPer1M: 1.50 },
    'claude-opus-4-20250514': { inputCostPer1M: 15.00, outputCostPer1M: 75.00, cachedInputCostPer1M: 1.50 },

    // Claude Sonnet 4.5
    'claude-sonnet-4.5': { inputCostPer1M: 3.00, outputCostPer1M: 15.00, cachedInputCostPer1M: 0.30 },
    'claude-sonnet-4-20250514': { inputCostPer1M: 3.00, outputCostPer1M: 15.00, cachedInputCostPer1M: 0.30 },

    // Claude Haiku 4.5
    'claude-haiku-4.5': { inputCostPer1M: 1.00, outputCostPer1M: 5.00, cachedInputCostPer1M: 0.10 },
    'claude-haiku-4-5-20251001': { inputCostPer1M: 1.00, outputCostPer1M: 5.00, cachedInputCostPer1M: 0.10 },
    'claude-haiku-4-20250514': { inputCostPer1M: 1.00, outputCostPer1M: 5.00, cachedInputCostPer1M: 0.10 },

    // Claude Haiku 3.5
    'claude-haiku-3.5': { inputCostPer1M: 0.80, outputCostPer1M: 4.00 },
    'claude-3-5-haiku-20241022': { inputCostPer1M: 0.80, outputCostPer1M: 4.00 },

    // Claude 3.5 Sonnet (legacy)
    'claude-3-5-sonnet-20241022': { inputCostPer1M: 3.00, outputCostPer1M: 15.00, cachedInputCostPer1M: 0.30 },
    'claude-3-5-sonnet-20240620': { inputCostPer1M: 3.00, outputCostPer1M: 15.00, cachedInputCostPer1M: 0.30 },

    // Claude 3 Opus (legacy)
    'claude-3-opus-20240229': { inputCostPer1M: 15.00, outputCostPer1M: 75.00, cachedInputCostPer1M: 1.50 },

    // Claude 3 Sonnet (legacy)
    'claude-3-sonnet-20240229': { inputCostPer1M: 3.00, outputCostPer1M: 15.00, cachedInputCostPer1M: 0.30 },

    // Claude 3 Haiku (legacy)
    'claude-3-haiku-20240307': { inputCostPer1M: 0.25, outputCostPer1M: 1.25, cachedInputCostPer1M: 0.03 },
  },

  gemini: {
    // Gemini 2.5 Pro (with context caching - 75% discount on cached tokens)
    'gemini-2.5-pro': { inputCostPer1M: 1.25, outputCostPer1M: 10.00, cachedInputCostPer1M: 0.3125 },

    // Gemini 2.5 Flash (with context caching - 75% discount on cached tokens)
    'gemini-2.5-flash': { inputCostPer1M: 0.30, outputCostPer1M: 2.50, cachedInputCostPer1M: 0.075 },
    'gemini-2.5-flash-preview-09-2025': { inputCostPer1M: 0.30, outputCostPer1M: 2.50, cachedInputCostPer1M: 0.075 },

    // Gemini 2.5 Flash-Lite (with context caching - 75% discount on cached tokens)
    'gemini-2.5-flash-lite': { inputCostPer1M: 0.10, outputCostPer1M: 0.40, cachedInputCostPer1M: 0.025 },
    'gemini-2.5-flash-lite-preview-09-2025': { inputCostPer1M: 0.10, outputCostPer1M: 0.40, cachedInputCostPer1M: 0.025 },

    // Gemini 2.5 Flash Native Audio
    'gemini-2.5-flash-preview-native-audio-dialog': { inputCostPer1M: 0.50, outputCostPer1M: 2.00 },

    // Gemini 2.5 Flash Image
    'gemini-2.5-flash-image': { inputCostPer1M: 0.30, outputCostPer1M: 0.00 },

    // Gemini 2.5 Flash TTS
    'gemini-2.5-flash-preview-tts': { inputCostPer1M: 0.50, outputCostPer1M: 10.00 },

    // Gemini 2.5 Pro TTS
    'gemini-2.5-pro-preview-tts': { inputCostPer1M: 1.00, outputCostPer1M: 20.00 },

    // Gemini 2.5 Computer Use
    'gemini-2.5-computer-use-preview-10-2025': { inputCostPer1M: 1.25, outputCostPer1M: 10.00 },

    // Gemini 2.0 Flash
    'gemini-2.0-flash': { inputCostPer1M: 0.10, outputCostPer1M: 0.40 },
    'gemini-2.0-flash-exp': { inputCostPer1M: 0.00, outputCostPer1M: 0.00 }, // Free tier
    'gemini-2.0-flash-thinking-exp-1219': { inputCostPer1M: 0.00, outputCostPer1M: 0.00 }, // Free tier

    // Gemini 2.0 Flash-Lite
    'gemini-2.0-flash-lite': { inputCostPer1M: 0.075, outputCostPer1M: 0.30 },

    // Gemini 1.5 Pro
    'gemini-1.5-pro': { inputCostPer1M: 1.25, outputCostPer1M: 5.00 },
    'gemini-1.5-pro-002': { inputCostPer1M: 1.25, outputCostPer1M: 5.00 },
    'gemini-1.5-pro-001': { inputCostPer1M: 1.25, outputCostPer1M: 5.00 },
    'gemini-1.5-pro-exp-0827': { inputCostPer1M: 0.00, outputCostPer1M: 0.00 }, // Experimental

    // Gemini 1.5 Flash
    'gemini-1.5-flash': { inputCostPer1M: 0.075, outputCostPer1M: 0.30 },
    'gemini-1.5-flash-002': { inputCostPer1M: 0.075, outputCostPer1M: 0.30 },
    'gemini-1.5-flash-001': { inputCostPer1M: 0.075, outputCostPer1M: 0.30 },
    'gemini-1.5-flash-8b': { inputCostPer1M: 0.0375, outputCostPer1M: 0.15 },
    'gemini-1.5-flash-8b-001': { inputCostPer1M: 0.0375, outputCostPer1M: 0.15 },

    // Gemini 1.0 Pro
    'gemini-1.0-pro': { inputCostPer1M: 0.50, outputCostPer1M: 1.50 },
    'gemini-1.0-pro-001': { inputCostPer1M: 0.50, outputCostPer1M: 1.50 },
    'gemini-1.0-pro-002': { inputCostPer1M: 0.50, outputCostPer1M: 1.50 },

    // Gemini Embedding
    'gemini-embedding-001': { inputCostPer1M: 0.15, outputCostPer1M: 0.00 },

    // Gemini Robotics
    'gemini-robotics-er-1.5-preview': { inputCostPer1M: 0.30, outputCostPer1M: 2.50 },

    // Gemma (open models - free)
    'gemma-3': { inputCostPer1M: 0.00, outputCostPer1M: 0.00 },
    'gemma-3n': { inputCostPer1M: 0.00, outputCostPer1M: 0.00 },
  },

  // Fireworks.ai
  fireworks: {
    // Sensible defaults requested by user
    'accounts/fireworks/models/qwen3-coder-480b-a35b-instruct': { inputCostPer1M: 0.45, outputCostPer1M: 1.80 },
    'accounts/fireworks/models/glm-4p6': { inputCostPer1M: 0.55, outputCostPer1M: 2.19 },
    'accounts/fireworks/models/kimi-k2-instruct-0905': { inputCostPer1M: 0.60, outputCostPer1M: 2.50 },
    'accounts/fireworks/models/deepseek-v3p1-terminus': { inputCostPer1M: 0.56, outputCostPer1M: 1.68 },
  },

  customRates: false
}

