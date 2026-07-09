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
 */
export class ChaseCamera {
    /** Смещение камеры от самолёта в его локальных осях: назад и вверх. */
    localOffset = new THREE.Vector3(0, 2.2, 8.5);
    /** Скорость сглаживания (выше — резче следует за целью), 1/с. */
    smoothRate = 6;
    smoothedPosition = new THREE.Vector3();
    smoothedQuaternion = new THREE.Quaternion();
    initialized = false;
    update(dt, aircraftGroup, camera) {
        const desiredPosition = this.localOffset.clone().applyQuaternion(aircraftGroup.quaternion);
        desiredPosition.add(aircraftGroup.position);
        const desiredQuaternion = aircraftGroup.quaternion.clone();
        if (!this.initialized) {
            this.smoothedPosition.copy(desiredPosition);
            this.smoothedQuaternion.copy(desiredQuaternion);
            this.initialized = true;
        }
        else {
            const t = 1 - Math.exp(-this.smoothRate * dt);
            this.smoothedPosition.lerp(desiredPosition, t);
            this.smoothedQuaternion.slerp(desiredQuaternion, t);
        }
        camera.position.copy(this.smoothedPosition);
        camera.quaternion.copy(this.smoothedQuaternion);
        // Небольшой наклон вниз, чтобы самолёт был виден в нижней трети кадра, а не строго по центру.
        camera.rotateX(-0.12);
    }
}
