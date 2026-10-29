# Spec: elevation and water (step 1 of the world-building order)

_Status: **Built 2026-10-29** on branch `claude/elevation-and-water`; `elevationEnabled` on by default. Decisions by the user, 2026-10-29: landmasses with lakes, rivers and oceans between them, "large continents" and separated land masses allowed; tectonic plates that can drift later; deep water impassable until swimming exists; effects: slope cost, temperature drop with height, riparian (wet-ground) fertility; the fertile discs are removed and fertile ground made realistic._

## What it is

One height field made once from tectonic-style plates (`src/sim/elevation.ts`), with a sea level, water that runs downhill, and a soil-quality map. It uses a random stream of its own (derived from the world seed), so it draws nothing from the simulation's stream; with `elevationEnabled` off the world is bit-identical to the world without it.

- **Plates:** `elevationPlateCount` (6) centres, about half continental (high, base 0.62) and half oceanic (low, 0.18); each cell follows its nearest plate (ragged borders), bases blend softly; mountains where two continental plates meet (`elevationRidge`), a coastal range where a continental plate meets an oceanic one; noise on top. The plates are kept on the field so a later step (tectonic drift) can move them and remake the height.
- **Sea and continents:** sea level at the `elevationSeaFraction` (0.38) quantile of the heights; land fragments under `elevationMinContinent` (150) cells are flooded (the largest is always kept), leaving large continents separated by ocean.
- **Hydrology:** priority-flood from the sea and the map edge. Depressions fill into lakes, the strongest `elevationRiverFraction` (3%) of flows are rivers (shallow), everything below sea level is ocean with a depth. Water depth 0..1: `>= elevationDeepThreshold` (0.2) is deep.
- **Passability:** deep water is in `World.obstacles` (nothing can cross it) and in `World.deepWater` (the page draws it as sea, not rock; `World.rocks()` is the obstacles without it). Shallow water, including rivers, can be waded. Bodies, food, windfalls and immigrants are not placed in water.
- **Slope:** entering a cell costs `1 + elevationSlopeUp × climb` (5), or `max(0.75, 1 + elevationSlopeDown × descent)` (2) going down.
- **Wading:** entering shallow water costs `1 + elevationWadeDrag × (depth / deep threshold) × √size`.
- **Temperature:** the weather temperature felt is lowered by `elevationLapse` (0.4) × height above the typical lowland (the median of the land), and by `elevationWaterChill` (0.25) standing in water; this feeds the thermal law.
- **No fertile discs:** with elevation on, `createFoodRegions` makes none, so there are no regions, region seasons, region events or compass names. `SoilField` takes its fertility from the soil map instead.
- **Soil quality** (`ElevationField.fertility`): `wet × (1 − 0.85 slope) × (1 − 0.45 upland) × patch noise`, where `wet = 0.25 + 0.75 × max(shore, gather)`: shore is the riparian wetness (fades over `elevationRiparianReach` cells from water), gather is flow collecting on flat ground (floodplains); scaled so dry land averages `elevationFertilityMean` (0.6, about the old disc world's total food), minimum `elevationFertilityMin` (0.04). Initial food patches are accepted in proportion to the soil's fertility. Dynamic fertility (wear and rebuild) works on top of this map; its floor is the margin value or the cell's own fertility where that is poorer.
- **Save:** nothing is saved (static, regenerated from the seed); a save from before elevation loads with it off.
- **Page:** the elevation and water are sent once in the static message and drawn under everything else (blues by depth, pale shore, hillshade, greyer highlands); no pebbles or tufts on water; the Fertility layer key says "no fixed zones".

## Not built yet (the rest of the order)

Step 2: a swim ability and marine plants (deep water opens to swimmers). Step 5: dynamic water (tides, floods) and drifting plates. Step 3: one brain upgrade with the sensing inputs (elevation, water, terrain, scent). Step 4: a structure field and a build action.

## Tests

`tests/elevation.test.ts` (14): determinism, sea share and large continents, rivers and lakes, shallow and deep water, the slope, wading and temperature laws, soil quality (zero under water, mean, richer near water, poorer on steep ground), no discs, nothing in water, deep water impassable, save and restore, an old save, and the energy ledger. About 90 existing mechanism tests now set `elevationEnabled: false` with a comment, because they place bodies and read exact costs on small worlds.

## Limits

Ingredients, not behaviour. Organisms cannot sense elevation or water until the brain upgrade (step 3): until then they feel them only through energy, and avoid deep water because it is an obstacle (which they do sense). A larger ocean and no discs made the default world harder (fewer organisms at the same tick); nothing here shows that isolation or niches produce species.
