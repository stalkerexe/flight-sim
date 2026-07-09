import * as THREE from 'three';
import { FloatingOrigin } from '@/core/FloatingOrigin';
import { TerrainNoise } from '@/procedural/Noise';
import { resolutionForLod, chunkSizeForLod } from '@/procedural/TerrainGeometryBuilder';
import { computeAerodynamics } from '@/physics/FlightModel';
import { AIRCRAFT, FLIGHT } from '@/config/Constants';

// Частота Найквиста сетки LOD0 — та же детализация рельефа, что видна игроку
// вблизи. Используем её для проверки столкновений, чтобы самолёт "натыкался"
// на тот же рельеф, что отрисован, а не на более грубую/сглаженную версию.
const LOD0_STEP = chunkSizeForLod(0) / (resolutionForLod(0) - 1);
const LOD0_NYQUIST_FREQUENCY = 1 / (2 * LOD0_STEP);

export interface AircraftControlInput {
  /** -1..1, стик от себя/на себя (нос вниз/вверх). */
  pitch: number;
  /** -1..1, крен влево/вправо. */
  roll: number;
  /** -1..1, рысканье (педали руля направления). */
  yaw: number;
  /** -1, 0 или 1 — газ убавить/держать/добавить. */
  throttleDelta: number;
}

/**
 * Управляемое летающее тело с полной (насколько разумно без CFD) аэродинамикой.
 * Сами силы считает physics/FlightModel.ts (чистые функции от скорости/ориентации/
 * газа) — этот класс отвечает за интеграцию по времени, ввод, коллизии и геометрию.
 *
 * ЧЕСТНО про оставшиеся упрощения (подробный список — в Constants.ts у FLIGHT):
 * постоянная плотность воздуха, общая "эффективность рулей" вместо отдельных
 * control surfaces, нет ground effect. Но подъёмная сила и сопротивление
 * теперь настоящие функции угла атаки со срывом потока — качественно другой
 * уровень, чем "подъёмная сила ~ скорость вдоль носа" в предыдущей версии.
 */
export class Aircraft {
  readonly group: THREE.Group;
  readonly velocity = new THREE.Vector3();
  throttle: number = AIRCRAFT.START_THROTTLE;
  /** true, если самолёт врезался в рельеф — физика управления заморожена до reset(). */
  crashed = false;
  /** Угол атаки, градусы — обновляется каждый update(), нужен приборной панели. */
  angleOfAttackDeg = 0;
  /** true, если сейчас за критическим углом атаки — подъёмная сила уже просела. */
  stalled = false;
  /** Высота земли под самолётом на момент последнего update() — переиспользуется приборной панелью (высотомер AGL), чтобы не считать noise дважды за кадр. */
  lastGroundHeight = 0;

  private orientation = new THREE.Quaternion();
  private readonly terrainNoise: TerrainNoise;

  constructor(terrainNoise: TerrainNoise) {
    this.group = buildAircraftMesh();
    this.terrainNoise = terrainNoise;
  }

  /** Регистрирует самолёт в FloatingOrigin со стартовой мировой позицией и скоростью. Вызвать один раз перед первым update(). */
  register(floatingOrigin: FloatingOrigin): void {
    const [x, y, z] = AIRCRAFT.START_POSITION;
    floatingOrigin.register(this.group, new THREE.Vector3(x, y, z));
    // Стартовая скорость вдоль носа — самолёт должен появляться уже в полёте
    // (см. развёрнутый комментарий у AIRCRAFT.START_SPEED в Constants.ts).
    this.velocity.copy(this.forward).multiplyScalar(AIRCRAFT.START_SPEED);
  }

  update(dt: number, input: AircraftControlInput, floatingOrigin: FloatingOrigin): void {
    if (this.crashed) return; // физика заморожена до reset() — см. AircraftController (клавиша R)

    this.throttle = clamp01(this.throttle + input.throttleDelta * AIRCRAFT.THROTTLE_RATE * dt);

    // Аэродинамику (подъёмная сила/сопротивление/срыв потока) считаем ДО поворота
    // по текущей ориентации/скорости — угол атаки должен отражать состояние
    // самолёта на начало кадра, а не "подсмотренное" после применения ввода.
    const aero = computeAerodynamics(this.velocity, this.orientation, this.throttle);
    this.angleOfAttackDeg = aero.angleOfAttackDeg;
    this.stalled = aero.stalled;

    // Эффективность рулей падает на малой скорости (реальный самолёт на
    // рулении по земле или сразу после сваливания слушается управления вяло) —
    // масштабируем угловые скорости на aero.controlEffectiveness (0..1,
    // растёт квадратично со скоростью, см. FLIGHT.CONTROL_EFFECTIVENESS_REF_SPEED).
    const pitchAngle = input.pitch * AIRCRAFT.PITCH_RATE * aero.controlEffectiveness * dt;
    const rollAngle = input.roll * AIRCRAFT.ROLL_RATE * aero.controlEffectiveness * dt;
    const yawAngle = input.yaw * AIRCRAFT.YAW_RATE * aero.controlEffectiveness * dt;

    // Углы поворота применяются в ЛОКАЛЬНЫХ осях самолёта (body space) —
    // накопление через quaternion.multiply, а не абсолютный Euler каждый
    // кадр, чтобы избежать gimbal lock при полных бочках/петлях.
    const deltaRotation = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(pitchAngle, yawAngle, -rollAngle, 'XYZ'),
    );
    this.orientation.multiply(deltaRotation);
    this.orientation.normalize();

    this.velocity.addScaledVector(aero.accelerationWorld, dt);

    // Жёсткий потолок скорости — независимо от баланса сил в FlightModel
    // (например, затяжное пикирование может дать ускорение сверх равновесия).
    if (this.velocity.length() > FLIGHT.MAX_SPEED) {
      this.velocity.setLength(FLIGHT.MAX_SPEED);
    }

    const worldPos = floatingOrigin.getWorldPosition(this.group);
    worldPos.addScaledVector(this.velocity, dt);

    // Проверка столкновения с рельефом: та же чистая функция высоты, что
    // строит видимую геометрию (procedural/Noise.ts), с той же частотой
    // Найквиста, что и ближний LOD0 — самолёт "натыкается" ровно на тот
    // рельеф, который видит игрок, а не на приближение.
    const groundHeight = this.terrainNoise.getHeight(worldPos.x, worldPos.z, LOD0_NYQUIST_FREQUENCY);
    this.lastGroundHeight = groundHeight;
    if (worldPos.y < groundHeight + AIRCRAFT.COLLISION_MARGIN) {
      worldPos.y = groundHeight + AIRCRAFT.COLLISION_MARGIN;
      this.velocity.set(0, 0, 0);
      this.crashed = true;
    }

    floatingOrigin.setWorldPosition(this.group, worldPos);
    this.group.quaternion.copy(this.orientation);
  }

  /** Сбрасывает самолёт в стартовое положение после крушения (вызывается по клавише R). */
  reset(floatingOrigin: FloatingOrigin): void {
    this.throttle = AIRCRAFT.START_THROTTLE;
    this.orientation.identity();
    this.crashed = false;

    const [x, y, z] = AIRCRAFT.START_POSITION;
    floatingOrigin.setWorldPosition(this.group, new THREE.Vector3(x, y, z));
    this.group.quaternion.copy(this.orientation);
    // Скорость выставляем ПОСЛЕ сброса ориентации — this.forward должен смотреть
    // в стартовом направлении (see register() — та же причина: без начальной
    // скорости самолёт мгновенно свалится в штопор).
    this.velocity.copy(this.forward).multiplyScalar(AIRCRAFT.START_SPEED);
  }

  get speed(): number {
    return this.velocity.length();
  }

  get forward(): THREE.Vector3 {
    return new THREE.Vector3(0, 0, -1).applyQuaternion(this.orientation);
  }

  /** Тангаж, градусы (положительный — нос вверх). Для авиагоризонта. */
  get pitchDeg(): number {
    const forward = this.forward;
    return THREE.MathUtils.radToDeg(Math.asin(THREE.MathUtils.clamp(forward.y, -1, 1)));
  }

  /** Крен, градусы (положительный — правый борт вниз). Для авиагоризонта. */
  get rollDeg(): number {
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.orientation);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(this.orientation);
    return -THREE.MathUtils.radToDeg(Math.atan2(right.y, up.y));
  }

  /** Курс, градусы 0..360 (0 — направление, куда самолёт смотрел при старте). Для компаса. */
  get headingDeg(): number {
    const forward = this.forward;
    const deg = THREE.MathUtils.radToDeg(Math.atan2(forward.x, -forward.z));
    return ((deg % 360) + 360) % 360;
  }

  /** Вертикальная скорость, м/с (положительная — набор высоты). Для вариометра. */
  get verticalSpeed(): number {
    return this.velocity.y;
  }
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

/**
 * Простая процедурная низкополигональная геометрия самолёта (примитивы THREE —
 * без внешних GLTF-ассетов, которых пока нет в проекте). Ржаво-оливковая
 * раскраска в духе "уцелевший после апокалипсиса самолёт-разведчик".
 */
function buildAircraftMesh(): THREE.Group {
  const group = new THREE.Group();

  const hullMaterial = new THREE.MeshStandardMaterial({
    color: 0x5c6650,
    roughness: 0.6,
    metalness: 0.4,
  });
  const accentMaterial = new THREE.MeshStandardMaterial({
    color: 0x8a3324,
    roughness: 0.7,
    metalness: 0.2,
  });

  const fuselage = new THREE.Mesh(new THREE.CapsuleGeometry(0.55, 3.4, 4, 8), hullMaterial);
  fuselage.rotation.x = Math.PI / 2;
  fuselage.castShadow = true;
  group.add(fuselage);

  const wing = new THREE.Mesh(new THREE.BoxGeometry(6.2, 0.12, 1.1), hullMaterial);
  wing.position.set(0, -0.05, 0.1);
  wing.castShadow = true;
  group.add(wing);

  const tailWing = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.08, 0.6), hullMaterial);
  tailWing.position.set(0, 0.1, 1.85);
  tailWing.castShadow = true;
  group.add(tailWing);

  const tailFin = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.9, 0.7), accentMaterial);
  tailFin.position.set(0, 0.55, 1.85);
  tailFin.castShadow = true;
  group.add(tailFin);

  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.5, 0.6, 8), accentMaterial);
  nose.rotation.x = -Math.PI / 2;
  nose.position.set(0, 0, -2.0);
  nose.castShadow = true;
  group.add(nose);

  return group;
}
