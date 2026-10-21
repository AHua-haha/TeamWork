/** Modelflare catalog researched 2026-10-19. Provenance: docs/tasks/2026-10-19-modelflare-provider/models.md. */
export const inheritedModels = [
  {
    "id": "claude-fable-5",
    "provider": "anthropic"
  },
  {
    "id": "claude-fable-5-1",
    "provider": "anthropic"
  },
  {
    "id": "claude-haiku-4-5",
    "provider": "anthropic"
  },
  {
    "id": "claude-opus-4-8",
    "provider": "anthropic"
  },
  {
    "id": "claude-opus-5",
    "provider": "anthropic"
  },
  {
    "id": "claude-opus-5-5",
    "provider": "anthropic"
  },
  {
    "id": "claude-sonnet-5",
    "provider": "anthropic"
  },
  {
    "id": "deepseek-v4-flash",
    "provider": "opencode"
  },
  {
    "id": "deepseek-v4-pro",
    "provider": "deepseek"
  },
  {
    "id": "deepseek-v4.1-flash",
    "provider": "opencode"
  },
  {
    "id": "gemini-3.1-pro-preview",
    "provider": "google"
  },
  {
    "id": "gemini-3.5-flash",
    "provider": "google"
  },
  {
    "id": "gemini-3.6-flash",
    "provider": "google"
  },
  {
    "id": "gemini-3.8-flash",
    "provider": "google"
  },
  {
    "id": "glm-5.3",
    "provider": "zai"
  },
  {
    "id": "glm-5.3-flash",
    "provider": "zai"
  },
  {
    "id": "gpt-5.4",
    "provider": "openai"
  },
  {
    "id": "gpt-5.5",
    "provider": "openai"
  },
  {
    "id": "gpt-5.6-sol",
    "provider": "openai"
  },
  {
    "id": "gpt-5.6-terra",
    "provider": "openai"
  },
  {
    "id": "gpt-6-astra",
    "provider": "openai"
  },
  {
    "id": "gpt-6-luna",
    "provider": "openai"
  },
  {
    "id": "gpt-6-sol",
    "provider": "openai"
  },
  {
    "id": "grok-4.5",
    "provider": "xai"
  },
  {
    "id": "grok-4.6",
    "provider": "xai"
  },
  {
    "id": "grok-4.7",
    "provider": "xai"
  },
  {
    "id": "kimi-k3",
    "provider": "moonshotai"
  },
  {
    "id": "muse-spark-1.3",
    "provider": "meta"
  },
  {
    "id": "qwen3.8-max",
    "provider": "qwen-token-plan"
  }
] as const;

export const supportedModelApis = {
  "claude-fable-5": [
    "anthropic-messages",
    "openai-completions"
  ],
  "claude-fable-5-1": [
    "anthropic-messages",
    "openai-completions"
  ],
  "claude-haiku-4-5": [
    "anthropic-messages",
    "openai-completions"
  ],
  "claude-haiku-5-5": [
    "anthropic-messages",
    "openai-completions"
  ],
  "claude-opus-4-8": [
    "anthropic-messages",
    "openai-completions"
  ],
  "claude-opus-5": [
    "anthropic-messages",
    "openai-completions"
  ],
  "claude-opus-5-5": [
    "anthropic-messages",
    "openai-completions"
  ],
  "claude-sonnet-5": [
    "anthropic-messages",
    "openai-completions"
  ],
  "claude-sonnet-5-5": [
    "anthropic-messages",
    "openai-completions"
  ],
  "deepseek-v4-flash": [
    "openai-completions",
    "openai-responses"
  ],
  "deepseek-v4-pro": [
    "openai-completions"
  ],
  "deepseek-v4.1-flash": [
    "openai-completions",
    "openai-responses"
  ],
  "gemini-3.1-pro-preview": [
    "openai-completions"
  ],
  "gemini-3.5-flash": [
    "openai-completions"
  ],
  "gemini-3.6-flash": [
    "openai-completions"
  ],
  "gemini-3.8-flash": [
    "openai-completions"
  ],
  "glm-5.3": [
    "anthropic-messages",
    "openai-completions",
    "openai-responses"
  ],
  "glm-5.3-flash": [
    "anthropic-messages",
    "openai-completions",
    "openai-responses"
  ],
  "gpt-5.4": [
    "openai-completions",
    "openai-responses"
  ],
  "gpt-5.5": [
    "openai-completions",
    "openai-responses"
  ],
  "gpt-5.6-sol": [
    "openai-completions",
    "openai-responses"
  ],
  "gpt-5.6-terra": [
    "openai-completions",
    "openai-responses"
  ],
  "gpt-6-astra": [
    "openai-completions",
    "openai-responses"
  ],
  "gpt-6-luna": [
    "openai-completions",
    "openai-responses"
  ],
  "gpt-6-sol": [
    "openai-completions",
    "openai-responses"
  ],
  "gpt-6.1-sol": [
    "openai-completions",
    "openai-responses"
  ],
  "grok-4.5": [
    "openai-completions",
    "openai-responses"
  ],
  "grok-4.6": [
    "openai-completions",
    "openai-responses"
  ],
  "grok-4.7": [
    "openai-completions",
    "openai-responses"
  ],
  "kimi-k3": [
    "anthropic-messages",
    "openai-completions",
    "openai-responses"
  ],
  "muse-spark-1.3": [
    "openai-completions"
  ],
  "qwen3.8-max": [
    "anthropic-messages",
    "openai-completions",
    "openai-responses"
  ]
} as const;

export const unsupportedModels = new Set<string>([
  "MiniMax-H3",
  "MiniMax-H3-nsfw",
  "codex-auto-review",
  "gemini-2.5-flash-image",
  "gemini-3-pro-image",
  "gemini-3.1-flash-image",
  "gemini-3.1-flash-lite-image",
  "gpt-image-2",
  "gpt-image-2.5-flare",
  "gpt-image-2.5-sunburst",
  "happyhorse-1.1-i2v",
  "happyhorse-1.1-r2v",
  "happyhorse-1.1-t2v",
  "jev-1.13",
  "kling-2.5-turbo",
  "kling-2.6",
  "kling-3.0",
  "kling-3.0-omni",
  "kling-3.0-turbo",
  "kling-o1",
  "seedance-2.0",
  "seedance-2.0-fast",
  "seedance-2.0-mini",
  "seedance-2.0-nsfw",
  "seedance-2.5",
  "seedance-2.5-nsfw",
  "seedream-5-0-lite-260128",
  "seedream-5-0-lite-nsfw",
  "seedream-5-0-pro-nsfw",
  "wan2.7-i2v",
  "wan2.7-i2v-nsfw",
  "wan2.7-image",
  "wan2.7-image-nsfw",
  "wan2.7-image-pro",
  "wan2.7-image-pro-nsfw",
  "wan2.7-r2v",
  "wan2.7-r2v-nsfw",
  "wan2.7-t2v",
  "wan2.7-t2v-nsfw",
  "wan3.0-video",
  "wan3.0-video-nsfw",
  "wan3.0-video-prime",
  "wan3.0-video-prime-nsfw",
  "wan3.0-video-prime-spicy"
]);
