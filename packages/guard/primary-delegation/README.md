# Primary Delegation

The deployment supplies `allowedTools`, an exact list of coordination tools, and optional `primaryOnlyToolPrefixes` (default `[]`). Primary sessions see the coordination tools and tools matching those prefixes; the executor denies all other tools. Delegated sessions cannot see or execute tools matching a reserved prefix, including newly registered or scoped tools. Personal Desktop reserves `mcp__windows-mcp__` for the primary model. Existing subagent authorization and leaf-node enforcement remain responsible for selected child models and recursion limits.

## Model Experience

The chosen main model decides requirements, design, task assignment and acceptance from child reports. When desktop tools are reserved, the main model performs desktop control and children are instructed to avoid desktop automation through tools, terminals, scripts or MCP. File access, code, commands, verification and retrieval go to authorized children. All other authorized skills, including project memory, remain available to children. Failed children do not authorize the main model to take over their tasks or switch models.

## Known Limitations and Deferred Work

The policy governs Harness tool dispatch, including nested dispatch. Terminal and provider-owned native execution require separate confinement; the desktop prohibition in those channels is an instruction, not an operating-system sandbox. Primary classification requires a validated session header with no subagent origin, parent session or positive delegation depth. Agentless calls are denied reserved tools; other infrastructure calls are unaffected. No separate invariant plugin is needed because the tool executor owns the guard; real Loader tests verify denials, child execution and disposal.
