# Spec: dynamic water (step 5 of the world-building order)

_Status: **Built 2026-10-30** on branch `claude/dynamic-water`; `dynamicWaterEnabled` on by default. The user ordered it ("5 dynamic water (tides/floods)"); the form is my choice within that order, values chosen before any run except the depth caps, which were lowered once after the first gate run (Parameter log). Drifting plates are **not** in this step._

## What changes

Water that comes and goes over **dry ground**; permanent water, deep water, the obstacles and the plants' medium never change. So nothing can strand a swimmer or move a wall, and a tide or flood only changes what a dry cell costs to enter and how cold it is.

- **Tides:** the sea rises and falls over `tidePeriod` (400 ticks) by up to `tideAmplitude` (0.02 of the height range). A dry cell floods when the sea has risen past `tideRise`, a map made once at generation by a priority flood from the ocean: the highest ground between the cell and the ocean, so a lagoon behind a ridge stays dry until the tide tops the ridge. About 2-5% of dry cells are ever reached.
- **Floods:** a flood stage 0..1 follows the weather's soil moisture (`floodRate`) and drains when the rain stops. Above `floodBankfull` (0.25) the wet fringe of rivers, lakes and coast goes under, to `floodReach` (0.2) of the riparian fringe at full flood, on low ground only (upland under 0.2). With weather off the stage stays 0.
- **Depth:** standing water is shallow (tide up to `tideMaxDepth` 0.06, flood up to `floodMaxDepth` 0.05, both under the deep threshold), so it is wadeable: it uses the existing wading cost, water chill, `moveWater` brain input and `isWet` placement rules unchanged.
- **Plants and soil:** a plant keeps growing in a cell that floods (its medium and the soil fertility are the map's, not the tide's); seeds still keep to their own medium.
- Recomputed every `waterInterval` (5) ticks from the tick, the saved flood stage and the fixed map; no random draws. Saved: the flood stage only; restore rebuilds the water as of the last update, so it continues identically.
- **Page:** the standing water is sent with a frame when it has changed, at most about once a second, and the water layer is redrawn then.

## Not built

- **Drifting plates** (the user wants them eventually): the plates are kept on the field, but moving them means remaking the height, the sea, rivers, soil and everything standing on them; its own step with its own design.
- Nothing shows that tides or floods produce migration or a shoreline niche; this builds the ingredient. A tide cycle is also not seasonal.

## Tests

`tests/dynamic-water.test.ts` (10): tide map (ocean 0, reach rises with height, high ground dry), shallow never deep and never on permanent water, high and low tide, counts as water for wading/chill/placement, floods only after rain on the riparian fringe and drains, off is off, save and restore continue identically, old saves, ledger, page hand-off.
