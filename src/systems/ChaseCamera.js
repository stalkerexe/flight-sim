import * as THREE from 'three';
/**
 * Камера от третьего лица, следующая за самолётом с экспоненциальным
 * сглаживанием (а не жёстко прикреплённая) — резкие манёвры самолёта не
 * дёргают камеру один к одному.
 *
 * Работает целиком в ЛОКАЛЬНЫХ (относительно текущего floating origin)
 * координатах: желаемая позиция каждый кадр пересчитывается заново из
 * текущей локальной позиции/ориентации самолёта, поэтому отдельная
 * регистрация в FloatingOrigin камере не нужна.
 *
 * Камера привязана к нижней части экрана — следует за самолётом с фиксированным
 * смещением назад-вниз, чтобы самолёт всегда был виден в нижней трети кадра.
 */
export class ChaseCamera {
    /** Смещение камеры от самолёта в его локальных осях: назад и вниз для вида снизу. */
    localOffset = new THREE.Vector3(0, -1.5, 6);
    /** Скорость сглаживания (выше — резче следует за целью), 1/с. */
    smoothRate = 4;
    smoothedPosition = new THREE.Vector3();
    smoothedQuaternion = new THREE.Quaternion();
    initialized = false;
    update(dt, aircraftGroup, camera) {
        // Вычисляем желаемую позицию камеры: смещение в локальных осях самолёта + мировая позиция
        const desiredPosition = this.localOffset.clone().applyQuaternion(aircraftGroup.quaternion);
        desiredPosition.add(aircraftGroup.position);
        // Камера смотрит туда же, куда самолёт, но с небольшим подъёмом вверх для обзора
        const desiredQuaternion = aircraftGroup.quaternion.clone();
        if (!this.initialized) {
            this.smoothedPosition.copy(desiredPosition);
            this.smoothedQuaternion.copy(desiredQuaternion);
            this.initialized = true;
        }
        else {
            // Плавное следование с экспоненциальным затуханием
            const t = 1 - Math.exp(-this.smoothRate * dt);
            this.smoothedPosition.lerp(desiredPosition, t);
            this.smoothedQuaternion.slerp(desiredQuaternion, t);
        }
        camera.position.copy(this.smoothedPosition);
        camera.quaternion.copy(this.smoothedQuaternion);
        // Небольшой наклон камеры вверх, чтобы самолёт был в нижней части экрана
        camera.rotateX(0.15);
    }
}
