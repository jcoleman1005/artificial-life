import { describe, expect, it } from 'vitest';
import { PRNG } from '../src/sim/prng';

describe('PRNG determinism and repeatability', () => {
  it('generates identical sequence from the same numeric seed', () => {
    const prng1 = new PRNG(12345);
    const prng2 = new PRNG(12345);

    for (let i = 0; i < 50; i++) {
      expect(prng1.next()).toBe(prng2.next());
      expect(prng1.nextInt(0, 100)).toBe(prng2.nextInt(0, 100));
      expect(prng1.nextGaussian()).toBe(prng2.nextGaussian());
    }
  });

  it('generates identical sequence from the same string seed', () => {
    const prng1 = new PRNG('simulation-seed-galaxy-s21');
    const prng2 = new PRNG('simulation-seed-galaxy-s21');

    const seq1 = Array.from({ length: 20 }, () => prng1.next());
    const seq2 = Array.from({ length: 20 }, () => prng2.next());

    expect(seq1).toEqual(seq2);
  });

  it('generates different sequences for different seeds', () => {
    const prngA = new PRNG(100);
    const prngB = new PRNG(200);

    const seqA = Array.from({ length: 10 }, () => prngA.next());
    const seqB = Array.from({ length: 10 }, () => prngB.next());

    expect(seqA).not.toEqual(seqB);
  });

  it('resets back to initial sequence on reset()', () => {
    const prng = new PRNG(98765);
    const firstFive = Array.from({ length: 5 }, () => prng.next());

    // Advance 50 steps
    for (let i = 0; i < 50; i++) {
      prng.next();
    }

    prng.reset();
    const replayFive = Array.from({ length: 5 }, () => prng.next());

    expect(replayFive).toEqual(firstFive);
  });

  it('shuffles arrays deterministically', () => {
    const prng1 = new PRNG(42);
    const prng2 = new PRNG(42);

    const arr1 = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const arr2 = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

    expect(prng1.shuffle(arr1)).toEqual(prng2.shuffle(arr2));
  });
});
