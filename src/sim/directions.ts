import type { ActionType } from './types';

/** Grid step for each movement action: orthogonal, diagonal, and leaps (two cells). */
const STEPS: Partial<Record<ActionType, readonly [number, number]>> = {
  MOVE_NORTH: [0, -1],
  MOVE_SOUTH: [0, 1],
  MOVE_EAST: [1, 0],
  MOVE_WEST: [-1, 0],
  MOVE_NORTHEAST: [1, -1],
  MOVE_NORTHWEST: [-1, -1],
  MOVE_SOUTHEAST: [1, 1],
  MOVE_SOUTHWEST: [-1, 1],
  LEAP_NORTH: [0, -2],
  LEAP_SOUTH: [0, 2],
  LEAP_EAST: [2, 0],
  LEAP_WEST: [-2, 0],
};

/** Cells moved by an action ([0, 0] for actions that do not move). */
export function stepOf(type: ActionType): readonly [number, number] {
  return STEPS[type] ?? [0, 0];
}

/** Unit-length direction of an action, for scoring alignment with things it senses. */
export function unitDirectionOf(type: ActionType): [number, number] {
  const [dx, dy] = stepOf(type);
  const len = Math.sqrt(dx * dx + dy * dy);
  return len === 0 ? [0, 0] : [dx / len, dy / len];
}

export function isMoveAction(type: ActionType): boolean {
  return type.startsWith('MOVE_');
}

export function isLeapAction(type: ActionType): boolean {
  return type.startsWith('LEAP_');
}

export function isDiagonalMove(type: ActionType): boolean {
  const [dx, dy] = stepOf(type);
  return isMoveAction(type) && dx !== 0 && dy !== 0;
}
