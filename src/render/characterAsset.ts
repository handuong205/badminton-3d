import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';

/**
 * Model nhân vật: RobotExpressive của Tomás Laulhé (Quaternius), giấy phép CC0 (dùng tự do).
 * File đặt ở public/models/ nên Vite phục vụ tại đường dẫn /models/...
 */
const MODEL_URL = '/models/RobotExpressive.glb';
export const CHARACTER_HEIGHT = 1.75; // m, scale model về chiều cao người thật

export interface CharacterAsset {
  scene: THREE.Group;
  clips: THREE.AnimationClip[];
  scale: number;
}

let pending: Promise<CharacterAsset> | null = null;

/** Tải model đúng 1 lần, các người chơi sau dùng lại (cache bằng Promise) */
export function loadCharacter(): Promise<CharacterAsset> {
  pending ??= new GLTFLoader().loadAsync(MODEL_URL).then((gltf) => {
    const box = new THREE.Box3().setFromObject(gltf.scene);
    const scale = CHARACTER_HEIGHT / (box.max.y - box.min.y);
    return { scene: gltf.scene, clips: gltf.animations, scale };
  });
  return pending;
}

/**
 * Tạo một bản sao độc lập cho mỗi người chơi.
 * Model có xương (skinned mesh) nên phải clone bằng SkeletonUtils, clone thường sẽ dùng chung xương.
 * Vật liệu cũng clone riêng để mỗi người một màu áo.
 */
export function instantiateCharacter(asset: CharacterAsset, color: number): THREE.Object3D {
  const obj = cloneSkinned(asset.scene);
  obj.scale.setScalar(asset.scale);
  obj.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = true;
    const mat = (mesh.material as THREE.MeshStandardMaterial).clone();
    if (mat.name === 'Main') mat.color.set(color);
    mesh.material = mat;
  });
  return obj;
}