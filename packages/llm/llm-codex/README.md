# Codex LLM

Runs the official Codex app-server with the existing official account login. Each Harness session retains one process and thread; changing the chosen model creates a new connection. Native execution features, search, inherited MCP servers and plugins are disabled on these threads. Environment and capability selections are empty, with a read-only native sandbox. The adapter uses the host's dynamic tools so Harness authorization remains responsible for execution. Global Codex configuration and the user's model selection are unchanged.

## Model Experience

The first request includes the recorded instructions and conversation. Later requests deliver only newly recorded user, developer and system messages. Tool results answer their exact call ids, preserve failures, and include new child-agent relays or notices before generation continues. Already delivered messages are not replayed. The retained thread preserves the provider context and avoids reinitialization between tools or turns. The official code-mode host remains enabled to dispatch dynamic Harness tools; disabling it prevents delegation as well. Execution authority remains in the Harness tool guards.

## Known Limitations and Deferred Work

Text blocks are supported; image and attachment projections have not been implemented. A process connection expires after ten idle minutes; a later request rebuilds its thread from the recorded history. Provider-side context limits and usage quotas still apply. Native capability switches depend on the official runtime; configuration was accepted by local 0.160.0, and future runtime changes require revalidation. Configuration discovery fails closed. Native MCP server ids must contain only letters, numbers, underscores or hyphens for safe flat overrides; other ids fail with an explicit configuration error. No separate invariant plugin is installed because message delivery is owned by this adapter; protocol regressions and desktop delegation exercise it directly.
