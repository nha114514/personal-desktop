# Personal Desktop

Build a private Windows desktop agent by reusing the complete MIT-licensed DeepSeek Harness Electron application. Keep the upstream runtime, workspace browser, permissions, sessions, task jobs, and account login. Source attribution and licenses remain in the repository.

Use a distinct application identity and an isolated data directory beside this checkout. The personal build does not contact the upstream update service or overwrite an official installation. Chinese is the initial interface language; subsequent user preferences remain authoritative.

The personal preset retains the standard tools and enables the existing official Codex app-server provider. Codex keeps its native account authentication and configuration. The controlling model initially uses DeepSeek's supported account provider, without requiring an API key. Account login and successful live inference are separate acceptance checks.

MiMo can be attached through the existing ACP provider after its official client can successfully run `acp`. Do not extract Desktop cookies or transfer account credentials. Gemini CLI is unavailable because its real account request returned `UNSUPPORTED_CLIENT`; the latest instruction supersedes work on that route.

Acceptance: build the source, verify configuration composition and bootstrap preservation, run focused identity/provider tests, launch Electron, inspect the real interface, and state which external account calls were actually verified.

## Implementation

- [x] Add personal identity and isolate upstream updates behind `DSH_DESKTOP_PERSONAL=1`, preserving upstream defaults.
- [x] Include the existing Codex and ACP providers in the desktop CLI runtime closure.
- [x] Create a Chinese personal preset, account-only initial model choice, and instructions for local work.
- [x] Add idempotent initialization and a Windows launcher with separate home and user-data directories.
- [x] Implement `@deepseek-ai/dsh-llm-codex` provider with `gpt-6.1-sol` as default main model, 6 reasoning effort levels, and tool calling.
- [x] Provide multi-model task selection: web search (`deepseek-v4-flash`), title generation (`deepseek-flash`), subagents (`subagent_codex` & `subagent`).
- [x] Enable model selection and effort level settings for subagent delegations with durable profile settings.
- [x] Implement `@deepseek-ai/dsh-subagent-default-model` for default subagent model configuration and auto-delegation.
- [x] Implement `@deepseek-ai/dsh-llm-gemini` providing Google Gemini models (`gemini-2.5-pro`, `gemini-2.5-flash`, etc.) with reasoning efforts for subagent usage.
- [x] Dedicated subagent settings UI page in Plugins -> 子智能体 for configuring allowed models, limits, and delegation.
- [x] Set default subagent model to Gemini (`gemini/gemini-2.5-flash`) with auto-delegation for execution tasks.
- [x] Fix Codex app-server reasoning effort protocol seam by mapping `effort` in `turn/start` and `thread/settings/update` with live app-server verification.
- [x] Isolate subagent default model configuration to prevent leaking into dedicated providers (`subagent_codex`, `subagent_mimo`) and enforce `capabilities.agentOptions: false` guards.
- [x] Build and run focused checks, inspect the real desktop, and document account readiness and live quota behavior.

