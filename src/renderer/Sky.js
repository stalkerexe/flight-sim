import * as THREE from 'three';
/**
 * Процедурное небо на кастомном ShaderMaterial (огромная сфера вокруг камеры).
 *
 * Это упрощённая Rayleigh/Mie аппроксимация (не полный Hillaire integration) —
 * достаточно для реалистичного градиента неба, положения солнца и заката
 * уже на Этапе 1. Полная физическая модель атмосферного рассеяния
 * (multiple scattering, transmittance LUT) — следующий шаг в renderer/,
 * этот файл проектирует API (setSunDirection) так, чтобы замена шейдера
 * внутри не потребовала правок в вызывающем коде.
 */
export class Sky {
    mesh;
    material;
    sunDirection = new THREE.Vector3(0, 1, 0);
    constructor() {
        const geometry = new THREE.SphereGeometry(50_000, 32, 16);
        this.material = new THREE.ShaderMaterial({
            side: THREE.BackSide,
            depthWrite: false,
            uniforms: {
                sunDirection: { value: this.sunDirection },
                horizonColor: { value: new THREE.Color(0xbfd4e0) },
                zenithColor: { value: new THREE.Color(0x1d4d8f) },
                sunColor: { value: new THREE.Color(0xfff3d6) },
            },
            vertexShader: /* glsl */ `
        varying vec3 vWorldDir;
        void main() {
          vWorldDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
            fragmentShader: /* glsl */ `
        uniform vec3 sunDirection;
        uniform vec3 horizonColor;
        uniform vec3 zenithColor;
        uniform vec3 sunColor;
        varying vec3 vWorldDir;

        void main() {
          vec3 dir = normalize(vWorldDir);
          float heightFactor = clamp(dir.y * 0.5 + 0.5, 0.0, 1.0);
          vec3 sky = mix(horizonColor, zenithColor, pow(heightFactor, 0.45));

          float sunAmount = clamp(dot(dir, normalize(sunDirection)), 0.0, 1.0);
          vec3 sunGlow = sunColor * pow(sunAmount, 256.0) * 4.0;
          vec3 sunHalo = sunColor * pow(sunAmount, 8.0) * 0.25;

          // Затемнение неба ниже горизонта при низком солнце (грубая имитация заката).
          float duskFactor = clamp(1.0 - max(sunDirection.y, 0.0) * 2.0, 0.0, 1.0);
          vec3 duskTint = mix(vec3(0.0), vec3(0.9, 0.45, 0.2), duskFactor * (1.0 - heightFactor));

          gl_FragColor = vec4(sky + sunGlow + sunHalo + duskTint, 1.0);
        }
      `,
        });
        this.mesh = new THREE.Mesh(geometry, this.material);
        this.mesh.matrixAutoUpdate = false;
        this.mesh.updateMatrix();
    }
    /** Направление на солнце (нормализованный вектор, world space). Используется и для освещения сцены. */
    setSunDirection(dir) {
        this.sunDirection.copy(dir).normalize();
    }
    getSunDirection() {
        return this.sunDirection;
    }
}
