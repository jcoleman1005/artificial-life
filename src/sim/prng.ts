/**
 * Deterministic Pseudo-Random Number Generator.
 * Uses Mulberry32 algorithm with string-or-number seed hashing.
 * Ensures 100% reproducibility across simulation runs.
 */

export class PRNG {
  private state: number;
  private initialSeed: number;

  constructor(seed: number | string = 12345) {
    if (typeof seed === 'string') {
      this.initialSeed = PRNG.hashString(seed);
    } else {
      this.initialSeed = (seed >>> 0) || 1;
    }
    this.state = this.initialSeed;
  }

  /**
   * Hashes any string into a 32-bit unsigned integer using FNV-1a.
   */
  public static hashString(str: string): number {
    let hash = 2166136261;
    for (let i = 0; i < str.length; i++) {
      hash ^= str.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  /**
   * Returns a pseudo-random 32-bit unsigned integer.
   */
  public nextUint32(): number {
    this.state = (this.state + 0x6d2b79f5) | 0;
    let t = Math.imul(this.state ^ (this.state >>> 15), 1 | this.state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return (t ^ (t >>> 14)) >>> 0;
  }

  /**
   * Returns a float in [0, 1).
   */
  public next(): number {
    return this.nextUint32() / 4294967296;
  }

  /**
   * Returns an integer in [min, max] inclusive.
   */
  public nextInt(min: number, max: number): number {
    if (min > max) {
      const temp = min;
      min = max;
      max = temp;
    }
    const range = max - min + 1;
    return min + Math.floor(this.next() * range);
  }

  /**
   * Returns a float in [min, max).
   */
  public nextFloat(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /**
   * Returns a boolean with the specified probability of being true.
   */
  public nextBoolean(probability = 0.5): boolean {
    return this.next() < probability;
  }

  /**
   * Normal (Gaussian) distribution using Box-Muller transform.
   */
  public nextGaussian(mean = 0, stdDev = 1): number {
    let u1 = this.next();
    let u2 = this.next();
    // Avoid u1 being 0 to prevent Math.log(0) = -Infinity
    while (u1 <= 1e-15) {
      u1 = this.next();
    }
    const z0 = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
    return mean + z0 * stdDev;
  }

  /**
   * A Poisson-distributed count with the given mean (exact: Knuth's product
   * method, in chunks of at most 20 so exp(-mean) never underflows).
   */
  public nextPoisson(mean: number): number {
    let count = 0;
    let left = mean;
    while (left > 0) {
      const part = Math.min(left, 20);
      left -= part;
      const limit = Math.exp(-part);
      let product = this.next();
      while (product > limit) {
        count++;
        product *= this.next();
      }
    }
    return count;
  }

  /**
   * Returns a random element from a non-empty array.
   */
  public choice<T>(array: readonly T[]): T {
    if (array.length === 0) {
      throw new Error('Cannot choose from an empty array.');
    }
    const index = Math.floor(this.next() * array.length);
    return array[index];
  }

  /**
   * Shuffles an array in place using Fisher-Yates.
   */
  public shuffle<T>(array: T[]): T[] {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      const temp = array[i];
      array[i] = array[j];
      array[j] = temp;
    }
    return array;
  }

  /**
   * Resets the generator back to its initial seed.
   */
  public reset(): void {
    this.state = this.initialSeed;
  }

  /**
   * Sets a new seed.
   */
  public setSeed(seed: number | string): void {
    if (typeof seed === 'string') {
      (this as any).initialSeed = PRNG.hashString(seed);
    } else {
      (this as any).initialSeed = (seed >>> 0) || 1;
    }
    this.state = this.initialSeed;
  }

  public getSeed(): number {
    return this.initialSeed;
  }

  public getState(): number {
    return this.state;
  }

  public setState(state: number): void {
    this.state = state >>> 0;
  }
}
