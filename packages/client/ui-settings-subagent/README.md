---
description: "The Subagent settings page on the dsh web client's Plugins page: delegation limits, authorized model routes, and optional child defaults, on one page with one save."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings-subagent

English | [中文](README.zh.md)

## Summary

Open **Plugins** in the sidebar and select **Subagent** in the Official group to set delegation limits, authorize models, and choose child defaults. The page groups `subagent`, `subagent-model-selection-settings`, and the optional `subagent-default-model` namespace under one save; it exists while the Host serves any of them and shows the sections it serves.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

**Limits** holds **Maximum recursion depth** and **Subagent parallelism limit** side by side, stacking on narrow screens; the information button beside each label discloses its rule — a two-row depth example, and the count that capacity bounds — and a draft that is not a whole number in range blocks the save and says so under the field. Depth yields to a tool's own maximum; capacity counts every live subagent under one main agent across all levels, the main agent excluded.

**Model selection** stages its permission switch and the exact adapter routes together. Enabling requires at least one selected route; disabling keeps the selected routes for later. Routes the Host stored but no adapter advertises stay listed under **Saved but currently unavailable** and remain removable; a provider that failed to load is reported without hiding the others, and a failed load offers **Retry**.

Add arbitrary model IDs through **Settings → Models → Custom model API** using an OpenAI Chat Completions, OpenAI Responses, or Anthropic Messages compatible endpoint. Its models join the live authorization list without a hardcoded provider whitelist. Keys use the existing credential store.

When the Host serves `subagent-default-model`, **Default Subagent model** also selects a model and its advertised reasoning effort. Changing the route clears the previous effort to **Provider default**, including a composition-layer effort. These defaults apply to new in-process child tasks that omit a route; they leave the main agent and account CLI tools unchanged. **Save** includes this namespace with its own revision fence.

One **Save** writes the dirty sections through their own namespaces, each fenced by the revision its draft read. The writes are independent: a refused section keeps its draft while other sections may land. A newer Host revision fences out a stale draft. Leaving the page drops every draft.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The Host half is an empty `apply`, present only so the package holds a Loader row the client module system serves the browser half for. The browser half binds each namespace through `ctx.configForms.get`. `SubagentLimitsCardController` stages the limits over the shared `SettingsFormModel` of `ui-primitives`, with a field spec that admits safe whole numbers at or above each field's floor. `SubagentModelSelectionCardController` joins stored authorization routes with `remote.session.modelCatalog()`. `SubagentDefaultModelCardController` stages the default route and effort using the shared form. Adapter, document, and credential events refresh the catalogue; a connection reset drops model drafts and suppresses earlier save settlements. `subagentCardFace` combines the three sources in one `SettingsForm`, validating all served sections and saving each dirty namespace separately. `ctx.configForms.whileServed` registers the page while any namespace is served.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [ui-plugin-manager](../ui-plugin-manager/README.md) — the Plugins page and the `plugins.item` slot the page registers into.
- [ui-settings](../ui-settings/README.md) — the settings scope and the served-namespace watch the page rides.
- [ui-primitives](../ui-primitives/README.md) — the settings form model and fields the limits section renders.
- [tool-subagent](../../subagent/tool-subagent/README.md) — the delegation tools that register both namespaces.

-----

<a id="model-experience"></a>
## Model Experience

None, as the package is a browser-side settings surface that registers no model surface.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **The catalogue does not poll** — adapter, document, credential, and connection events refresh it. Changes outside these signals appear after **Refresh models** or **Retry**.
- **Runtime invariant:** No companion is published. The page holds no owned relationship of its own: what it shows derives from the settings mirror and the model catalogue, and what it writes the Host validates.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
