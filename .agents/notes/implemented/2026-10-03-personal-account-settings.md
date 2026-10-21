# Personal Desktop account settings and identity

The personal profile now contributes a native Gemini account Settings page. It uses existing slot registration, framework-bound observable hooks, the shared Button primitive, CSS Modules, semantic tokens, and typed locale dictionaries. Components receive only safe state and account-specific callbacks.

Main-process operations accept only account `1` or `2`, validate the primary application frame, and launch the existing official OAuth-only CLI wrapper with fixed arguments. One login request per slot owns its cancellation and timeout. A verified state requires both a successful native structured result and an actual `OK` response. Raw CLI output, credentials, and authorization callback URLs never cross the bridge. Shutdown cancels owned login processes.

Personal configuration hides upstream sidebar and hero marks, replaces the sidebar name and hero copy, and disables the upstream DeepSeek account UI. Generic Sidebar and Conversation defaults remain the original defaults. The migration helper appends missing interface rows without rewriting user profile text. Future patches follow neighboring implementations and avoid unrelated refactors.

Google rejects the installed Gemini CLI 0.62.0 individual-account authentication as `UNSUPPORTED_CLIENT`. This feature reports that condition and does not claim successful dual-account inference. Official Antigravity CLI installation is separate from verified account isolation and Harness integration.
