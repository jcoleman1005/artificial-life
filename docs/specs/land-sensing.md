# Spec: land sensing (step 3 of the world-building order)

_Status: **Built 2026-10-29** on branch `claude/elevation-and-water`; `landSensingEnabled` on by default. One append-only brain upgrade (4 inputs, 57 -> 61), as the user ordered ("3: one brain upgrade with sensing inputs")._

## Inputs (brain only; appended after `maturity`)

| Input | Value | Needs |
|---|---|---|
| `moveSlope` | rise of the cell a move enters over the cell stood on, in height units x10, clamped to -1..1 (climbing positive) | elevation |
| `moveWater` | depth of the cell entered as a share of the deep threshold, 0 on land, 1 at deep water | elevation |
| `moveRough` | roughness of the cell entered, 0..1 | terrain |
| `cover` | cover underfoot, 0..1 (same for every action) | terrain |

All four are zero when their field is off. Head starts are 0: no founder is born with an opinion about them; hidden-layer weights are ordinary small draws, so they can evolve. These are the target-cell move cost inputs and the cover input the terrain decision promised, plus the elevation and water inputs.

## Switch and identity

- `landSensingEnabled` off, or the input's field off: the input has zero weights that are never drawn, mutated or encoded as genes (`brainInputActive`), so that world is bit-identical to the swimming world (checked by fingerprint and a draw-count test).
- Saves from before load with upgraded brains (zero weights, head start 0).
- The land fields reach the brain through a non-enumerable reference on the sensed inputs, so they are not copied into organism history, saves or hashes.

## Not built

- **Scent inputs:** the scent layer (`docs/specs/scent-layer.md`) is still unbuilt, so there is nothing to sense; adding them means another append.
- Heavy hitters like line of sight and the structure field are later steps.
- Nothing shows that brains use these inputs; the test only proves the path exists.

## Tests

`tests/land-sensing.test.ts`: input order and head starts, activity by switch, switch-off draws the same random numbers, older brains upgrade with zeros, genome round trip with and without the genes, feature values (slope, water, roughness, cover), zero when off, ledger.
