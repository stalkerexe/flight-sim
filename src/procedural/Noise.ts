import { createNoise2D, type NoiseFunction2D } from 'simplex-noise';
import alea from './alea';
import { NOISE, WORLD } from '@/config/Constants';

/**
 * Многослойный процедурный генератор высот.
 *
 * Слои:
 * 1. Continental + Island — континентальный слой (очень низкая частота) задаёт
 *    крупные материки, поверх него накладывается более высокочастотный
 *    "островной" слой (`islandNoise`) с меньшим весом (NOISE.ISLAND_INFLUENCE).
 *    По отдельности континентальный слой даёт гладкие цельные материки; сумма
 *    двух слоёв разбивает береговую линию и добавляет отдельные острова —
 *    как в океане у побережья, так и изредка отдельно посреди океана, где
 *    островной слой локально перевешивает континентальный.
 * 2. Mountain mask — отдельная низкочастотная маска, определяющая, В КАКИХ
 *    РАЙОНАХ рельеф формируется как горная цепь (ridged noise, острые пики),
 *    а в каких — как пологие холмы (обычный fBm). Без этого слоя весь рельеф
 *    выглядит однородно "шумным" и не читается как "горы" — с ним появляются
 *    узнаваемые горные районы на фоне равнин.
 * 3. Domain warping — искажает координаты для detail-слоя, превращая
 *    "шумный ковёр" в извилистые хребты и русла рек.
 * 4. Detail fBm / ridged fBm — сумма октав simplex noise.
 *
 * ВАЖНО — anti-aliasing по Найквисту: у КАЖДОГО чанка своя резолюция сетки
 * (шаг между соседними вершинами). Если детальный слой содержит частоты выше
 * частоты Найквиста этой сетки (frequency > 1 / (2 * step)), соседние вершины
 * сэмплируют noise в точках, между которыми функция успевает несколько раз
 * пройти через экстремум — визуально это даёт случайные острые "иглы" вместо
 * гладкого рельефа (классический aliasing). Поэтому `getHeight()` принимает
 * `maxFrequency` и fbm() обрезает октавы, превышающие этот предел, ПЕРЕД тем
 * как они попадут в сумму — а не полагается на то, что более грубая сетка
 * "как-нибудь усреднит" высокочастотный шум.
 */
export class TerrainNoise {
  private readonly continentNoise: NoiseFunction2D;
  private readonly islandNoise: NoiseFunction2D;
  private readonly detailNoise: NoiseFunction2D;
  private readonly warpNoiseX: NoiseFunction2D;
  private readonly warpNoiseZ: NoiseFunction2D;
  private readonly mountainMaskNoise: NoiseFunction2D;

  constructor(seed: number = NOISE.SEED) {
    this.continentNoise = createNoise2D(alea(`${seed}-continent`));
    this.islandNoise = createNoise2D(alea(`${seed}-island`));
    this.detailNoise = createNoise2D(alea(`${seed}-detail`));
    this.warpNoiseX = createNoise2D(alea(`${seed}-warpx`));
    this.warpNoiseZ = createNoise2D(alea(`${seed}-warpz`));
    this.mountainMaskNoise = createNoise2D(alea(`${seed}-mountainmask`));
  }

  /**
   * Возвращает высоту рельефа (метры) в мировой точке (x, z).
   *
   * @param maxFrequency Частота Найквиста сетки, которая будет сэмплировать
   *   эту точку — `1 / (2 * шаг_между_вершинами)`. Октавы fBm выше этой
   *   частоты отбрасываются, чтобы избежать aliasing-артефактов ("игл") на
   *   грубых дальних чанках. По умолчанию Infinity — не ограничивает (полезно
   *   для отладки/сравнения, но НЕ для реальной генерации сетки).
   */
  getHeight(worldX: number, worldZ: number, maxFrequency = Infinity): number {
    const continental = this.continentNoise(
      worldX * NOISE.CONTINENT_FREQUENCY,
      worldZ * NOISE.CONTINENT_FREQUENCY,
    );
    const island = this.islandNoise(
      worldX * NOISE.ISLAND_FREQUENCY,
      worldZ * NOISE.ISLAND_FREQUENCY,
    );
    const continentalValue = continental + island * NOISE.ISLAND_INFLUENCE;
    const continentMask = smoothstep(NOISE.LAND_MASK_LOW, NOISE.LAND_MASK_HIGH, continentalValue);

    const warpX =
      this.warpNoiseX(worldX * NOISE.WARP_FREQUENCY, worldZ * NOISE.WARP_FREQUENCY) *
      NOISE.WARP_STRENGTH;
    const warpZ =
      this.warpNoiseZ(worldX * NOISE.WARP_FREQUENCY, worldZ * NOISE.WARP_FREQUENCY) *
      NOISE.WARP_STRENGTH;

    const wx = worldX + warpX;
    const wz = worldZ + warpZ;

    const detail = this.fbm(wx, wz, maxFrequency);

    // Ridged variant той же fBm-суммы: 1 - |detail| даёт острые пики на местах,
    // где detail пересекает ноль, а возведение в степень 1.7 обостряет хребты
    // и слегка расширяет плоские долины между ними — типичный вид горных цепей.
    const ridged = Math.pow(1 - Math.abs(detail), 1.7);

    const mountainRaw = this.mountainMaskNoise(
      worldX * NOISE.MOUNTAIN_MASK_FREQUENCY,
      worldZ * NOISE.MOUNTAIN_MASK_FREQUENCY,
    );
    const mountainMask = smoothstep(NOISE.MOUNTAIN_MASK_LOW, NOISE.MOUNTAIN_MASK_HIGH, mountainRaw);

    // В горных районах доминирует ridged-рельеф (острые хребты), в остальных —
    // обычный пологий fBm (холмы/равнины).
    const blendedShape = detail * (1 - mountainMask) + ridged * mountainMask;

    // КЛЮЧЕВОЕ ОТЛИЧИЕ от предыдущей версии: раньше и "равнины", и "горы"
    // использовали ОДНУ И ТУ ЖЕ амплитуду (WORLD.MAX_TERRAIN_HEIGHT) — менялась
    // только форма (ridged/обычный fBm), а не высота. Из-за этого равнины были
    // не "равнинами", а просто холмами без ridged-хребтов, но такого же
    // масштаба высоты, что и горы — визуально всё выглядело как "горы разной
    // формы". Теперь амплитуда явно модулируется mountainMask: равнины реально
    // плоские (FLAT_AMPLITUDE от максимума), горы — полная амплитуда.
    const amplitude =
      NOISE.FLAT_AMPLITUDE * (1 - mountainMask) + NOISE.MOUNTAIN_AMPLITUDE * mountainMask;

    const combined = blendedShape * amplitude * continentMask;

    return combined * WORLD.MAX_TERRAIN_HEIGHT - WORLD.MAX_TERRAIN_HEIGHT * 0.08;
  }

  /** Fractal Brownian Motion с обрезкой октав по частоте Найквиста сетки. */
  private fbm(x: number, z: number, maxFrequency: number): number {
    let amplitude = 1;
    let frequency = NOISE.DETAIL_FREQUENCY;
    let sum = 0;
    let maxAmplitude = 0;

    for (let octave = 0; octave < NOISE.OCTAVES; octave++) {
      if (frequency > maxFrequency) break; // дальше только aliasing — не считаем
      sum += this.detailNoise(x * frequency, z * frequency) * amplitude;
      maxAmplitude += amplitude;
      amplitude *= NOISE.GAIN;
      frequency *= NOISE.LACUNARITY;
    }

    // Если обрезали вообще все октавы (экстремально грубая сетка) — возвращаем 0
    // (гладкая поверхность) вместо деления на 0.
    return maxAmplitude > 0 ? sum / maxAmplitude : 0;
  }
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}
