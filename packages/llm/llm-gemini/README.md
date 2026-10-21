# Gemini providers

`gemini` uses the official API. `gemini-2` uses the retained Antigravity CLI account with its existing private home. The retired `gemini-1` route is not registered. Provider choice and reasoning effort are always supplied by the caller.

## Model Experience

Account calls run a model-only custom CLI agent. Harness tool declarations are sent with a JSON response contract; returned requests are validated against those declarations and emitted as ordinary Harness tool calls. Harness executes them and returns results on the next model turn. Unexpected native CLI tool progress is an error and is never replayed as a host request.

Prompts travel through the CLI's official NDJSON stdin protocol (`event: user`). This keeps full tool schemas and skill contexts out of Windows command-line arguments and avoids `ENAMETOOLONG`; model, reasoning effort and conversation identity remain explicit CLI options.

### KV Cache effect

The adapter continues the CLI conversation for a session and appends current host tool declarations. CLI-native and Harness histories remain separate; host results are explicitly supplied as tool-result text.

## Known limitations

The CLI has no public native host-tool RPC in this adapter. Tool-enabled responses must therefore conform to the declared JSON contract and are buffered until the CLI result completes. They may show less incremental text than plain chat. Malformed responses fail explicitly. Native tool progress rejection is a detection safeguard, not proof that a third-party CLI never executed an action; the custom agent's tool configuration is also required.

No invariant companion is needed for this response adapter: it exposes no separate status snapshot. Account authentication remains owned by the existing account controller.
