/**
 * Alea — компактный детерминированный PRNG (Johannes Baagøe).
 * Нужен, потому что Math.random() не принимает seed, а для процедурного мира
 * критично: один и тот же seed → один и тот же мир при каждой загрузке,
 * и это единственная зависимость simplex-noise от источника случайности.
 */
export default function alea(seed: string): () => number {
  let s0 = 0;
  let s1 = 0;
  let s2 = 0;
  let c = 1;

  const mash = createMash();
  s0 = mash(' ');
  s1 = mash(' ');
  s2 = mash(' ');
  s0 -= mash(seed);
  if (s0 < 0) s0 += 1;
  s1 -= mash(seed);
  if (s1 < 0) s1 += 1;
  s2 -= mash(seed);
  if (s2 < 0) s2 += 1;

  return function next(): number {
    const t = 2091639 * s0 + c * 2.3283064365386963e-10;
    s0 = s1;
    s1 = s2;
    return (s2 = t - (c = Math.floor(t)));
  };
}

function createMash() {
  let n = 0xefc8249d;
  return function mash(data: string): number {
    for (let i = 0; i < data.length; i++) {
      n += data.charCodeAt(i);
      let h = 0.02519603282416938 * n;
      n = h >>> 0;
      h -= n;
      h *= n;
      n = h >>> 0;
      h -= n;
      n += h * 0x100000000;
    }
    return (n >>> 0) * 2.3283064365386963e-10;
  };
}
