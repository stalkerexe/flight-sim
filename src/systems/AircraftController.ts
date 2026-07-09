import { Aircraft, type AircraftControlInput } from '@/aircraft/Aircraft';
import { TerrainNoise } from '@/procedural/Noise';
import { FloatingOrigin } from '@/core/FloatingOrigin';

/**
 * Обрабатывает клавиатурный ввод и прогоняет физику самолёта каждый кадр.
 *
 * Схема управления — классическая авиасимуляторная (не WASD-шутер, как было
 * у FreeCameraController):
 *   W / S — тангаж (нос вниз / нос вверх)
 *   A / D — крен влево / вправо
 *   Q / E — рысканье (педали руля направления) влево / вправо
 *   Shift (удержание) — увеличить газ
 *   Ctrl  (удержание) — уменьшить газ
 *   R (после крушения) — перезапуск с исходной позиции
 */
export class AircraftController {
  readonly aircraft: Aircraft;

  private readonly keys = new Set<string>();
  private readonly floatingOrigin: FloatingOrigin;

  constructor(floatingOrigin: FloatingOrigin, terrainNoise: TerrainNoise) {
    this.floatingOrigin = floatingOrigin;
    this.aircraft = new Aircraft(terrainNoise);
    this.aircraft.register(floatingOrigin);

    window.addEventListener('keydown', (e) => {
      this.keys.add(e.code);
      if (e.code === 'KeyR' && this.aircraft.crashed) {
        this.aircraft.reset(this.floatingOrigin);
      }
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
  }

  update(dt: number, floatingOrigin: FloatingOrigin): void {
    const input: AircraftControlInput = {
      pitch: axis(this.keys, 'KeyS', 'KeyW'),
      roll: axis(this.keys, 'KeyD', 'KeyA'),
      yaw: axis(this.keys, 'KeyE', 'KeyQ'),
      throttleDelta: axis(this.keys, 'ShiftLeft', 'ControlLeft'),
    };

    this.aircraft.update(dt, input, floatingOrigin);
  }
}

/** Возвращает -1, 0 или 1 в зависимости от того, какая из двух клавиш (или ни одна) нажата. */
function axis(keys: ReadonlySet<string>, positiveKey: string, negativeKey: string): number {
  let value = 0;
  if (keys.has(positiveKey)) value += 1;
  if (keys.has(negativeKey)) value -= 1;
  return value;
}
