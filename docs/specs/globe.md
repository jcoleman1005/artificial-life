# Spec: the globe (cylinder map, wind belts, rain bands, opposite-hemisphere seasons)

_Status: **Built 2026-10-30** on branch `claude/globe`; `worldWrapEnabled`, `climateBeltsEnabled` and `hemisphericSeasonsEnabled` on by default. Decisions by the user, 2026-10-30: a cylinder (not a torus, not a true sphere); wind belts, rain bands and opposite-hemisphere seasons; keep the map at 60x60. The user did **not** pick a latitude temperature gradient, so there is none: temperature still comes from the fronts and the season, which now differs by hemisphere._

## The map is a cylinder

With `worldWrapEnabled` the east and west edges join: a body walking east comes back from the west. North and south stay the polar edges (no wrap, walls as before). `src/sim/globe.ts` is the one place that knows how (`wrapX`, `wrapDx`, `neighbourIndex`); everything else asks.

- **Bodies:** move, leap, reproduce, give, attack and mate targets wrap; birth cells, dispersal, windfalls, mating cells and food-within checks wrap; an attack's reach is measured the short way round.
- **Senses:** the sensing window wraps (no west or east wall), other bodies, signals, death pulses and remembered places are measured by the short way round, and the entities sensed carry in-range coordinates.
- **Plants and soil:** seeds and shading wrap, nutrients diffuse round the seam.
- **Terrain and elevation:** the noise repeats east to west (a whole number of lattice cells across), plate distances are measured the short way round, hydrology and soil neighbours wrap, and the sea drains at the poles only, so continents and rivers can cross the seam. The tide map and the riparian fringe wrap too.
- **Weather:** fronts wrap and are never dropped at the east or west edge; rain, temperature and wind distances use the short way round.
- **Page:** the weather layer draws a storm on both sides of the seam; the wind arrows use the same belt rules as the sim; a step across the seam hops instead of gliding back across the map; the hillshade and shore wrap.
- Off: every helper returns its input unchanged and the old noise runs, so the world is bit-identical to the one before it (fingerprint).

## Latitude climate (`climateBeltsEnabled`)

Latitude of a row is 0 at the equator (the middle row) to 1 at each pole edge.

- **Wind belts:** zonal wind is `-windBeltStrength x sin(3 pi latitude)`: easterly trade winds in the tropics, westerlies in mid-latitudes, polar easterlies, with a poleward or equatorward drift (`windBeltPoleward`) that goes with each belt (toward the equator in the trades and at the poles, toward the pole in the westerlies), mirrored in the south. The old wandering prevailing wind rides on top at half strength. Storms are steered toward the belt wind where they are, so they track along the belts.
- **Rain bands:** where a front forms is drawn by latitude: a row is accepted with probability `(1 - rainBandStrength) + rainBandStrength x wetness`, and wetness peaks at the equator and the mid-latitudes (`0.15 + 0.85 x (0.5 + 0.5 cos(2 pi latitude / 0.55))`) and falls in the subtropics and at the poles. Fronts form anywhere along their row; the front type follows the season of the hemisphere where it forms.
- Seed and signal drift already read the local wind, so they follow the belts without further change.

## Opposite-hemisphere seasons (`hemisphericSeasonsEnabled`)

The southern half of the map (rows at or below the equator) runs half a `seasonLength` behind the northern half. The felt temperature and the type of the fronts that form use the season of the row. The nutrient cycle (not the calendar) still drives food lean times, so this changes the weather and thermal costs, not the plants' own seasons.

## Not built / limits

- No latitude temperature gradient (not chosen), no Coriolis rotation of storms beyond the existing tangential circulation, no sphere geometry: the cells stay equal squares, so the poles are not pinched.
- Ingredients, not behaviour: nothing shows that migration around the world, circumpolar currents or hemispheric seasonal migration appear.
- Brains cannot sense latitude or the seam directly; they see the land and the weather near them.

## Tests

`tests/globe.test.ts` (23): the helpers, legal moves across the seam (and not when flat or at the poles), senses across the seam, plants across the seam, an elevation field with no seam and continents that span it, belt direction and mirroring, rain bands, storm steering, storms wrapping, hemispheric seasons, and a whole world (ledger, restore).
