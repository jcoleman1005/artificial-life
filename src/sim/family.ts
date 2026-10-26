import type { LineageInfo } from './types';

/**
 * Whether `parent` is one of `child`'s parents: the one it was born next to,
 * or, for a child of mating, the other one too.
 */
export function isParentOf(parent: { readonly id: string }, child: { readonly lineage: LineageInfo }): boolean {
  return child.lineage.parentId === parent.id || child.lineage.mateId === parent.id;
}

/** Parent and child, either way round: the family that can pass through each other. */
export function isParentOrChild(a: { readonly id: string; readonly lineage: LineageInfo }, b: { readonly id: string; readonly lineage: LineageInfo }): boolean {
  return isParentOf(a, b) || isParentOf(b, a);
}
