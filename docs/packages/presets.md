# Profile presets

- [What a profile package is](#what-a-profile-package-is)
- [The manifest](#the-manifest)
- [The six presets](#the-six-presets)
- [hash-profile and provenance](#hash-profile-and-provenance)

## What a profile package is

A profile package is a distributable unit that bundles everything needed to
reproduce one agent configuration. Each is an npm package
(`@facet/preset-pi-*`) with a `profile/` directory:

| File | Role |
|---|---|
| `SYSTEM.md` | the system prompt |
| `tools.yaml` | the tool allowlist, e.g. `tools: ["read", "write", "edit", "bash"]` |
| `extensions.yaml` *(optional)* | harness config, sub-agents, and declared Layer-2 metrics |
| `agents/` *(optional)* | markdown sub-agent definitions |
| `upfront/` *(optional)* | scripts whose stdout is injected into the system prompt before turn one |

A spec references a preset by package name at an `extension_select` factor level.

## The manifest

The `package.json#facet` block declares how the package binds to a harness and
how it is hashed:

```jsonc
"facet": {
  "profileRoot": "./profile",        // path to the profile/ directory
  "harness": "@facet/harness-pi",     // target harness package
  "harnessVersionRange": "^0.70",     // semver range
  "hash": "sha256:4177c4c6…"          // SHA-256 of the canonicalized directory
}
```

The schema is the SDK's [`ProfilePackageManifestSchema`](sdk.md#the-profile-package-manifest).

## The six presets

Each preset maps to a context-gathering strategy.

```mermaid
flowchart TB
  d["preset-pi-default<br/>read/write/edit/bash baseline"]
  g["preset-pi-graph<br/>structural knowledge graph"]
  r["preset-pi-rag<br/>semantic retrieval"]
  l["preset-pi-lsp<br/>active LSP gathering"]
  e["preset-pi-lens<br/>reflective post-edit checks"]
  s["preset-pi-subagents<br/>task decomposition"]
```

| Preset | Strategy | Backing extension |
|---|---|---|
| `@facet/preset-pi-default` | baseline Pi | none |
| `@facet/preset-pi-graph` | structural knowledge graph | `pi-gitnexus` / `graphmod` |
| `@facet/preset-pi-rag` | active semantic retrieval | `pi-rag` |
| `@facet/preset-pi-lsp` | active LSP gathering | `@dreki-gg/pi-lsp` |
| `@facet/preset-pi-lens` | reflective post-edit verification | `pi-lens` |
| `@facet/preset-pi-subagents` | task decomposition | `@tintinweb/pi-subagents` |

A preset's `extensions.yaml` wires the extension and may declare Layer-2 metrics.
For example, `preset-pi-lsp` declares an `lsp_queries_count` metric of kind
`tool_call_count` over the `lsp` tool, and a `language_servers` map
([a Pi contribution](harness-pi.md#what-the-adapter-contributes)).

## hash-profile and provenance

`facet hash-profile <pkg>` recomputes the directory hash and writes it back to
the manifest. On every `facet spec validate` and at the start of each run, the
validator compares the recorded hash against the live directory, and provenance
lands in `manifest.provenance.profiles[]`.

This closes the [reproducibility](../reference/reproducibility.md) model: two
runs over the same Experiment Package, with the same presets pinned by hash and
the same harness version, are by construction the same experiment.
