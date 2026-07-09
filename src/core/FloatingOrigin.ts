import * as THREE from 'three';
import { FLOATING_ORIGIN } from '@/config/Constants';

/**
 * FloatingOrigin решает фундаментальную проблему бесконечных миров:
 * WebGL/WebGPU используют float32 для позиций вершин. У float32 ~7 значащих
 * десятичных цифр точности. На дистанции ~100 000 м от начала координат
 * ошибка округления становится заметна как "дрожание" (jitter) геометрии
 * и трещины между чанками.
 *
 * Решение: мировые координаты объекта хранятся в double precision
 * (обычный JS number — это float64) в `worldPosition`. Позиция объекта
 * в THREE.Object3D — это ЛОКАЛЬНАЯ позиция относительно текущего origin.
 * Когда камера отдаляется от origin дальше REBASE_THRESHOLD, origin
 * "телепортируется" к камере, а все зарегистрированные объекты сдвигаются
 * на дельту — визуально ничего не меняется, но локальные координаты
 * снова становятся маленькими числами.
 *
 * Все системы мира (ChunkManager, самолёт, объекты) обязаны хранить
 * свою "истинную" позицию в мировых double-координатах через этот класс,
 * а не напрямую в object3d.position.
 */
export class FloatingOrigin {
  /** Текущее смещение origin в мировых координатах (double precision, метры). */
  private originWorld = { x: 0, y: 0, z: 0 };

  /** Объекты, которые двигаются вместе с origin при ребейзинге. */
  private registered = new Set<THREE.Object3D>();

  /** Мировая (double) позиция каждого зарегистрированного объекта. */
  private worldPositions = new Map<THREE.Object3D, THREE.Vector3>();

  /** Колбэки, вызываемые после ребейза (например, ChunkManager должен пересчитать видимые чанки). */
  private onRebaseCallbacks: Array<(delta: THREE.Vector3) => void> = [];

  register(object: THREE.Object3D, initialWorldPosition: THREE.Vector3): void {
    this.registered.add(object);
    this.worldPositions.set(object, initialWorldPosition.clone());
    this.syncLocalPosition(object);
  }

  unregister(object: THREE.Object3D): void {
    this.registered.delete(object);
    this.worldPositions.delete(object);
  }

  /** Установить мировую (double) позицию объекта — источник истины. */
  setWorldPosition(object: THREE.Object3D, worldPos: THREE.Vector3): void {
    const stored = this.worldPositions.get(object);
    if (stored) {
      stored.copy(worldPos);
    } else {
      this.worldPositions.set(object, worldPos.clone());
    }
    this.syncLocalPosition(object);
  }

  getWorldPosition(object: THREE.Object3D): THREE.Vector3 {
    return this.worldPositions.get(object) ?? object.position.clone();
  }

  onRebase(callback: (delta: THREE.Vector3) => void): void {
    this.onRebaseCallbacks.push(callback);
  }

  /** Текущий origin в мировых координатах — нужен для генерации террейна в правильном месте. */
  getOrigin(): Readonly<{ x: number; y: number; z: number }> {
    return this.originWorld;
  }

  /**
   * Вызывается каждый кадр с мировой позицией "якорного" объекта (обычно камеры/самолёта).
   * Если объект удалился от origin дальше порога — ребейзим всю сцену.
   */
  update(anchorWorldPosition: THREE.Vector3): void {
    const dx = anchorWorldPosition.x - this.originWorld.x;
    const dy = anchorWorldPosition.y - this.originWorld.y;
    const dz = anchorWorldPosition.z - this.originWorld.z;
    const distSq = dx * dx + dy * dy + dz * dz;

    if (distSq > FLOATING_ORIGIN.REBASE_THRESHOLD ** 2) {
      this.rebase(dx, dy, dz);
    }
  }

  private rebase(dx: number, dy: number, dz: number): void {
    this.originWorld.x += dx;
    this.originWorld.y += dy;
    this.originWorld.z += dz;

    for (const object of this.registered) {
      this.syncLocalPosition(object);
    }

    const delta = new THREE.Vector3(-dx, -dy, -dz);
    for (const cb of this.onRebaseCallbacks) cb(delta);
  }

  private syncLocalPosition(object: THREE.Object3D): void {
    const world = this.worldPositions.get(object);
    if (!world) return;
    object.position.set(
      world.x - this.originWorld.x,
      world.y - this.originWorld.y,
      world.z - this.originWorld.z,
    );
  }
}
