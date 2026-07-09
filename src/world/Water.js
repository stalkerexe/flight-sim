import * as THREE from 'three';
import { WATER, WORLD } from '@/config/Constants';
/**
 * Плоскость воды на уровне моря (WORLD.SEA_LEVEL).
 *
 * До этого класса "вода" была только цветом дна чанка ниже уровня моря —
 * без отдельной геометрии её невозможно было отличить от обычного тёмного
 * участка суши, особенно при полёте на большой высоте. Теперь это реальный
 * полупрозрачный меш, всегда присутствующий в кадре.
 *
 * Следует за камерой по X/Z каждый кадр (большой квад 120×120 км с запасом
 * перекрывает видимую область при любой скорости полёта), а по Y выставлен
 * на истинный мировой уровень моря через FloatingOrigin: local Y = SEA_LEVEL - origin.y.
 *
 * Ограничение текущей версии (см. README): плоская, без Gerstner-волн,
 * без отражений/преломлений неба — следующий шаг апгрейда воды.
 */
export class Water {
    mesh;
    constructor() {
        const geometry = new THREE.PlaneGeometry(WATER.SIZE, WATER.SIZE, 1, 1);
        geometry.rotateX(-Math.PI / 2);
        const material = new THREE.MeshStandardMaterial({
            color: WATER.COLOR,
            transparent: true,
            opacity: WATER.OPACITY,
            roughness: 0.15,
            metalness: 0.05,
            depthWrite: true,
        });
        this.mesh = new THREE.Mesh(geometry, material);
        this.mesh.receiveShadow = false; // избыточно для плоской воды на этом этапе — экономим shadow pass
        this.mesh.matrixAutoUpdate = false;
    }
    /**
     * @param cameraLocalX/Z Локальные (относительно текущего floating origin) координаты камеры.
     * @param originY Текущее мировое смещение origin по Y (FloatingOrigin.getOrigin().y).
     */
    update(cameraLocalX, cameraLocalZ, originY) {
        this.mesh.position.set(cameraLocalX, WORLD.SEA_LEVEL - originY, cameraLocalZ);
        this.mesh.updateMatrix();
    }
}
