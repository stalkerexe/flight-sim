import { Aircraft } from '@/aircraft/Aircraft';
/**
 * Обрабатывает клавиатурный ввод и прогоняет физику самолёта каждый кадр.
 *
 * Схема управления — классическая авиасимуляторная:
 *   W — тангаж вверх (нос вверх, набор высоты)
 *   S — тангаж вниз (нос вниз, снижение)
 *   A / D — крен влево / вправо
 *   Q / E — рысканье (педали руля направления) влево / вправо (Q лево, E право)
 *   Shift (удержание) — увеличить газ
 *   Ctrl  (удержание) — уменьшить газ
 *   R (после крушения) — перезапуск с исходной позиции
 *
 * ВАЖНО: Для набора высоты нужно:
 *   1. Увеличить газ (удерживать Shift) — скорость растёт
 *   2. Плавно потянуть стик на себя (W) — нос поднимется, самолёт начнёт набирать высоту
 *
 * Если держать нос слишком высоко без достаточной скорости — будет срыв потока (stall),
 * самолёт потеряет подъёмную силу и начнёт падать. При падении:
 *   1. Отпустить W (дать нос опуститься)
 *   2. Полный газ (Shift)
 *   3. Когда скорость вырастет — снова плавно потянуть на себя (W)
 */
export class AircraftController {
    aircraft;
    keys = new Set();
    floatingOrigin;
    constructor(floatingOrigin, terrainNoise) {
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
    update(dt, floatingOrigin) {
        const input = {
            pitch: axis(this.keys, 'KeyW', 'KeyS'), // W = нос вверх, S = нос вниз (классическое авиационное управление)
            roll: axis(this.keys, 'KeyD', 'KeyA'),
            yaw: axis(this.keys, 'KeyQ', 'KeyE'), // Q = рысканье влево, E = рысканье вправо (поменяли местами для удобства)
            throttleDelta: axis(this.keys, 'ShiftLeft', 'ControlLeft'),
        };
        this.aircraft.update(dt, input, floatingOrigin);
    }
}
/** Возвращает -1, 0 или 1 в зависимости от того, какая из двух клавиш (или ни одна) нажата. */
function axis(keys, positiveKey, negativeKey) {
    let value = 0;
    if (keys.has(positiveKey))
        value += 1;
    if (keys.has(negativeKey))
        value -= 1;
    return value;
}
