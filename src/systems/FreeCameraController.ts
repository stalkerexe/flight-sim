import * as THREE from 'three';
import { FloatingOrigin } from '@/core/FloatingOrigin';

/**
 * Свободная камера с WASD + мышь (pointer lock) и Shift/Space для вертикали.
 * Используется как "anchor" для FloatingOrigin/ChunkManager на Этапе 1,
 * пока не готова полная аэродинамическая модель в aircraft/.
 *
 * anchor — отдельный THREE.Object3D (не сама camera), потому что в будущем
 * "якорем" мира станет физическое тело самолёта, а камера будет child
 * (кабина/внешняя камера) со своим смещением — уже сейчас код Engine
 * работает через anchor.position, а не через camera.position напрямую.
 *
 * ВАЖНО: движение всегда идёт через FloatingOrigin.setWorldPosition(), а не
 * напрямую через anchor.position. anchor.position — это ЛОКАЛЬНЫЕ координаты
 * относительно текущего origin; они управляются FloatingOrigin и не должны
 * мутироваться напрямую, иначе "истинная" мировая позиция (double precision)
 * рассинхронизируется с тем, что видно на экране, и ChunkManager будет
 * стримить чанки не там, где реально находится камера.
 */
export class FreeCameraController {
  readonly anchor: THREE.Object3D;

  private readonly camera: THREE.Camera;
  private readonly domElement: HTMLElement;
  private readonly floatingOrigin: FloatingOrigin;

  private yaw = 0;
  private pitch = 0;

  private readonly keys = new Set<string>();
  private baseSpeed = 60; // м/с — крейсерская скорость легкого самолёта для ощущения масштаба мира
  private boostMultiplier = 8;

  constructor(
    camera: THREE.Camera,
    domElement: HTMLElement,
    floatingOrigin: FloatingOrigin,
    initialWorldPosition: THREE.Vector3,
  ) {
    this.camera = camera;
    this.domElement = domElement;
    this.floatingOrigin = floatingOrigin;
    this.anchor = new THREE.Object3D();
    this.floatingOrigin.register(this.anchor, initialWorldPosition);

    window.addEventListener('keydown', (e) => this.keys.add(e.code));
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));

    this.domElement.addEventListener('click', () => this.domElement.requestPointerLock());
    document.addEventListener('mousemove', (e) => this.onMouseMove(e));
  }

  private onMouseMove(e: MouseEvent): void {
    if (document.pointerLockElement !== this.domElement) return;
    const sensitivity = 0.0022;
    this.yaw -= e.movementX * sensitivity;
    this.pitch -= e.movementY * sensitivity;
    this.pitch = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, this.pitch));
  }

  update(dt: number): void {
    const quaternion = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ'),
    );

    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(quaternion);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(quaternion);
    const up = new THREE.Vector3(0, 1, 0);

    const speed = this.baseSpeed * (this.keys.has('ShiftLeft') ? this.boostMultiplier : 1);
    const move = new THREE.Vector3();

    if (this.keys.has('KeyW')) move.add(forward);
    if (this.keys.has('KeyS')) move.sub(forward);
    if (this.keys.has('KeyD')) move.add(right);
    if (this.keys.has('KeyA')) move.sub(right);
    if (this.keys.has('Space')) move.add(up);
    if (this.keys.has('ControlLeft')) move.sub(up);

    if (move.lengthSq() > 0) {
      move.normalize().multiplyScalar(speed * dt);
      const worldPos = this.floatingOrigin.getWorldPosition(this.anchor);
      worldPos.add(move);
      this.floatingOrigin.setWorldPosition(this.anchor, worldPos); // сихронизирует anchor.position локально
    }

    this.anchor.quaternion.copy(quaternion);
    this.camera.position.copy(this.anchor.position);
    this.camera.quaternion.copy(quaternion);
  }
}
