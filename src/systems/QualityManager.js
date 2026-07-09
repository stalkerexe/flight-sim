import { QUALITY_TIERS, DEFAULT_QUALITY_TIER_INDEX } from '@/config/Constants';
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
    tierIndex = DEFAULT_QUALITY_TIER_INDEX;
    fpsHistory = [];
    lastChangeAtMs = 0;
    static MIN_SAMPLES = 40;
    static COOLDOWN_MS = 5000;
    static DOWNGRADE_FPS_THRESHOLD = 33;
    static UPGRADE_FPS_THRESHOLD = 55;
    get currentTier() {
        return QUALITY_TIERS[this.tierIndex];
    }
    /** Вызывать каждый кадр. Возвращает новый tier, ЕСЛИ качество только что переключилось, иначе null. */
    reportFrame(fps, nowMs) {
        this.fpsHistory.push(fps);
        if (this.fpsHistory.length > 120)
            this.fpsHistory.shift();
        if (nowMs - this.lastChangeAtMs < QualityManager.COOLDOWN_MS)
            return null;
        if (this.fpsHistory.length < QualityManager.MIN_SAMPLES)
            return null;
        const avg = this.fpsHistory.reduce((a, b) => a + b, 0) / this.fpsHistory.length;
        if (avg < QualityManager.DOWNGRADE_FPS_THRESHOLD && this.tierIndex > 0) {
            this.tierIndex--;
        }
        else if (avg > QualityManager.UPGRADE_FPS_THRESHOLD &&
            this.tierIndex < QUALITY_TIERS.length - 1) {
            this.tierIndex++;
        }
        else {
            return null;
        }
        this.lastChangeAtMs = nowMs;
        this.fpsHistory.length = 0;
        return this.currentTier;
    }
}
