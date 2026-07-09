import * as THREE from 'three';

/**
 * Камера от третьего лица, следующая за самолётом.
 * 
 * Ключевое изменение: камера игнорирует крен (roll) самолёта при расчёте позиции,
 * чтобы при поворотах она не уходила вбок или под землю. Она всегда остаётся
 * сзади и снизу относительно горизонта, обеспечивая стабильный обзор.
 * 
 * Самолёт всегда находится в нижней части экрана.
 */
export class ChaseCamera {
  /** Дистанция камеры от самолёта */
  private readonly distance = 8;
  /** Высота камеры над самолётом (отрицательная = ниже самолёта) */
  private readonly heightOffset = -2.5;
  /** Скорость сглаживания позиции (1/с) */
  private readonly posSmoothRate = 6;
  /** Скорость сглаживания поворота камеры (1/с) */
  private readonly rotSmoothRate = 4;
  
  private readonly smoothedPosition = new THREE.Vector3();
  private readonly currentLookAt = new THREE.Vector3();
  private initialized = false;

  update(dt: number, aircraftGroup: THREE.Object3D, camera: THREE.Camera): void {
    // Получаем направление взгляда самолёта (вперёд)
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(aircraftGroup.quaternion);
    forward.y = 0; // Игнорируем вертикальную составляющую для направления "куда летим" по горизонту
    forward.normalize();

    // Если самолёт смотрит вертикально вверх/вниз, forward может стать нулевым
    if (forward.lengthSq() < 0.001) {
      forward.set(0, 0, -1).applyQuaternion(aircraftGroup.quaternion);
      forward.y = 0;
      if (forward.lengthSq() < 0.001) forward.set(0, 0, 1);
      forward.normalize();
    }

    // Желаемая позиция камеры: сзади по направлению полёта + смещение вниз
    const desiredPosition = aircraftGroup.position.clone();
    desiredPosition.addScaledVector(forward, -this.distance); // Сзади
    desiredPosition.y += this.heightOffset; // Ниже

    // Точка, куда смотрит камера (немного выше самолёта, чтобы он был внизу экрана)
    const targetLookAt = aircraftGroup.position.clone();
    targetLookAt.y += 1.5; // Смотрим чуть выше центра самолёта -> сам самолёт внизу кадра

    if (!this.initialized) {
      this.smoothedPosition.copy(desiredPosition);
      this.currentLookAt.copy(targetLookAt);
      this.initialized = true;
    } else {
      // Плавное следование
      const posT = 1 - Math.exp(-this.posSmoothRate * dt);
      this.smoothedPosition.lerp(desiredPosition, posT);
      
      const rotT = 1 - Math.exp(-this.rotSmoothRate * dt);
      this.currentLookAt.lerp(targetLookAt, rotT);
    }

    camera.position.copy(this.smoothedPosition);
    camera.lookAt(this.currentLookAt);
  }
}
