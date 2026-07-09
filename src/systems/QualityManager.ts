import { QUALITY_TIERS, DEFAULT_QUALITY_TIER_INDEX } from '@/config/Constants';

export type QualityTier = (typeof QUALITY_TIERS)[number];

/**
 * Следит за скользящим средним FPS и переключает уровень качества, если оно
 * стабильно ниже/выше пороговых значений. Есть cooldown между переключениями
 * и требование минимального числа образцов — иначе на одиночных просадках
 * (например, при подгрузке нового батча чанков) качество начало бы дёргаться
 * туда-сюда, что заметнее и хуже, чем сама просадка.
 *
 * Не трогает настройки сама — только решает, какой QualityTier должен быть
 * активен сейчас, и уведомляет через возврат из reportFrame(); применение
 * (сменить радиусы чанков, включить/выключить тени, pixel ratio) — забота
 * вызывающего кода (Engine.ts).
 */
export class QualityManager {
  private tierIndex = DEFAULT_QUALITY_TIER_INDEX;
  private readonly fpsHistory: number[] = [];
  private lastChangeAtMs = 0;

  private static readonly MIN_SAMPLES = 40;
  private static readonly COOLDOWN_MS = 5000;
  private static readonly DOWNGRADE_FPS_THRESHOLD = 33;
  private static readonly UPGRADE_FPS_THRESHOLD = 55;

  get currentTier(): QualityTier {
    return QUALITY_TIERS[this.tierIndex]!;
  }

  /** Вызывать каждый кадр. Возвращает новый tier, ЕСЛИ качество только что переключилось, иначе null. */
  reportFrame(fps: number, nowMs: number): QualityTier | null {
    this.fpsHistory.push(fps);
    if (this.fpsHistory.length > 120) this.fpsHistory.shift();

    if (nowMs - this.lastChangeAtMs < QualityManager.COOLDOWN_MS) return null;
    if (this.fpsHistory.length < QualityManager.MIN_SAMPLES) return null;

    const avg = this.fpsHistory.reduce((a, b) => a + b, 0) / this.fpsHistory.length;

    if (avg < QualityManager.DOWNGRADE_FPS_THRESHOLD && this.tierIndex > 0) {
      this.tierIndex--;
    } else if (
      avg > QualityManager.UPGRADE_FPS_THRESHOLD &&
      this.tierIndex < QUALITY_TIERS.length - 1
    ) {
      this.tierIndex++;
    } else {
      return null;
    }

    this.lastChangeAtMs = nowMs;
    this.fpsHistory.length = 0;
    return this.currentTier;
  }
}
