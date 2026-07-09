import * as THREE from 'three';
import { Renderer, createMainCamera } from '@/renderer/Renderer';
import { Sky } from '@/renderer/Sky';
import { FloatingOrigin } from '@/core/FloatingOrigin';
import { ChunkManager } from '@/world/ChunkManager';
import { Water } from '@/world/Water';
import { AircraftController } from '@/systems/AircraftController';
import { ChaseCamera } from '@/systems/ChaseCamera';
import { QualityManager } from '@/systems/QualityManager';
import { InstrumentPanel } from '@/ui/InstrumentPanel';
import { TerrainNoise } from '@/procedural/Noise';
import { RENDER, NOISE } from '@/config/Constants';

/**
 * Engine — точка сборки всех систем и главный game loop.
 *
 * Якорь мира (объект, чью мировую позицию видят FloatingOrigin/ChunkManager) —
 * теперь самолёт (`AircraftController.aircraft.group`), а не свободная камера,
 * как на предыдущих этапах. Камера — ChaseCamera от третьего лица, следующая
 * за самолётом со сглаживанием, сама по себе в FloatingOrigin не участвует
 * (пересчитывается из уже синхронизированной локальной позиции самолёта
 * каждый кадр, накопления погрешности нет).
 *
 * QualityManager измеряет скользящий FPS и переключает пресет качества
 * (радиус LOD-колец, тени, pixel ratio) — на слабых ПК движок сам уходит
 * на более лёгкий пресет вместо фиксированной просадки FPS навсегда.
 */
export class Engine {
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly renderer: Renderer;
  private readonly sky: Sky;
  private readonly sunLight: THREE.DirectionalLight;
  private readonly ambientLight: THREE.HemisphereLight;

  private readonly floatingOrigin: FloatingOrigin;
  private readonly chunkManager: ChunkManager;
  private readonly water: Water;
  private readonly aircraftController: AircraftController;
  private readonly chaseCamera: ChaseCamera;
  private readonly qualityManager: QualityManager;
  private readonly instrumentPanel: InstrumentPanel;

  private readonly clock = new THREE.Clock();
  private animationHandle = 0;

  private readonly statsPanel: HTMLElement | null;
  private readonly crashPanel: HTMLElement | null;
  private frameCount = 0;
  private fpsAccumTime = 0;
  private fps = 0;

  constructor(container: HTMLElement) {
    this.scene = new THREE.Scene();
    this.camera = createMainCamera();
    this.renderer = new Renderer(container);

    this.sky = new Sky();
    this.scene.add(this.sky.mesh);
    this.sky.setSunDirection(new THREE.Vector3(0.4, 0.55, -0.3));

    this.sunLight = new THREE.DirectionalLight(0xfff3d6, 3.2);
    this.sunLight.position.copy(this.sky.getSunDirection()).multiplyScalar(2000);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.set(RENDER.SHADOW_MAP_SIZE, RENDER.SHADOW_MAP_SIZE);
    this.sunLight.shadow.camera.near = 10;
    this.sunLight.shadow.camera.far = 4000;
    this.sunLight.shadow.camera.left = -1500;
    this.sunLight.shadow.camera.right = 1500;
    this.sunLight.shadow.camera.top = 1500;
    this.sunLight.shadow.camera.bottom = -1500;
    this.scene.add(this.sunLight);
    this.scene.add(this.sunLight.target);

    this.ambientLight = new THREE.HemisphereLight(0x9fc4e8, 0x3a3226, 0.6);
    this.scene.add(this.ambientLight);

    this.scene.fog = new THREE.FogExp2(0xbfd4e0, 0.00004);

    this.qualityManager = new QualityManager();
    this.renderer.applyQuality(
      this.qualityManager.currentTier.pixelRatioCap,
      this.qualityManager.currentTier.shadowsEnabled,
    );

    this.floatingOrigin = new FloatingOrigin();
    this.chunkManager = new ChunkManager(
      this.scene,
      this.floatingOrigin,
      this.qualityManager.currentTier.lodRingRadiusMeters,
    );

    this.water = new Water();
    this.scene.add(this.water.mesh);

    this.aircraftController = new AircraftController(
      this.floatingOrigin,
      new TerrainNoise(NOISE.SEED),
    );
    this.scene.add(this.aircraftController.aircraft.group);
    this.chaseCamera = new ChaseCamera();

    this.statsPanel = document.getElementById('stats-panel');
    this.crashPanel = document.getElementById('crash-message');
    this.instrumentPanel = new InstrumentPanel();
  }

  start(): void {
    this.clock.start();
    this.loop();
  }

  stop(): void {
    cancelAnimationFrame(this.animationHandle);
    this.chunkManager.dispose();
  }

  private loop = (): void => {
    this.animationHandle = requestAnimationFrame(this.loop);
    const dt = Math.min(this.clock.getDelta(), 0.1); // clamp — защита от скачка dt при потере фокуса вкладки

    this.aircraftController.update(dt, this.floatingOrigin);
    this.chaseCamera.update(dt, this.aircraftController.aircraft.group, this.camera);

    const anchorWorldPos = this.floatingOrigin.getWorldPosition(
      this.aircraftController.aircraft.group,
    );
    this.floatingOrigin.update(anchorWorldPos);
    this.chunkManager.update(anchorWorldPos);
    this.water.update(this.camera.position.x, this.camera.position.z, this.floatingOrigin.getOrigin().y);

    // Солнечный свет и небо следуют за игроком по X/Z (сдвиг direction light target),
    // чтобы shadow frustum всегда покрывал зону вокруг игрока, а не весь мир.
    this.sunLight.position.set(
      this.aircraftController.aircraft.group.position.x + this.sky.getSunDirection().x * 2000,
      this.sky.getSunDirection().y * 2000,
      this.aircraftController.aircraft.group.position.z + this.sky.getSunDirection().z * 2000,
    );
    this.sunLight.target.position.copy(this.aircraftController.aircraft.group.position);
    this.sunLight.target.updateMatrixWorld();

    this.renderer.render(this.scene, this.camera);
    this.instrumentPanel.update(this.aircraftController.aircraft, this.floatingOrigin);
    this.updateStats(dt);
  };

  private updateStats(dt: number): void {
    this.frameCount++;
    this.fpsAccumTime += dt;
    if (this.fpsAccumTime >= 0.5) {
      this.fps = Math.round(this.frameCount / this.fpsAccumTime);
      this.frameCount = 0;
      this.fpsAccumTime = 0;

      const newTier = this.qualityManager.reportFrame(this.fps, performance.now());
      if (newTier) {
        this.chunkManager.setRingRadiusMeters(newTier.lodRingRadiusMeters);
        this.renderer.applyQuality(newTier.pixelRatioCap, newTier.shadowsEnabled);
      }
    }

    if (this.statsPanel) {
      const origin = this.floatingOrigin.getOrigin();
      const aircraft = this.aircraftController.aircraft;
      this.statsPanel.textContent =
        `FPS: ${this.fps}  |  Quality: ${this.qualityManager.currentTier.name}\n` +
        `Chunks active: ${this.chunkManager.activeChunkCount} (draw calls: ${this.chunkManager.drawCallCount}, pending: ${this.chunkManager.pendingBuildCount})\n` +
        `Speed: ${aircraft.speed.toFixed(0)} m/s  |  Throttle: ${(aircraft.throttle * 100).toFixed(0)}%\n` +
        `World pos: ${origin.x.toFixed(0)}, ${origin.y.toFixed(0)}, ${origin.z.toFixed(0)}\n` +
        `Alt (local Y): ${aircraft.group.position.y.toFixed(0)} m`;
      this.statsPanel.style.whiteSpace = 'pre';
    }

    if (this.crashPanel) {
      this.crashPanel.style.display = this.aircraftController.aircraft.crashed ? 'block' : 'none';
    }
  }
}
