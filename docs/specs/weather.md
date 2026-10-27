# Spec: dynamic weather systems

_Status: Agreed draft 2026-10-27. World Expansion (Abiotic Environmental Dynamics). Follows [`WORLD_RULES.md`](../WORLD_RULES.md) and [`AGENTS.md`](../../AGENTS.md)._

## Summary

Adds dynamic, spatial, and stochastic abiotic variation across the 60×60 grid via moving weather fronts. All three physical dimensions (temperature, precipitation/soil moisture, wind vector) are implemented in Phase 1 behind the top-level switch `weatherEnabled` (on by default).

Terrain obstacle shelter buffering is deferred to a future multi-factor spec (incorporating body size, metabolic rate, and fat drag).

## 1. Multi-Front Environmental Model

The simulation tracks up to `weatherMaxFronts` (default: 2) active front entities that drift across the grid:

- **Entity Model:**
  ```typescript
  export type WeatherFrontType = 'rain_storm' | 'cold_front' | 'heat_wave';

  export interface WeatherFront {
    readonly id: number;
    readonly type: WeatherFrontType;
    x: number;
    y: number;
    vx: number;
    vy: number;
    radius: number;
    intensity: number;
    lifetime: number;
  }
  ```
- **Macro Climate & Drift:** A global prevailing wind vector drifts smoothly via PRNG random walk. Seasons influence the probability of front types (cold fronts in lean seasons, rain storms in plenty seasons).
- **Performance:** $O(\text{fronts})$ evaluation per cell or organism ($< 0.1\ \mu\text{s}$).

## 2. Physical Dimensions & Biological Interactions

### Temperature ($T \in [-1.0, 1.0]$)
- Lean seasons bias baseline cooler; cold fronts drop local temperature toward $-1.0$.
- **Chill Upkeep:** When local $T < 0$, basal metabolism increases linearly:
  $$\Delta E_{\text{upkeep}} = \text{tickMetabolismCost} \times (1 + \text{weatherChillCoeff} \times |T|)$$
- **Synergies:**
  - Torpor REST discounts this extra cost via `torporDepth`.
  - Fat reserves buffer organisms during prolonged cold spells.

### Precipitation ($R \in [0, 1]$) & Soil Moisture ($M \in [0, 1]$)
- Rain increases local soil moisture stored in a `Uint8Array(gridWidth * gridHeight)` (3.6 KB), which evaporates gradually.
- **Plants:** Local moisture scales plant growth vigour:
  $$\text{vigour} = \text{growthRate} \times \text{soil} \times \text{light} \times (0.3 + 0.7 \times M_{\text{cell}}) \times (1 - \text{shadeStrength} \times \text{shade})$$
- **Movement (Mud):** Wet cells increase move cost:
  $$\text{moveCost}_{\text{actual}} = \text{baseMoveCost} \times (1 + \text{weatherMudCoeff} \times R)$$
- **Carrion:** Wet cells accelerate carrion rot by $1.5\times$.

### Wind Vector ($\vec{W} = (W_x, W_y)$)
- **Kinetic Drag:** Movement with or against the wind modifies move cost:
  $$\text{dragMultiplier} = 1.0 - \text{weatherWindCoupling} \times (\vec{v} \cdot \vec{W})$$
- **Anisotropic Seed Dispersal:** Seed landing coordinates are displaced downwind by $\text{round}(\vec{W} \times \text{weatherSeedDrift})$.
- **Anisotropic Signal Propagation:** Sensed signal distance threshold is shifted downwind by $\text{weatherSignalDrift} \times (\vec{r} \cdot \vec{W})$, allowing signals to travel farther downwind and muffling them upwind.

## 3. Organism Brain Inputs (Append-Only)

Three new inputs appended to `BRAIN_INPUTS`:
1. `weatherTemp`: Local temperature $[-1, 1]$.
2. `weatherRain`: Local precipitation $[0, 1]$.
3. `moveWindAlignment`: Candidate movement vector aligned with wind $\vec{d} \cdot \vec{W} \in [-1, 1]$.

Existing saves continue to load via `upgradeBrain()`.

## 4. UI & Mobile Ergonomics

- **Renderer Overlay:** "Weather" overlay with wind streamlines, rain particles, and temperature tinting.
- **Peek Bar:** Compact weather badge (`❄️ -3°C ↗ 14km/h` or `🌧️ Rain`).
- **Inspector:** Displays cell microclimate and organism chill/drag modifiers.

## 5. Verification & Rules

- Bit-identical fingerprint when `weatherEnabled = false`.
- Deterministic seeded PRNG throughout.
- Serialized in `exportState()` / `fromState()`.
- Tick overhead $< 5\%$ at 500 organisms.
