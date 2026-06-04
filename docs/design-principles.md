# Design principles

- [Three principles](#three-principles)
- [Design-decision synthesis](#design-decision-synthesis)

Three principles guide every structural choice in FACET. The table that follows
maps each concrete decision to the problem it solves.

## Three principles

### 1. Declarative over imperative

You describe an experiment in YAML, not as code that calls APIs. A spec becomes a
first-class, versioned artifact: you version the research question apart from the
runner code, replay it without reimplementing the pipeline, and feed it to
non-TypeScript tooling (validators, matrix generators, dashboards, analysis
layers in Python). See the [Experiment spec](reference/experiment-spec.md).

### 2. Traces are signal, not defects

Two runs with identical inputs produce different traces, because sampling is
stochastic. That variance is the thing worth measuring, not a bug to suppress.
`design.repetitions` models it by multiplying each matrix cell. A failed run is
data too: `tasks_passed: 0` is evidence about the agent, not a framework error.

### 3. Reproduce inputs, not outputs

The bundle manifest hashes inputs with SHA-256 — the normalized spec, the
scenarios, the profiles — and never hashes outputs, because output is stochastic
by construction. Same Experiment Package plus same pinned presets equals the same
experiment, bit-for-bit on the inputs. See [Reproducibility](reference/reproducibility.md).

## Design-decision synthesis

| Decision | Problem it solves |
|---|---|
| Split the SDK from the core (zero runtime deps) | Lowers the entry barrier for external authors; guarantees the core has no privileged access to the contracts. |
| `defineX()` helpers + dynamic registries + dynamic import | Enables zero-fork extensibility without DI containers or a bespoke plugin loader. |
| Eight seams as public contracts | Decomposes the monolithic benchmark into independently manipulable decisions. |
| Declarative YAML spec | Versions the research question, makes reproducibility trivial to verify, enables non-TypeScript tooling. |
| Translate boundary in the harness | Makes the downstream pipeline agent-agnostic: swapping the harness never touches the runner. |
| `git_worktree` as the only builtin workspace strategy | Millisecond startup vs. Docker; the abstraction still allows Docker/FUSE/VM strategies. |
| Hash inputs, not outputs | Makes the non-determinism model explicit: stochastic variance is signal, not framework error. |
| CI layer in a separate repo with immutable tags | Lets you pin runtime and CI independently and migrate them on different cadences. |
| SHA-256-hashed profile packages | Closes reproducibility: same package + same pinned presets = same experiment. |

These decisions all reduce to one move repeated across the eight
[seams](architecture.md): contracts in a weightless SDK, dynamic registries in
the core, resolution by dynamic import.
