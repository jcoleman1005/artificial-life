# Decision for approval: the persistent scent layer

_Status: **Proposed 2026-10-29, awaiting the user's approval. Nothing is built.** Follows [`docs/specs/physics.md`](physics.md) (hook point 5.4) and [`AGENTS.md`](../../AGENTS.md). Not to be confused with the existing signals (`SIGNAL`: an instant, radius-limited call that leaves nothing behind)._

## What it is

A second per-cell field, like terrain but fast-changing: each cell holds a **scent** value that bodies leave behind, that fades, spreads a little and drifts with the wind. It is the base lever behind trails, territory marks and anything that works by leaving a trace. It adds a way for bodies to write to the world and for the world to remember where they have been.

Principles from earlier decisions apply: no built-in meaning (the world does not say what scent is for), energy stays the only need (scent is a cost-free physical trace or an energy cost, never a need), and no target outcome.

## An honest limit before the numbers

Until the brain upgrade that adds the sensing inputs (build-order rank 6), **no organism can sense scent**. So the layer, built alone, is drawn and carried but changes no behaviour: an on/off experiment of it alone should show nothing, and I will report that as a null result, not as a finding. Its effect can only appear once the inputs exist. This is the order you asked for; I am flagging that the first step is inert by design.

## Proposed design (the defaults I would build unless you change them)

| Question | Proposal | Why |
|---|---|---|
| Channels | **Two per cell:** `scent` (an intensity, 0..1) and `signature` (the hue tag of the last body that left scent there, 0..359). No other channels. | Intensity is the trail. The signature lets a body tell kin from stranger by scent, which the colour-group goal needs, without adding a global rule. |
| Who deposits | **Passive:** every body that moves leaves `scentDeposit` (0.15 × √size) in the cell it enters, applied after all actions like terrain wear. No new action. | A trace is a physical consequence of moving, as wear is. A deliberate mark would need a new action and brain inputs (not possible yet). |
| Energy cost of depositing | **None for the passive trace.** It is not energy: the ledger does not change. A deliberate mark (later) would cost energy and enter the ledger as an out-flow. | Keeps the passive layer free of new energy rules and leaves "energy is the only need" intact. |
| Decay | Multiplies by `scentDecay` = 0.98 each tick: half-life about 35 ticks. | A trail lasts a few dozen ticks: long enough to follow, short enough that it is not a permanent map. Exposed as a setting. |
| Spread | Each tick a share `scentSpread` = 0.05 of a cell's scent mixes with its four neighbours (diffusion). Edges are reflecting. | Trails soften over time and are not razor thin. |
| Wind | The weather wind moves scent downwind: each tick a share equal to `min(0.5, scentWindDrift × |wind|)` of each cell shifts one cell along the wind (`scentWindDrift` 0.5, so a 0.3 wind moves about 15%). Only while weather is on. | Reuses the existing wind; scent trails smear downwind and are easier to follow upwind. The signature channel is not moved (an approximation, stated). |
| Cap | Intensity clamps at 1. | Bounded values, no runaway. |
| Sensing | Free per cell: it uses the sensing window the body already pays for (`sensingUpkeepPerCell` × radius²). | No new upkeep; the cost is only brain compute. |
| Inputs (built later, rank 6) | `scentHere` (0..1), `scentPull` (x and y: the gradient of intensity toward stronger scent in the window), and `scentKin` (similarity of the underfoot signature to the body's own tag, graded like `kinSimilarity`). 4 inputs, plus the 2 terrain inputs = 6 in one append-only upgrade. | Matches how `kinPull` already works. |
| Switch | `scentEnabled`, on by default; off draws and changes nothing (bit-identical, fingerprint checked). | Control arm, as for every feature. |
| Display | A "Scent" entry in the layers menu using the existing heatmap channel, so the field is sent to the page only while that layer is open. | Costs nothing otherwise. |

## What it costs, and the phone

Measured here (a micro-benchmark of the whole grid update: decay, diffusion and wind shift over 60 × 60 cells, Float32): **about 70 to 85 µs per tick** in the container, while another job was running. On the S21, at the corrected 1.3 to 1.8 times slower, that is about **0.1 to 0.15 ms per tick**: roughly 0.2% of the average tick (62 to 69 ms) and about 0.1% of the worst ticks (130 to 172 ms, against a 167 ms budget at 1×). Memory: two small arrays, under 50 KB. Saved worlds grow by roughly 40 to 70 KB (values are stored exactly so a restore is bit-identical).

The real cost is later: the six brain inputs. The brain has 52 inputs; six more is about 12% more first-layer work. Brain scoring is about a third of a tick, so I estimate **about 3 to 4% more per tick**, roughly 2 ms on an average S21 tick and 5 to 6 ms on a worst tick, which would put the worst ticks slightly over the 1× budget (about 177 ms against 167 ms) until the optimisation pass lands. That is an estimate, not a measurement; I would measure it with the perf harness before turning the inputs on for the phone, and the `scentEnabled` switch (and the upgrade's switch) lets the phone profile run without them.

## How it enters the energy ledger

It does not, for the passive trace: scent is not energy, so nothing is added to or taken from the animals' stored energy, and the ledger's residual must stay at zero with scent on (tested). If a deliberate mark action is added later, its cost goes in as a new out-flow.

## How it will be tested (mechanisms and invariants only)

- Deterministic, no random draws; deposits applied after all actions, so the result does not depend on which body acts first.
- Scent never goes below 0 or above the cap; decay alone follows the half-life; with no wind and no spread, total scent after a step equals the old total × decay plus the deposits; diffusion alone conserves the total (it is built as an exchange between neighbours, so nothing is made or lost at the edge).
- With wind on, the centre of mass of a single deposit moves downwind and not upwind.
- Passive deposit scales with √size; open and rough cells deposit the same.
- Save and restore is bit-identical, and a world continues identically afterwards.
- `scentEnabled` off reproduces the previous fingerprint exactly; the ledger balances with it on; the host sends the field only while its layer is open.
- No test asserts that trail following evolves.

## What this does not give you

Ingredients, not behaviour. A scent layer is not a trail, a territory or a colony: those would have to emerge in organisms that can sense scent, and we have no evidence yet that they will. The active mark, dig or build action is still not possible: it needs new brain inputs and a new action.

## Open choices (asked in the conversation)

1. Channels: intensity only, intensity plus signature, or two independent intensities.
2. Deposit: passive, deliberate only (later), or passive now and deliberate later.
3. Decay and reach: half-life about 35 ticks, about 150 ticks, or a setting with 35 as the default.
4. Wind: scent drifts with the wind, or ignores it.
