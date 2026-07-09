import * as THREE from 'three';
import { RENDER } from '@/config/Constants';

/**
 * Обёртка над THREE.WebGLRenderer.
 *
 * Примечание по WebGPU (2026): THREE.WebGPURenderer на момент написания
 * всё ещё требует TSL-материалов (Node Materials) для полной функциональности
 * и не полностью взаимозаменяем с классическими Material/Shader без миграции
 * материалов на TSL. Чтобы Этап 1 был реальным работающим фундаментом, а не
 * заглушкой, ядро рендера построено на стабильном WebGLRenderer с ACESFilmic
 * тон-маппингом и физически корректным освещением. Миграция на
 * WebGPURenderer + TSL-материалы — запланированный отдельный этап
 * (renderer/ уже изолирует создание renderer'а в одном месте, поэтому
 * замена не потребует правок в других модулях).
 */
export class Renderer {
  readonly instance: THREE.WebGLRenderer;
  readonly canvas: HTMLCanvasElement;

  constructor(container: HTMLElement) {
    this.canvas = document.createElement('canvas');
    container.appendChild(this.canvas);

    this.instance = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      powerPreference: 'high-performance',
      logarithmicDepthBuffer: true, // критично при FAR_PLANE=60000 + близких объектах кабины
    });

    this.instance.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.instance.setSize(window.innerWidth, window.innerHeight);

    this.instance.toneMapping = THREE.ACESFilmicToneMapping;
    this.instance.toneMappingExposure = 1.0;
    this.instance.outputColorSpace = THREE.SRGBColorSpace;

    this.instance.shadowMap.enabled = true;
    this.instance.shadowMap.type = THREE.PCFSoftShadowMap;

    window.addEventListener('resize', () => this.onResize());
  }

  private onResize(): void {
    this.instance.setSize(window.innerWidth, window.innerHeight);
  }

  /** Применяет уровень качества: pixel ratio (главный рычаг производительности на слабых GPU) и тени целиком. */
  applyQuality(pixelRatioCap: number, shadowsEnabled: boolean): void {
    this.instance.setPixelRatio(Math.min(window.devicePixelRatio, pixelRatioCap));
    this.instance.shadowMap.enabled = shadowsEnabled;
  }

  render(scene: THREE.Scene, camera: THREE.Camera): void {
    this.instance.render(scene, camera);
  }
}

/** Создаёт camera с параметрами из конфига (единая точка, чтобы FOV/far-plane не разъезжались). */
export function createMainCamera(): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(
    RENDER.FOV_DEGREES,
    window.innerWidth / window.innerHeight,
    RENDER.NEAR_PLANE,
    RENDER.FAR_PLANE,
  );
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  });
  return camera;
}
