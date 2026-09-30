/** Tiny PCA for projecting a handful of embedding vectors to 2-D. */

function dot(a: readonly number[], b: readonly number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += (a[i] ?? 0) * (b[i] ?? 0);
  return s;
}

function normalize(v: number[]): number[] {
  const n = Math.sqrt(dot(v, v)) || 1;
  return v.map((x) => x / n);
}

function powerIteration(cov: number[][], iterations = 60, seed = 1): number[] {
  const d = cov.length;
  let v = normalize(Array.from({ length: d }, (_, i) => Math.sin(i * 0.7 + seed) + 0.1));
  for (let it = 0; it < iterations; it++) {
    const next = cov.map((row) => dot(row, v));
    v = normalize(next);
  }
  return v;
}

/** Three principal components, each axis normalised to [-1, 1]. */
export function pca3d(vectors: readonly (readonly number[])[]): Array<[number, number, number]> {
  const n = vectors.length;
  if (n === 0) return [];
  const d = vectors[0]?.length ?? 0;
  const mean = Array.from({ length: d }, (_, j) => vectors.reduce((s, v) => s + (v[j] ?? 0), 0) / n);
  const centered = vectors.map((v) => v.map((x, j) => x - (mean[j] ?? 0)));
  let cov: number[][] = Array.from({ length: d }, () => new Array<number>(d).fill(0));
  for (const v of centered) {
    for (let i = 0; i < d; i++) {
      const vi = v[i] ?? 0;
      if (vi === 0) continue;
      const row = cov[i];
      if (!row) continue;
      for (let j = 0; j < d; j++) row[j] = (row[j] ?? 0) + vi * (v[j] ?? 0);
    }
  }
  const scale = 1 / Math.max(1, n - 1);
  cov = cov.map((row) => row.map((x) => x * scale));
  const comps: number[][] = [];
  for (let k = 0; k < 3; k++) {
    const c = powerIteration(cov, 60, k + 1);
    const lambda = dot(c, cov.map((row) => dot(row, c)));
    comps.push(c);
    cov = cov.map((row, i) => row.map((x, j) => x - lambda * (c[i] ?? 0) * (c[j] ?? 0)));
  }
  const raw = centered.map((v) => comps.map((c) => dot(v, c)) as [number, number, number]);
  const maxAbs = [0, 1, 2].map((k) => Math.max(1e-9, ...raw.map((p) => Math.abs(p[k] ?? 0))));
  return raw.map((p) => [p[0] / (maxAbs[0] ?? 1), p[1] / (maxAbs[1] ?? 1), p[2] / (maxAbs[2] ?? 1)]);
}

export interface Pca2D {
  points: Array<[number, number]>;
  components: [number[], number[]];
  mean: number[];
}

export function pca2d(vectors: readonly (readonly number[])[]): Pca2D {
  const n = vectors.length;
  if (n === 0) return { points: [], components: [[], []], mean: [] };
  const d = vectors[0]?.length ?? 0;
  const mean = Array.from({ length: d }, (_, j) =>
    vectors.reduce((s, v) => s + (v[j] ?? 0), 0) / n,
  );
  const centered = vectors.map((v) => v.map((x, j) => x - (mean[j] ?? 0)));
  const cov: number[][] = Array.from({ length: d }, () => new Array<number>(d).fill(0));
  for (const v of centered) {
    for (let i = 0; i < d; i++) {
      const vi = v[i] ?? 0;
      if (vi === 0) continue;
      const row = cov[i];
      if (!row) continue;
      for (let j = 0; j < d; j++) row[j] = (row[j] ?? 0) + vi * (v[j] ?? 0);
    }
  }
  const scale = 1 / Math.max(1, n - 1);
  for (const row of cov) for (let j = 0; j < d; j++) row[j] = (row[j] ?? 0) * scale;

  const c1 = powerIteration(cov, 60, 1);
  const lambda1 = dot(c1, cov.map((row) => dot(row, c1)));
  const deflated = cov.map((row, i) =>
    row.map((x, j) => x - lambda1 * (c1[i] ?? 0) * (c1[j] ?? 0)),
  );
  const c2 = powerIteration(deflated, 60, 2);

  const raw = centered.map((v) => [dot(v, c1), dot(v, c2)] as [number, number]);
  const maxAbs = Math.max(1e-9, ...raw.flatMap(([x, y]) => [Math.abs(x), Math.abs(y)]));
  const points = raw.map(([x, y]) => [x / maxAbs, y / maxAbs] as [number, number]);
  return { points, components: [c1, c2], mean };
}
