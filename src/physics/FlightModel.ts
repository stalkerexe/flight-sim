import * as THREE from 'three';
import { FLIGHT } from '@/config/Constants';

export interface AerodynamicResult {
  /** Суммарное ускорение (подъёмная сила + сопротивление + тяга + гравитация) в мировых координатах, м/с². */
  accelerationWorld: THREE.Vector3;
  /** Угол атаки, градусы. Положительный — нос выше вектора скорости (типичный набор высоты/предсрывной режим). */
  angleOfAttackDeg: number;
  /** true, если |angleOfAttackDeg| превышает критический угол — подъёмная сила уже упала с пикового значения. */
  stalled: boolean;
  /** Модуль скорости, м/с. */
  airspeed: number;
  /** 0..1 — эффективность рулевых поверхностей от скоростного напора (квадратично растёт со скоростью). */
  controlEffectiveness: number;
}

/**
 * Аэродинамические силы как функция угла атаки — см. развёрнутый комментарий
 * и честный список упрощений в config/Constants.ts у блока FLIGHT.
 *
 * Метод: скорость переводится в оси самолёта (body frame), угол атаки
 * считается как angle между продольной осью и вектором скорости В
 * ВЕРТИКАЛЬНОЙ ПЛОСКОСТИ САМОЛЁТА (без учёта скольжения/рысканья — это
 * упрощение, полная модель учитывала бы ещё угол скольжения β отдельно).
 * Коэффициент подъёмной силы CL(α) — линейный до критического угла, затем
 * срыв потока (падение к более низкому плато). Коэффициент сопротивления
 * CD(α) — паразитное + индуктивное (∝ CL²) + дополнительное при срыве.
 *
 * Направление подъёмной силы вычисляется векторно: составляющая "верха"
 * самолёта, перпендикулярная вектору скорости — это надёжный способ получить
 * физически осмысленное направление силы в 3D без полного разложения по
 * углу скольжения, распространённый приём в некоммерческих флайт-симах.
 */
export function computeAerodynamics(
  velocity: THREE.Vector3,
  orientation: THREE.Quaternion,
  throttle: number,
): AerodynamicResult {
  const airspeed = velocity.length();

  const forwardWorld = new THREE.Vector3(0, 0, -1).applyQuaternion(orientation);
  const upWorld = new THREE.Vector3(0, 1, 0).applyQuaternion(orientation);

  let angleOfAttackRad = 0;
  if (airspeed > 0.2) {
    const inverseOrientation = orientation.clone().invert();
    const velocityBody = velocity.clone().applyQuaternion(inverseOrientation);
    // Body-оси: forward = -Z, up = +Y. -velocityBody.z — скорость вдоль носа,
    // -velocityBody.y — "снижающаяся" составляющая скорости в body-осях.
    // atan2 даёт угол атаки со стандартным знаком (нос выше вектора скорости → положительный).
    angleOfAttackRad = Math.atan2(-velocityBody.y, Math.max(0.5, -velocityBody.z));
  }
  const angleOfAttackDeg = THREE.MathUtils.radToDeg(angleOfAttackRad);
  const stallAngleRad = THREE.MathUtils.degToRad(FLIGHT.STALL_ANGLE_DEG);
  const stalled = Math.abs(angleOfAttackRad) > stallAngleRad;

  const liftCoefficient = computeLiftCoefficient(angleOfAttackRad, stallAngleRad);
  const dragCoefficient = computeDragCoefficient(liftCoefficient, angleOfAttackRad, stallAngleRad);

  const dynamicPressure = 0.5 * FLIGHT.AIR_DENSITY * airspeed * airspeed;
  const liftForceMag = dynamicPressure * FLIGHT.WING_AREA * liftCoefficient;
  const dragForceMag = dynamicPressure * FLIGHT.WING_AREA * dragCoefficient;

  const flightDir = airspeed > 0.2 ? velocity.clone().normalize() : forwardWorld.clone();

  const liftDir = upWorld.clone().sub(flightDir.clone().multiplyScalar(upWorld.dot(flightDir)));
  if (liftDir.lengthSq() > 1e-6) {
    liftDir.normalize();
  } else {
    liftDir.copy(upWorld);
  }

  const dragDir = flightDir.clone().negate();

  const totalForce = new THREE.Vector3()
    .addScaledVector(liftDir, liftForceMag)
    .addScaledVector(dragDir, dragForceMag)
    .addScaledVector(forwardWorld, throttle * FLIGHT.THRUST_MAX);
  totalForce.y -= FLIGHT.MASS * FLIGHT.GRAVITY;

  const accelerationWorld = totalForce.divideScalar(FLIGHT.MASS);

  const controlEffectiveness = Math.min(
    (airspeed * airspeed) / (FLIGHT.CONTROL_EFFECTIVENESS_REF_SPEED * FLIGHT.CONTROL_EFFECTIVENESS_REF_SPEED),
    1,
  );

  return { accelerationWorld, angleOfAttackDeg, stalled, airspeed, controlEffectiveness };
}

/** CL(α): линейный рост до критического угла, затем срыв — падение к более низкому плато. */
function computeLiftCoefficient(aoaRad: number, stallAngleRad: number): number {
  if (Math.abs(aoaRad) <= stallAngleRad) {
    return FLIGHT.CL0 + FLIGHT.CL_ALPHA_PER_RAD * aoaRad;
  }
  const sign = Math.sign(aoaRad);
  const clAtStall = (FLIGHT.CL0 + FLIGHT.CL_ALPHA_PER_RAD * stallAngleRad) * sign;
  const overshootRad = Math.abs(aoaRad) - stallAngleRad;
  const falloff = Math.min(overshootRad / THREE.MathUtils.degToRad(25), 1);
  const floor = clAtStall * (1 - FLIGHT.POST_STALL_CL_FLOOR_RATIO);
  return clAtStall + (floor - clAtStall) * falloff;
}

/** CD(α): паразитное + индуктивное (∝ CL²) + дополнительное сопротивление при развитом срыве. */
function computeDragCoefficient(cl: number, aoaRad: number, stallAngleRad: number): number {
  let cd = FLIGHT.CD0 + FLIGHT.INDUCED_DRAG_K * cl * cl;
  if (Math.abs(aoaRad) > stallAngleRad) {
    const overshootDeg = THREE.MathUtils.radToDeg(Math.abs(aoaRad) - stallAngleRad);
    cd += FLIGHT.STALL_DRAG_EXTRA * Math.min(overshootDeg / 20, 1);
  }
  return cd;
}
