// Q6: is an in-process index (no database) fast enough for small sites? `node bench-inprocess.ts`
const DIMS = 1536;
for (const n of [1_000, 10_000, 50_000]) {
  const data = new Float32Array(n * DIMS);
  for (let i = 0; i < data.length; i += 1) data[i] = Math.random() - 0.5;
  const query = Float32Array.from({ length: DIMS }, () => Math.random() - 0.5);
  const started = performance.now();
  const runs = 20;
  for (let r = 0; r < runs; r += 1) {
    const scores = new Float32Array(n);
    for (let i = 0; i < n; i += 1) {
      let dot = 0;
      const base = i * DIMS;
      for (let d = 0; d < DIMS; d += 1) dot += data[base + d]! * query[d]!;
      scores[i] = dot;
    }
    // Top 20 by partial sort is negligible next to the scan.
    Array.from(scores.keys()).sort((a, b) => scores[b]! - scores[a]!).slice(0, 20);
  }
  const ms = (performance.now() - started) / runs;
  console.log(`${n} chunks: ${(data.byteLength / 2 ** 20).toFixed(0)} MiB, ${ms.toFixed(1)} ms per query (brute force)`);
}
