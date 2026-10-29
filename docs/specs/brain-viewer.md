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

## As built (2026-10-28)

Observer only: no sim state, config key or PRNG draw was added, so `npm run fingerprint` is unchanged.

**Code**
- `src/sim/brain-trace.ts` (new): `traceBrain(world, organismId, {topN?, prng?}) -> BrainTrace | null`, plus pure `topContributions`. It reads `world.getSnapshot()`, `senseEnvironment`, `getLegalActions`, `brainFeatures`, `brainScore` / `scoreCircuit` (dials: `evaluatePolicy`) and re-applies `evaluateBrain`'s choice rule (same 1e-6 tolerance and tie-break draw).
- `src/ui/brain-view.ts` (new): `BrainView` (persistent `<details>` "Brain" section; SVG diagram, family chips, score bars, 60-decision ribbon of real actions; dials get a bar view) and pure helpers `inputFamily`, `shownInputs`, `familyCounts`, `pickActionRows`.
- Wiring (small hunks): `protocol.ts`, `host.ts`, `server/app.ts` (command allow-list), `simulation-client.ts` (`inspectBrain()` promise), `inspector.ts` (`setBrainElement`, a `.brain-slot` div replaced by the persistent element after each render), `main.ts` (a few lines), `style.css` (appended block), `brain.ts` (appended `saveCircuitScratch` / `restoreCircuitScratch`).

**Protocol (append-only)**
- `ToWorker`: `{ kind: 'inspectBrain', requestId, organismId }`.
- `FromWorker`: `{ kind: 'brainTrace', requestId, organismId, trace: BrainTrace | null }` (null = not alive).
- The server accepts `inspectBrain` as a non-shared command, so it also works with `--watch-only`. The reply goes only to the asking viewer.

**BrainTrace** (plain data): `controller`, `growable`, `inputNames`, `actions[]` (`type`, `target`, `score`, `hidden`, `direct[]` per input, `components` for dials), `chosenIndex`, `runnerUpIndex`, `inputs[]` (the chosen action's feature vector), `hiddenUnits[]` (`id`, `acquired` = id >= `BRAIN_HIDDEN`, `bias`, `out`, `activation`, sparse `weights`), `skip[]`, `outBias`, `topInputs[]`, `dials`, `lastAction` (the previous real decision).

**Decisions made**
- Features are per action, so `inputs`, hidden activations and `topInputs` describe the chosen action. `topInputs[].contribution` is the score drop if that input were zeroed (direct and hidden paths together), not just the skip weight.
- Observer safety: the trace uses its own PRNG seeded from (tick, organism id), never the world's; it reads a snapshot copy; and it saves and restores the `scoreCircuit` scratch (`DIRECT`, `lastHidden`) around its work. In the tick loop the scratch is read right after each `scoreCircuit` call, so it could not leak into a tick anyway; the restore makes that independent of call order.
- The trace is "how it would decide on the current state". The real next tick can differ only through the world PRNG's `moveNoise` draws and exact ties. The ribbon therefore shows real decisions (`lastAction`), not predicted ones.
- Zero cost when closed: the view requests only while the Brain section is open, an organism is selected and the tick has moved; one request in flight at a time. Constant units folded into the circuit's output bias are not listed as units.
- Weather inputs do not exist yet; `inputFamily` maps names starting weather/temperature/moisture/wind/malaise/lastBite/detox to a Weather family so appended inputs land somewhere sensible. Unknown names fall back to Body.

**Tests** (`tests/brain-trace.test.ts`, plus one line in `tests/server.test.ts`): trace equals a manual dot-product calculation; chosen action and all scores equal the real tick's (single-organism worlds, PRNG cloned); dials trace; inspecting every organism every tick leaves `stateHash()` and the next 200 ticks identical (dense, and growable + Stage 2 variation); world PRNG state and hash unchanged; scratch restored; growable edges and units reproduce `scoreCircuit`; host round trip; server accepts the request when watch-only; pure UI helpers.

**Not done**: no browser check on a real 390px screen (no browser here); the layout is by construction (SVG viewBox 340 wide, 44px chips).
