> Existing behavior reference inside the aggregate implementation context. It is not a separate design node; the enclosing high-level design governs ownership. References to historical task documents identify their Git source.

# Modelflare model inventory

Checked: 2026-10-19. Installed Pi: 0.87.1.

## Scope and evidence

An authenticated, paginated GET /v1/models using the existing Modelflare connection returned **76 exact IDs**. This is the list available to that key at observation time, not a promise of future global availability. The live public pricing page was cross-checked; availability and account groups can differ. The backend registry includes **32 chat models**; **14 image generators**, **28 video generators**, and **2 specialized models** are inventoried below but are not agent chat choices.

Sources: [Modelflare endpoints](https://docs.modelflare.dev/guides/endpoints/), [model families](https://docs.modelflare.dev/models/), [pricing/catalog](https://modelflare.dev/pricing), and each text model's linked provider pricing page. Exact Pi source pairs are explicit; the implementation does not fuzzy-match models or inherit credentials.

## Registered chat models

Context/output limits and reasoning support are inherited from the exact installed Pi model named below, except the three explicitly documented additions. Protocols come from Modelflare's per-model API labels. A context limit is model metadata, not evidence that every account/routing group permits requests of that size.

Protocol abbreviations: A = Anthropic Messages, C = OpenAI Chat Completions, R = OpenAI Responses. Names under Pi refer to registered provider/model pairs.

| Request model ID | Context tokens | Max output tokens | Input | Reasoning | Supported APIs | Metadata source |
| --- | ---: | ---: | --- | --- | --- | --- |
| [`claude-fable-5`](https://modelflare.dev/pricing/claude-fable-5) | 1,000,000 | 128,000 | text, image | Yes | A, C | Pi `anthropic/claude-fable-5` |
| [`claude-fable-5-1`](https://modelflare.dev/pricing/claude-fable-5-1) | 1,000,000 | 128,000 | text, image | Yes | A, C | Pi `anthropic/claude-fable-5-1` |
| [`claude-haiku-4-5`](https://modelflare.dev/pricing/claude-haiku-4-5) | 200,000 | 64,000 | text, image | Yes | A, C | Pi `anthropic/claude-haiku-4-5` |
| [`claude-haiku-5-5`](https://modelflare.dev/pricing/claude-haiku-5-5) | 1,000,000 | 128,000 | text, image | Yes | A, C | [Official documentation](https://platform.claude.com/docs/en/models/haiku-5-5/overview) |
| [`claude-opus-4-8`](https://modelflare.dev/pricing/claude-opus-4-8) | 1,000,000 | 128,000 | text, image | Yes | A, C | Pi `anthropic/claude-opus-4-8` |
| [`claude-opus-5`](https://modelflare.dev/pricing/claude-opus-5) | 1,000,000 | 128,000 | text, image | Yes | A, C | Pi `anthropic/claude-opus-5` |
| [`claude-opus-5-5`](https://modelflare.dev/pricing/claude-opus-5-5) | 1,000,000 | 128,000 | text, image | Yes | A, C | Pi `anthropic/claude-opus-5-5` |
| [`claude-sonnet-5`](https://modelflare.dev/pricing/claude-sonnet-5) | 1,000,000 | 128,000 | text, image | Yes | A, C | Pi `anthropic/claude-sonnet-5` |
| [`claude-sonnet-5-5`](https://modelflare.dev/pricing/claude-sonnet-5-5) | 1,000,000 | 128,000 | text, image | Yes | A, C | [Official documentation](https://platform.claude.com/docs/en/models/sonnet-5-5/overview) |
| [`deepseek-v4-flash`](https://modelflare.dev/pricing/deepseek-v4-flash) | 1,000,000 | 384,000 | text | Yes | C, R | Pi `opencode/deepseek-v4-flash` |
| [`deepseek-v4-pro`](https://modelflare.dev/pricing/deepseek-v4-pro) | 1,000,000 | 384,000 | text | Yes | C | Pi `deepseek/deepseek-v4-pro` |
| [`deepseek-v4.1-flash`](https://modelflare.dev/pricing/deepseek-v4.1-flash) | 1,000,000 | 384,000 | text, image | Yes | C, R | Pi `opencode/deepseek-v4.1-flash` |
| [`gemini-3.1-pro-preview`](https://modelflare.dev/pricing/gemini-3.1-pro-preview) | 1,048,576 | 65,536 | text, image | Yes | C | Pi `google/gemini-3.1-pro-preview` |
| [`gemini-3.5-flash`](https://modelflare.dev/pricing/gemini-3.5-flash) | 1,048,576 | 65,536 | text, image | Yes | C | Pi `google/gemini-3.5-flash` |
| [`gemini-3.6-flash`](https://modelflare.dev/pricing/gemini-3.6-flash) | 1,048,576 | 65,536 | text, image | Yes | C | Pi `google/gemini-3.6-flash` |
| [`gemini-3.8-flash`](https://modelflare.dev/pricing/gemini-3.8-flash) | 1,048,576 | 65,536 | text, image | Yes | C | Pi `google/gemini-3.8-flash` |
| [`glm-5.3`](https://modelflare.dev/pricing/glm-5.3) | 1,000,000 | 131,072 | text | Yes | A, C, R | Pi `zai/glm-5.3` |
| [`glm-5.3-flash`](https://modelflare.dev/pricing/glm-5.3-flash) | 1,000,000 | 131,072 | text, image | Yes | A, C, R | Pi `zai/glm-5.3-flash` |
| [`gpt-5.4`](https://modelflare.dev/pricing/gpt-5.4) | 272,000 | 128,000 | text, image | Yes | C, R | Pi `openai/gpt-5.4` |
| [`gpt-5.5`](https://modelflare.dev/pricing/gpt-5.5) | 272,000 | 128,000 | text, image | Yes | C, R | Pi `openai/gpt-5.5` |
| [`gpt-5.6-sol`](https://modelflare.dev/pricing/gpt-5.6-sol) | 272,000 | 128,000 | text, image | Yes | C, R | Pi `openai/gpt-5.6-sol` |
| [`gpt-5.6-terra`](https://modelflare.dev/pricing/gpt-5.6-terra) | 272,000 | 128,000 | text, image | Yes | C, R | Pi `openai/gpt-5.6-terra` |
| [`gpt-6-astra`](https://modelflare.dev/pricing/gpt-6-astra) | 272,000 | 128,000 | text, image | Yes | C, R | Pi `openai/gpt-6-astra` |
| [`gpt-6-luna`](https://modelflare.dev/pricing/gpt-6-luna) | 272,000 | 128,000 | text, image | Yes | C, R | Pi `openai/gpt-6-luna` |
| [`gpt-6-sol`](https://modelflare.dev/pricing/gpt-6-sol) | 272,000 | 128,000 | text, image | Yes | C, R | Pi `openai/gpt-6-sol` |
| [`gpt-6.1-sol`](https://modelflare.dev/pricing/gpt-6.1-sol) | 1,050,000 | 128,000 | text, image | Yes | C, R | [Official documentation](https://developers.openai.com/api/docs/models/gpt-6.1-sol) |
| [`grok-4.5`](https://modelflare.dev/pricing/grok-4.5) | 500,000 | 500,000 | text, image | Yes | C, R | Pi `xai/grok-4.5` |
| [`grok-4.6`](https://modelflare.dev/pricing/grok-4.6) | 500,000 | 500,000 | text, image | Yes | C, R | Pi `xai/grok-4.6` |
| [`grok-4.7`](https://modelflare.dev/pricing/grok-4.7) | 500,000 | 500,000 | text, image | Yes | C, R | Pi `xai/grok-4.7` |
| [`kimi-k3`](https://modelflare.dev/pricing/kimi-k3) | 1,048,576 | 131,072 | text, image | Yes | A, C, R | Pi `moonshotai/kimi-k3` |
| [`muse-spark-1.3`](https://modelflare.dev/pricing/muse-spark-1.3) | 1,048,576 | 131,072 | text, image | Yes | C | Pi `meta/muse-spark-1.3` |
| [`qwen3.8-max`](https://modelflare.dev/pricing/qwen3.8-max) | 1,000,000 | 131,072 | text, image | Yes | A, C, R | Pi `qwen-token-plan/qwen3.8-max` |

### Reasoning and request constraints

- Reused models keep their exact Pi thinking-level mapping. The config system continues to expose its shared scale and clamp unsupported levels.
- Haiku 5.5: text/image input, 1M context, 128K output, adaptive thinking and low/medium/high/xhigh/max effort. Its optional thinking can be disabled. The backend's existing default remains off; Anthropic's API default is medium when it chooses defaults.
- Sonnet 5.5: text/image input, 1M context, 128K output, adaptive thinking and low/medium/high/xhigh/max effort. Pi 0.87.1 does not expose its newer between_tools thinking mode; the registered off level is therefore unsupported and clamps to low, rather than sending an invalid disabled-thinking request.
- GPT-6.1 Sol: text/image input, 1,050,000 context, 128K output, low/medium/high/xhigh/max reasoning; no none/minimal. Tool calling uses Responses; its Chat Completions endpoint is documented without tool calling. Use a Responses connection for agent work.
- Claude additions force adaptive thinking and omit unsupported temperature. The existing temperature configuration is not a guarantee that every provider/model accepts it; Anthropic's adapter observes supportsTemperature=false.
- The gateway owns transport compatibility. Upstream credentials, headers, prompt-cache terms, routing options, vendor-only extensions and prices are not inherited. Pi cost rates are zero/unpriced because Modelflare billing depends on account group, context tier and promotions; zero metadata does not mean free usage. Consult the live provider bill for costs.
- Per-model API support filters both offline and discovered choices. One connection has one protocol; create separate connections for Anthropic and OpenAI/Responses usage when needed. New unknown discovered IDs keep the existing conservative/unverified behavior.

Thinking sources: [Anthropic effort](https://platform.claude.com/docs/en/build-with-claude/effort), [Sonnet 5.5](https://platform.claude.com/docs/en/models/sonnet-5-5/overview), [Haiku 5.5](https://platform.claude.com/docs/en/models/haiku-5-5/overview), and [GPT-6.1 Sol](https://developers.openai.com/api/docs/models/gpt-6.1-sol).

## Other discovered models

Image/video generation needs different output types and endpoints from an agent text loop. They are recorded without inventing text-token, reasoning or tool-use metadata. The backend does not register them as chat models; known excluded IDs also stay excluded after a refresh.

### Image generators (14)

| Request model ID | Family and contract |
| --- | --- |
| `gemini-2.5-flash-image` | Gemini native generateContent; [provider image documentation](https://docs.modelflare.dev/models/) |
| `gemini-3-pro-image` | Gemini native generateContent; [provider image documentation](https://docs.modelflare.dev/models/) |
| `gemini-3.1-flash-image` | Gemini native generateContent; [provider image documentation](https://docs.modelflare.dev/models/) |
| `gemini-3.1-flash-lite-image` | Gemini native generateContent; [provider image documentation](https://docs.modelflare.dev/models/) |
| `gpt-image-2` | Image generation; [provider image documentation](https://docs.modelflare.dev/models/) |
| `gpt-image-2.5-flare` | Image generation; [provider image documentation](https://docs.modelflare.dev/models/) |
| `gpt-image-2.5-sunburst` | Image generation; [provider image documentation](https://docs.modelflare.dev/models/) |
| `seedream-5-0-lite-260128` | Image generation; [provider image documentation](https://docs.modelflare.dev/models/) |
| `seedream-5-0-lite-nsfw` | Image generation; [provider image documentation](https://docs.modelflare.dev/models/) |
| `seedream-5-0-pro-nsfw` | Image generation; [provider image documentation](https://docs.modelflare.dev/models/) |
| `wan2.7-image` | Image generation; [provider image documentation](https://docs.modelflare.dev/models/) |
| `wan2.7-image-nsfw` | Image generation; [provider image documentation](https://docs.modelflare.dev/models/) |
| `wan2.7-image-pro` | Image generation; [provider image documentation](https://docs.modelflare.dev/models/) |
| `wan2.7-image-pro-nsfw` | Image generation; [provider image documentation](https://docs.modelflare.dev/models/) |

### Video generators (28)

| Request model ID | Family and contract |
| --- | --- |
| `MiniMax-H3` | Asynchronous video task; [provider video documentation](https://docs.modelflare.dev/models/) |
| `MiniMax-H3-nsfw` | Asynchronous video task; [provider video documentation](https://docs.modelflare.dev/models/) |
| `happyhorse-1.1-i2v` | Asynchronous video task; [provider video documentation](https://docs.modelflare.dev/models/) |
| `happyhorse-1.1-r2v` | Asynchronous video task; [provider video documentation](https://docs.modelflare.dev/models/) |
| `happyhorse-1.1-t2v` | Asynchronous video task; [provider video documentation](https://docs.modelflare.dev/models/) |
| `kling-2.5-turbo` | Asynchronous video task; [provider video documentation](https://docs.modelflare.dev/models/) |
| `kling-2.6` | Asynchronous video task; [provider video documentation](https://docs.modelflare.dev/models/) |
| `kling-3.0` | Asynchronous video task; [provider video documentation](https://docs.modelflare.dev/models/) |
| `kling-3.0-omni` | Asynchronous video task; [provider video documentation](https://docs.modelflare.dev/models/) |
| `kling-3.0-turbo` | Asynchronous video task; [provider video documentation](https://docs.modelflare.dev/models/) |
| `kling-o1` | Asynchronous video task; [provider video documentation](https://docs.modelflare.dev/models/) |
| `seedance-2.0` | Asynchronous video task; [provider video documentation](https://docs.modelflare.dev/models/) |
| `seedance-2.0-fast` | Asynchronous video task; [provider video documentation](https://docs.modelflare.dev/models/) |
| `seedance-2.0-mini` | Asynchronous video task; [provider video documentation](https://docs.modelflare.dev/models/) |
| `seedance-2.0-nsfw` | Asynchronous video task; [provider video documentation](https://docs.modelflare.dev/models/) |
| `seedance-2.5` | Asynchronous video task; [provider video documentation](https://docs.modelflare.dev/models/) |
| `seedance-2.5-nsfw` | Asynchronous video task; [provider video documentation](https://docs.modelflare.dev/models/) |
| `wan2.7-i2v` | Asynchronous video task; [provider video documentation](https://docs.modelflare.dev/models/) |
| `wan2.7-i2v-nsfw` | Asynchronous video task; [provider video documentation](https://docs.modelflare.dev/models/) |
| `wan2.7-r2v` | Asynchronous video task; [provider video documentation](https://docs.modelflare.dev/models/) |
| `wan2.7-r2v-nsfw` | Asynchronous video task; [provider video documentation](https://docs.modelflare.dev/models/) |
| `wan2.7-t2v` | Asynchronous video task; [provider video documentation](https://docs.modelflare.dev/models/) |
| `wan2.7-t2v-nsfw` | Asynchronous video task; [provider video documentation](https://docs.modelflare.dev/models/) |
| `wan3.0-video` | Asynchronous video task; [provider video documentation](https://docs.modelflare.dev/models/) |
| `wan3.0-video-nsfw` | Asynchronous video task; [provider video documentation](https://docs.modelflare.dev/models/) |
| `wan3.0-video-prime` | Asynchronous video task; [provider video documentation](https://docs.modelflare.dev/models/) |
| `wan3.0-video-prime-nsfw` | Asynchronous video task; [provider video documentation](https://docs.modelflare.dev/models/) |
| `wan3.0-video-prime-spicy` | Asynchronous video task; [provider video documentation](https://docs.modelflare.dev/models/) |

### Specialized models (2)

| Request model ID | Resolved metadata and reason it is not an agent model |
| --- | --- |
| `jev-1.13` | Decision model with a 32,000-token context, up to 20 questions, and choice/score/noul decisions. It uses a decision request contract rather than generated chat/tool calls. [Official model documentation](https://jev-ai.org/docs/models/). |
| `codex-auto-review` | Specialized approval-review model. OpenAI's published Codex catalog lists text/image input, 272,000 default context (872,000 maximum), and low/medium/high/xhigh/max reasoning. A complete maximum-output/general-agent contract is not established by these sources, so it is not registered with fabricated limits. [Official Codex catalog](https://github.com/openai/codex/blob/main/codex-rs/models-manager/models.json). Modelflare advertises Chat/Responses access but that alone does not establish a general agent contract. |

## Maintenance

This is a dated inventory. Adding a predefined chat model requires an explicit exact upstream mapping or a reviewed official capability definition, provider-supported API information, and a regression check. Changes are made in backend source and deployed with the application. Existing user connections, keys, member selections and histories are not rewritten by registration.
