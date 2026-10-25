import { describe, expect, it } from 'vitest';
import { familyName, givenName, organismName } from '../src/ui/names';
import { colourGroups, groupIndexOf } from '../src/sim/groups';

describe('generated names', () => {
  it('is deterministic', () => {
    expect(givenName('org-17')).toBe(givenName('org-17'));
    expect(familyName('lineage-3')).toBe(familyName('lineage-3'));
  });

  it('gives a lineage one shared family name', () => {
    const a = organismName({ id: 'org-120', lineage: { id: 'lineage-4' } });
    const b = organismName({ id: 'org-998', lineage: { id: 'lineage-4' } });
    expect(a.family).toBe(b.family);
    expect(a.given).not.toBe(b.given);
    expect(a.full).toBe(`${a.given} ${a.family}`);
  });

  it('produces readable, varied names', () => {
    const given = new Set<string>();
    const families = new Set<string>();
    for (let i = 1; i <= 1000; i++) {
      const name = givenName(`org-${i}`);
      expect(name).toMatch(/^[A-Z][a-z]{2,9}$/);
      given.add(name);
      families.add(familyName(`lineage-${i}`));
    }
    expect(given.size).toBeGreaterThan(950);
    expect(families.size).toBeGreaterThan(300);
  });
});

describe('colour groups', () => {
  it('buckets hues, wrapping around red', () => {
    expect(groupIndexOf(0)).toBe(0);
    expect(groupIndexOf(355)).toBe(0);
    expect(groupIndexOf(14)).toBe(0);
    expect(groupIndexOf(16)).toBe(1);
    expect(groupIndexOf(120)).toBe(4);
  });

  it('counts members, largest first, with a circular mean hue', () => {
    const groups = colourGroups([{ tag: 350 }, { tag: 10 }, { tag: 120 }, { tag: 0 }]);
    expect(groups.map((g) => [g.name, g.count])).toEqual([
      ['Reds', 3],
      ['Greens', 1],
    ]);
    expect(Math.min(groups[0].hue, 360 - groups[0].hue)).toBeLessThan(5);
  });
});
