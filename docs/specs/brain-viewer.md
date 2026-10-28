# Live brain viewer (observer-only)

Status: spec, 2026-10-28. Read-only inspection of a selected organism's controller. No sim change, no PRNG draw, no `stateHash()` change.

## Goal
In the Inspector, show the selected organism's brain **as it decides**: inputs, hidden units, per-action scores, the chosen action, and which inputs mattered most. Makes null results (signals, Stage 3 growable brain) diagnosable and satisfies "record observable inputs, action scores, decisions".

## Data
New protocol request/response (append-only, `src/sim/protocol.ts`): `inspectBrain { organismId }` → `BrainTrace`:
- `controller`: `'brain' | 'dials'`.
- Brain: `inputNames` (from `BRAIN_INPUTS`, incl. appended ones), `inputs[]` (the values the policy would feed this tick, for the organism's current sensed state), `hidden[]` activations, for **each legal action** its `score` and the per-action `direct[]` contributions, the chosen action and runner-up. For the growable circuit (`dnaGrowableBrain`) return nodes+edges (sparse) with a flag for acquired units.
- Dials: dial values and the weighted score per action.
- Also `topInputs`: top N (default 8) inputs by |input × weight contribution| to the chosen action.
Computation reuses `brainFeatures` / `evaluateBrain` / `scoreCircuit`. **Verify** those functions do not mutate sim-relevant state (note `lastCircuitDirect()` / `lastCircuitHidden()` module scratch): the trace must be computed on a copy or must restore scratch, and a test must prove `stateHash()` and later ticks are identical with and without inspection. Refresh at most every tick while selected, only when the viewer is open (otherwise zero cost). Works in the Worker host and the server host.

## UI (`src/ui/brain-view.ts`, mounted in `src/ui/inspector.ts`)
- Collapsible "Brain" section. Layered node-link diagram on canvas/SVG: inputs (grouped by sense family: food, kin, signals, memory, weather, body), hidden, action scores. Edge colour = weight sign, width = |contribution| this tick; node fill = activation. Default view shows only the top-N contributing inputs plus "N more" so 52+ inputs don't swamp a 390px screen; tap to expand a family.
- Highlight the chosen action; show the score bars for all actions side by side.
- Optional mini history (last ~60 ticks) of the chosen action as a ribbon.
- Dials organisms: bar view instead.
- Mobile first: 44px targets, WCAG AA dark contrast, no hover-only info, works in the landscape desktop dashboard layout.

## Tests
- `BrainTrace` for a hand-built brain equals a manual dot-product calculation.
- Chosen action in the trace equals the action the policy actually chose that tick.
- Inspection does not change `stateHash()`, nor the next 200 ticks' fingerprint.
- Growable circuit: edges listed match `scoreCircuit` output.
- UI helper tests for top-N selection and family grouping (pure functions).
