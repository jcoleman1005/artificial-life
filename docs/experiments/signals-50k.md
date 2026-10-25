# Signals over 50,000 ticks

_Run 2026-10-25 on commit c51789f (60×60 world, 4 staggered food regions)._
_8 seeds × 50,000 ticks; `signalsEnabled=false` vs `true`, once with dials and once with the brain._
_Raw output: `signals-dials-50k.txt` / `.json`, `signals-brain-50k.txt` / `.json`._

## Result: signallers carry a weak hint of "food here", but nobody listens

| Measure (last 20% of each run) | Dials | Brain |
|---|---|---|
| Share of actions that are signals | 5.3% | 3.8% |
| Signal rate when standing on food | 7.5% | 5.4% |
| Seeds where on-food rate > overall rate | 5/8 (ratio 0.1–3.4) | 6/8 (ratio 0.2–1.9) |
| Moves toward a signal in range | 49.5% (chance ≈ 50%) | 49.3% |
| Average population, signals on vs off | 411 vs 415 (lower 5/8) | 411 vs 423 (lower 7/8) |
| Lean-season low, on vs off | 347 vs 354 | 359 vs 372 (lower 7/8) |

- **Senders:** in most runs organisms on food signal somewhat more than average (about 1.4× overall). After 10,000 ticks they signalled *less* on food, so this is new, but it is weak and varies a lot between seeds (one dials run is 0.14×, another 3.4×).
- **Receivers:** no response at all. Moves with a signal in range head toward it at chance in both controllers and in every seed (44–56%).
- **Dial weights:** `signalWhenHungry` averages +0.42 and `followSignal` +0.24 with signals on, but the same unused weights drift by ±0.7 between seeds with signals off. So this is within neutral drift, not clear selection.
- **Cost:** signalling slightly lowers the population, most clearly under the brain (7/8 seeds).

**Conclusion:** no communication has evolved. A signal that carries information needs listeners who gain from responding, and here they don't. Likely reasons:
- Food is already visible within 3 cells.
- Regions are crowded: 65–70% of moves are blocked, so walking toward a distant signal rarely pays.
- Signallers are as likely to be strangers as kin, so helping a listener doesn't help the signaller's own genes.

## Ideas for next time

- Make listening pay. Try a smaller `sensingRadius` (e.g. 2) or sparser, richer patches, so a signal reveals food you can't see.
- Make sending pay for kin. Measure whether signals reach mostly look-alikes, or add `signalRadius` falloff so signals stay local to the family.
- Track the brain's signal connections (skip weights for `isSignal`, `signalOnFood`, `moveSignal`) directly. The dial weights listed above are unused under the brain and only drift.
- Always compare against `signalsEnabled=false`.
