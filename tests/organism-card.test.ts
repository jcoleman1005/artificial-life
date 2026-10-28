import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../src/sim/config';
import type { OrganismView } from '../src/sim/protocol';
import { computeOrganismBadges } from '../src/ui/organism-card';

function baseOrgView(partial: Partial<OrganismView> = {}): OrganismView {
  return {
    id: 'org-1',
    x: 10,
    y: 10,
    energy: 80,
    tag: 120,
    lineage: { id: 'org-1', parentId: null, generation: 5 },
    age: 140,
    carriedFood: 0,
    carnivory: 0.1,
    recentHistory: [],
    ...partial,
  };
}

describe('computeOrganismBadges', () => {
  it('computes core badges for a plant grazer with low burn', () => {
    const org = baseOrgView({
      carnivory: 0.05,
      metabolicRate: 0.85,
      clutchSize: 1.0,
    });
    const badges = computeOrganismBadges(org, DEFAULT_CONFIG);

    const diet = badges.find((b) => b.category === 'diet');
    expect(diet).toBeDefined();
    expect(diet?.icon).toBe('🌱');
    expect(diet?.label).toBe('Herbivore');
    expect(diet?.value).toBe('95%');

    const burn = badges.find((b) => b.category === 'metabolism');
    expect(burn).toBeDefined();
    expect(burn?.icon).toBe('⚡');
    expect(burn?.label).toBe('Burn');
    expect(burn?.value).toBe('0.85×');
  });

  it('computes core badges for a dedicated carnivore with large clutch', () => {
    const org = baseOrgView({
      carnivory: 0.92,
      metabolicRate: 1.4,
      clutchSize: 3.6,
    });
    const badges = computeOrganismBadges(org, DEFAULT_CONFIG);

    const diet = badges.find((b) => b.category === 'diet');
    expect(diet?.icon).toBe('🥩');
    expect(diet?.label).toBe('Carnivore');
    expect(diet?.value).toBe('92%');

    const clutch = badges.find((b) => b.category === 'breeding');
    expect(clutch?.icon).toBe('🥚');
    expect(clutch?.label).toBe('Clutch');
    expect(clutch?.value).toBe('3.6');
  });

  it('computes omnivore label for intermediate carnivory', () => {
    const org = baseOrgView({ carnivory: 0.45 });
    const badges = computeOrganismBadges(org, DEFAULT_CONFIG);
    const diet = badges.find((b) => b.category === 'diet');
    expect(diet?.icon).toBe('🌾');
    expect(diet?.label).toBe('Omnivore');
    expect(diet?.value).toBe('45% meat');
  });

  it('includes mobility and physical standout badges', () => {
    const org = baseOrgView({
      carnivory: 0.1,
      metabolicRate: 1.0,
      abilities: { leap: 0.75, squeeze: 0, diagonal: 0 },
      detox: 0.6,
      size: 1.5,
    });
    const badges = computeOrganismBadges(org, DEFAULT_CONFIG);

    const leaper = badges.find((b) => b.label === 'Leaper');
    expect(leaper).toBeDefined();
    expect(leaper?.icon).toBe('🦘');

    const detox = badges.find((b) => b.label === 'Detox');
    expect(detox).toBeDefined();
    expect(detox?.value).toBe('60%');

    const size = badges.find((b) => b.label === 'Heavy');
    expect(size).toBeDefined();
    expect(size?.value).toBe('1.5×');
  });

  it('caps total badges at 5 to prevent mobile card overflow', () => {
    const org = baseOrgView({
      carnivory: 0.85,
      metabolicRate: 1.25,
      clutchSize: 2.5,
      abilities: { leap: 0.9, squeeze: 0.9, diagonal: 0.9 },
      detox: 0.8,
      size: 1.6,
      sensingRadius: 5,
      acquiredBrainUnits: 3,
    });
    const badges = computeOrganismBadges(org, DEFAULT_CONFIG);
    expect(badges.length).toBeLessThanOrEqual(5);

    // Core diet, burn, clutch must always be present
    expect(badges.some((b) => b.category === 'diet')).toBe(true);
    expect(badges.some((b) => b.category === 'metabolism')).toBe(true);
    expect(badges.some((b) => b.category === 'breeding')).toBe(true);
  });
});
