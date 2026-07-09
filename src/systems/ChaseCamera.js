import * as THREE from 'three';
/**
 * Камера от третьего лица, следующая за самолётом ("вид с хвоста").
 *
 * Камера жёстко привязана к позиции самолёта: находится позади и немного ниже,
 * следуя за всеми манёврами (тангаж, крен, рысканье). Самолёт всегда виден
 * в нижней части экрана, камера смотрит чуть выше центра самолёта.
 *
 * Плавное следование обеспечивается lerp-сглаживанием позиции и точки взгляда.
 */
export class ChaseCamera {
    /** Дистанция камеры от самолёта (позади) */
    distance = 10;
    /** Вертикальное смещение камеры относительно самолёта (отрицательное = ниже) */
    heightOffset = -2;
    /** Боковое смещение (обычно 0, если нужно строго по центру хвоста) */
    lateralOffset = 0;
    /** Насколько выше центра самолёта смотрим (чтобы самолёт был внизу экрана) */
    lookAtOffset = 1.8;
    /** Скорость сглаживания позиции (1/с) */
    posSmoothRate = 5;
    /** Скорость сглаживания точки взгляда (1/с) */
    lookAtSmoothRate = 4;
    smoothedPosition = new THREE.Vector3();
    currentLookAt = new THREE.Vector3();
    initialized = false;
    update(dt, aircraftGroup, camera) {
        // Получаем направление "вперёд" из локальных координат самолёта (-Z)
        const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(aircraftGroup.quaternion);
        // Направление "вправо" из локальных координат (+X)
        const right = new THREE.Vector3(1, 0, 0).applyQuaternion(aircraftGroup.quaternion);
        // Направление "вверх" из локальных координат (+Y)
        const up = new THREE.Vector3(0, 1, 0).applyQuaternion(aircraftGroup.quaternion);
        // Желаемая позиция камеры: сзади + смещение вниз + боковое смещение
        // Отступаем назад по направлению forward, добавляем смещения по осям
        const desiredPosition = aircraftGroup.position.clone();
        desiredPosition.addScaledVector(forward, -this.distance); // Позади самолёта
        desiredPosition.addScaledVector(up, this.heightOffset); // Ниже самолёта
        desiredPosition.addScaledVector(right, this.lateralOffset); // Боковое смещение (если нужно)
        // Точка взгляда: чуть выше центра самолёта, чтобы он был в нижней части кадра
        const targetLookAt = aircraftGroup.position.clone();
        targetLookAt.addScaledVector(up, this.lookAtOffset);
        if (!this.initialized) {
            this.smoothedPosition.copy(desiredPosition);
            this.currentLookAt.copy(targetLookAt);
            this.initialized = true;
        }
        else {
            // Плавное следование позиции
            const posT = 1 - Math.exp(-this.posSmoothRate * dt);
            this.smoothedPosition.lerp(desiredPosition, posT);
            // Плавное следование точки взгляда
            const lookAtT = 1 - Math.exp(-this.lookAtSmoothRate * dt);
            this.currentLookAt.lerp(targetLookAt, lookAtT);
        }
        camera.position.copy(this.smoothedPosition);
        camera.lookAt(this.currentLookAt);
    }
}
