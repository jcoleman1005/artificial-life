/**
 * Friendly, deterministic display names for organisms. The given name comes
 * from the organism's id and the family name from its lineage id, so every
 * descendant of one founder shares a family name. Display only: simulation
 * ids are unchanged, and nothing here uses the simulation's random stream.
 */

const ONSETS = ['b', 'd', 'f', 'g', 'h', 'j', 'k', 'l', 'm', 'n', 'p', 'r', 's', 't', 'v', 'w', 'z', 'sh'];
const VOWELS = ['a', 'e', 'i', 'o', 'u', 'a', 'o', 'i'];
const ENDINGS = ['', '', '', '', 'n', 'l', 'm', 'x', 'y', 'b', 'p', 'k', 'bo', 'li', 'ny', 'pi'];

const FAMILY_FIRST = [
  'Moss', 'Pebble', 'Dew', 'Fern', 'Clover', 'Bramble', 'Puddle', 'Thistle',
  'Acorn', 'Willow', 'Hazel', 'Maple', 'Pip', 'Bumble', 'Sorrel', 'Nettle',
  'Juniper', 'Marigold', 'Cobble', 'Mallow', 'Tansy', 'Hollow', 'Rush', 'Sedge',
  'Barley', 'Quill', 'Cricket', 'Button', 'Tumble', 'Honey', 'Wren', 'Poppy',
];
const FAMILY_LAST = [
  'berry', 'wick', 'foot', 'down', 'brook', 'leaf', 'whistle', 'bottom',
  'burrow', 'tuft', 'hop', 'bloom', 'nook', 'dale', 'shell', 'kettle',
];

/** 32-bit integer hash of a string (FNV-1a with a final avalanche). */
function hash(text: string, salt: number): number {
  let h = (2166136261 ^ salt) >>> 0;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
}

const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** A short pronounceable given name, e.g. "Mibo" or "Tavel". */
export function givenName(organismId: string): string {
  let h = hash(organismId, 0x9e3779b9);
  const pick = <T>(list: readonly T[]): T => {
    const item = list[h % list.length];
    h = Math.floor(h / list.length);
    return item;
  };
  return capitalise(pick(ONSETS) + pick(VOWELS) + pick(ONSETS) + pick(VOWELS) + pick(ENDINGS));
}

/** A family name shared by a whole lineage, e.g. "Mossberry". */
export function familyName(lineageId: string): string {
  const h = hash(lineageId, 0x51ed270b);
  return FAMILY_FIRST[h % FAMILY_FIRST.length] + FAMILY_LAST[Math.floor(h / FAMILY_FIRST.length) % FAMILY_LAST.length];
}

export interface DisplayName {
  readonly given: string;
  readonly family: string;
  readonly full: string;
}

export function organismName(organism: { readonly id: string; readonly lineage: { readonly id: string } }): DisplayName {
  const given = givenName(organism.id);
  const family = familyName(organism.lineage.id);
  return { given, family, full: `${given} ${family}` };
}
