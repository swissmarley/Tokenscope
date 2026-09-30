import { describe, expect, it } from 'vitest';
import {
  applyTopK,
  applyTopP,
  entropyBits,
  logSumExp,
  rollFor,
  sampleDistribution,
  sampleIndex,
  softmax,
} from './softmax';

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

describe('softmax', () => {
  it('sums to one and preserves order', () => {
    const p = softmax([1, 2, 3]);
    expect(sum(p)).toBeCloseTo(1, 10);
    expect(p[2]).toBeGreaterThan(p[1] ?? 0);
    expect(p[1]).toBeGreaterThan(p[0] ?? 0);
  });

  it('is numerically stable for huge logits', () => {
    const p = softmax([1000, 1001, 999]);
    expect(sum(p)).toBeCloseTo(1, 10);
    expect(Number.isFinite(p[0] ?? NaN)).toBe(true);
  });

  it('sharpens at low temperature and flattens at high temperature', () => {
    const cold = softmax([1, 2, 3], 0.2);
    const hot = softmax([1, 2, 3], 5);
    expect(cold[2]).toBeGreaterThan(0.99);
    expect(Math.abs((hot[0] ?? 0) - (hot[2] ?? 0))).toBeLessThan(0.2);
    expect(entropyBits(hot)).toBeGreaterThan(entropyBits(cold));
  });

  it('handles the empty case', () => {
    expect(softmax([])).toEqual([]);
  });
});

describe('top-k', () => {
  it('zeroes everything outside the k best and renormalises', () => {
    const p = applyTopK([0.5, 0.3, 0.15, 0.05], 2);
    expect(p[0]).toBeCloseTo(0.625, 10);
    expect(p[1]).toBeCloseTo(0.375, 10);
    expect(p[2]).toBe(0);
    expect(p[3]).toBe(0);
  });
  it('k ≤ 0 or k ≥ n is a no-op', () => {
    expect(applyTopK([0.6, 0.4], 0)).toEqual([0.6, 0.4]);
    expect(applyTopK([0.6, 0.4], 5)).toEqual([0.6, 0.4]);
  });
});

describe('top-p', () => {
  it('keeps the smallest nucleus reaching p', () => {
    const p = applyTopP([0.5, 0.3, 0.15, 0.05], 0.8);
    expect(p[2]).toBe(0);
    expect(p[3]).toBe(0);
    expect(sum(p)).toBeCloseTo(1);
    expect(p[0]).toBeCloseTo(0.625);
  });
  it('always keeps at least the top token', () => {
    const p = applyTopP([0.9, 0.1], 0.01);
    expect(p).toEqual([1, 0]);
  });
  it('p ≥ 1 is a no-op', () => {
    expect(applyTopP([0.6, 0.4], 1)).toEqual([0.6, 0.4]);
  });
  it('works on unsorted input', () => {
    const p = applyTopP([0.05, 0.5, 0.15, 0.3], 0.8);
    expect(p[0]).toBe(0);
    expect(p[2]).toBe(0);
    expect(p[1]).toBeCloseTo(0.625);
  });
});

describe('sampleDistribution + sampling', () => {
  it('composes temperature, top-k and top-p', () => {
    const p = sampleDistribution([3, 2, 1, 0], { temperature: 1, topK: 3, topP: 0.9 });
    expect(p[3]).toBe(0);
    expect(sum(p)).toBeCloseTo(1);
  });

  it('sampleIndex maps u to cumulative ranges', () => {
    const p = [0.2, 0.5, 0.3];
    expect(sampleIndex(p, 0)).toBe(0);
    expect(sampleIndex(p, 0.19)).toBe(0);
    expect(sampleIndex(p, 0.2)).toBe(1);
    expect(sampleIndex(p, 0.69)).toBe(1);
    expect(sampleIndex(p, 0.7)).toBe(2);
    expect(sampleIndex(p, 0.9999)).toBe(2);
    expect(sampleIndex(p, 1.0000001)).toBe(2);
  });

  it('rollFor produces a u that selects the requested index', () => {
    const p = [0.2, 0.5, 0.3];
    for (let i = 0; i < 3; i++) expect(sampleIndex(p, rollFor(p, i))).toBe(i);
    expect(sampleIndex(p, rollFor(p, 1, 0))).toBe(1);
    expect(sampleIndex(p, rollFor(p, 1, 1))).toBe(1);
  });

  it('logSumExp matches the naive formula on small inputs', () => {
    expect(logSumExp([0, 0])).toBeCloseTo(Math.log(2));
    expect(logSumExp([1000, 1000])).toBeCloseTo(1000 + Math.log(2));
  });
});
