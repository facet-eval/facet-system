# ring-default-specific

FACET experiment that tests **inclusionai/ring-2.6-1t:free** with only
the **default** profile across three compound coding scenarios, using
the **specific** prompt for every scenario.

Self-contained: scenarios are local copies (dereferenced from the
symlinks `gemma-default` uses back to `factor-study/`), and the Pi
custom-model declaration ships next to `spec.yaml` as `models.json`.

## Matrix

| Factor | Levels | Count |
|---|---|---|
| `prompt_id` | specific | 1 |
| `profile` | `@facet/preset-pi-default` | 1 |
| `model` | ring-2-6-1t-free (OpenRouter) | 1 |
| `scenario` | compound-python, compound-haskell, compound-c | 3 |
| `repetitions` | 1 | 1 |
| **Total runs** | | **3** |

Budget cap: `max_total_cost_usd: 0.5`. The model itself is free on
OpenRouter; only request/round-trip surcharges (if any) would count.

## Setup — register the Pi model

`harness-pi` looks up models against Pi's `ModelRegistry`, which today
only reads `~/.pi/agent/models.json`. Until FACET supports a
package-local `models.json` path (see
`docs/audits/pi-custom-model-registry.md` — Tier 1), you must merge the
contents of this package's `models.json` into your global file:

```bash
# One-time, manual merge (preserves your existing entries):
node -e "
const fs = require('fs');
const path = require('path');
const home = require('os').homedir();
const globalPath = path.join(home, '.pi/agent/models.json');
const localPath = path.join('examples/ring-default-specific/models.json');
const global = fs.existsSync(globalPath)
  ? JSON.parse(fs.readFileSync(globalPath, 'utf8'))
  : { providers: {} };
const local = JSON.parse(fs.readFileSync(localPath, 'utf8'));
for (const [prov, decl] of Object.entries(local.providers)) {
  const bucket = (global.providers[prov] ??= { models: [] });
  for (const m of decl.models) {
    const i = bucket.models.findIndex(x => x.id === m.id);
    if (i >= 0) bucket.models[i] = m; else bucket.models.push(m);
  }
}
fs.writeFileSync(globalPath, JSON.stringify(global, null, 2) + '\n');
console.log('merged → ' + globalPath);
"
```

When FACET ships Tier 1 of the audit, this section can be removed and
the harness will read this package's `models.json` directly.

## Scenarios

Local under `scenarios/compound-*`. Each scenario's `meta.yaml`
declares both `medium` and `specific` prompts; this spec only selects
`specific` via `varying_factors[prompt_id]`. The framework enforces
that every scenario declares every required `prompt_id` — satisfied
here because the copied scenarios declare both.

## Comparisons

- `scenario_language` — how does the default profile perform across
  scenarios at the specific prompt level?

## Running

```bash
pnpm facet spec validate examples/ring-default-specific
pnpm facet run examples/ring-default-specific
```

Results land in a fresh `result-ring-default-specific-001-<TS>/`
directory at the repo root.
