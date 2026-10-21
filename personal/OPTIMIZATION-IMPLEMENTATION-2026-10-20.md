# Personal Desktop optimization implementation plan

Goal: correct Codex verification routing, centralize Windows-MCP execution in Electron Main, and observe real model request routes without changing user-selected models or account data.

User-approved ownership: Codex implements items 1–3; Gemini implements the personal-mode upgrade IPC correction and startup measurements/optimization (items 4–5). Sonnet performs the final independent acceptance and comparison. No recursive agents or additional implementation workers.

Gemini owns preload-app.ts, preload-mandatory-overlay.ts, dev.ts, prepare-primary-runtime.ts and their new startup tests/helpers. Codex owns main.ts, host-process.ts, personal account/control/diagnostics modules, the Windows-MCP provider, desktop-host observation/IPC integration and affected UI protocol consumers. Do not overwrite the other implementer's edits. Main-process flags required by Gemini are coordinated separately.

## Execution and acceptance

- [ ] Add behavioral regressions for mixed-provider Codex verification, changed selections and no selected Codex model. Parse patch entries with existing YAML support; resolve the selected provider/model together at request time, without executing YAML expressions or picking an unselected fallback.
- [ ] Add FIFO/cancellation regressions for Windows-MCP: queued and active cancellation, stop/resume, stale completion, App/Clipboard as well as keyboard/mouse calls, teardown and listener cleanup. Route Host calls over the existing private parent IPC; Main owns the sole Windows-MCP connection. Preserve raw image blocks through the existing MCP tool projection.
- [ ] Add real-composition tests for Host request observation. Forward only request/session identity, role, selected route, lifecycle/timing and outcome; exclude prompts, keys, raw provider errors and tool arguments. Track unknown separately from matched/mismatched, and prevent late events or subagent routes replacing the primary route.
- [ ] Update account and diagnostics UI types/copy, runtime consumers and focused README/upgrade notes. Preserve generic subagent functionality and primary-only desktop enforcement.
- [ ] Run focused behavior suites, affected TypeScript builds and runtime bundles. Test the actual child-process IPC path with isolated fixtures, then perform a safe read-only Windows-MCP check after coordinated application restart. Do not equate local/mock checks with remote-model acceptance.
- [ ] Collect Gemini's scoped evidence, run combined regression checks and ask Sonnet to independently examine both changed file sets and evidence; repair actionable findings and repeat relevant checks. Keep fairness: compare correctness, regressions, simplicity and evidence, not raw test counts.

Existing source baseline and the live profile's SHA-256 are recorded under `.artifacts/optimization-codex-baseline-20261020/`. The profile and saved credentials are not implementation targets. No commit, reset, clean, model substitution or remote paid test is required for local validation.
