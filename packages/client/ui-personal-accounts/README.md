# Personal account settings

Personal Desktop registers a Model accounts page through the existing Settings slot. It exposes the retained Google account (original slot `2`) and official Codex account. The page uses the shared Button primitive, CSS Modules, semantic theme variables, typed Chinese/English dictionaries, and an injected native status source.

The main process launches the installed official Antigravity CLI for slot `2` using its existing private home and remote OAuth environment. Slot `1` is no longer advertised or accepted by the native controller. The renderer supplies no command, executable path, or API key. The Google slot owns one cancellable login probe; the official CLI owns authorization and refresh. An optional one-time code is sent directly to its terminal and cleared from the form; it is never logged or sent to a model. Codex authorization remains separate. Closing the application cancels its login probes.

## Model Experience

The page adds no model-facing tool and sends no conversation history. An explicit login click makes one short native request asking for `OK`. Only a successful structured result and that real response produce a verified status. Credential-file presence is not treated as authentication proof. Errors cross the native bridge as fixed categories, never as raw subprocess output.

## Known Limitations and Deferred Work

The personal launcher selects installed Antigravity CLI. A fresh profile must authorize separately even when the Windows keyring already holds another account. Persistent reuse and the Harness task protocol require separate verification. This page's successful request does not enable the API-only `gemini` provider or migrate legacy ACP routes.

Reopening the application recognizes a nonempty official credential file as a saved login without reading its contents or claiming current authentication success. Each account retains only its last successful probe timestamp in `personal-verification.json`; missing or malformed history does not invalidate saved CLI credentials. No request runs automatically at startup. The official CLI owns refresh and reauthorization when the account is used or explicitly verified. Google controls credential lifetime; the application does not extend token expiry. A fresh sign-in requires the user to finish Google's authorization in the browser.

No invariant entry is published: the page projects its native controller's state and owns no independent runtime relationship to audit.
