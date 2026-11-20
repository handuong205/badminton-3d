import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';

/**
 * Model nhân vật: player.glb, dựng bằng script Blender riêng cho game này (tools/character/build_player.py).
 * Trong file có: mesh 'Body' gắn xương kiểu Mixamo (mixamorigHips, mixamorigRightHand, ...),
 * vợt 'Racket' gắn sẵn vào xương bàn tay phải, và 18 hoạt ảnh:
 * - di chuyển (lặp): Idle, Tired, Walk, Run, WalkBack, RunBack, ShuffleLeft, ShuffleRight
 * - động tác một lần: SwingOver, SwingSide, SwingUnder, SwingBackhand, JumpSmash, Lunge, Land, Dive, Celebrate, Disappointed
 * File đặt ở public/models/ nên Vite phục vụ tại đường dẫn /models/...
 */
const MODEL_URL = '/models/player.glb';
export const CHARACTER_HEIGHT = 1.78; // m, chiều cao người thật

export interface CharacterAsset {
  scene: THREE.Group;
  clips: THREE.AnimationClip[];
  /** Mỗi clip tách làm 2 nửa: thân dưới (hông + chân) và thân trên (lưng, tay, đầu), để trộn riêng */
  halves: Map<string, { lower: THREE.AnimationClip; upper: THREE.AnimationClip }>;
  scale: number;
}

/** Các xương thuộc thân dưới. Hông (Hips) nằm ở thân dưới vì nó quyết định độ cao và hướng của cả người */
const LOWER_BONES = new Set(['Hips', 'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'LeftToeBase', 'RightUpLeg', 'RightLeg', 'RightFoot', 'RightToeBase']
  .map((b) => 'mixamorig' + b));

/**
 * Tách clip theo track: tên track glTF có dạng "<tên xương>.<thuộc tính>", ví dụ "mixamorigHips.quaternion".
 * Nhờ vậy vừa chạy (chân theo clip Run) vừa vung vợt (tay theo clip SwingOver) được.
 */
function splitHalves(clip: THREE.AnimationClip) {
  const isLower = (t: THREE.KeyframeTrack) => LOWER_BONES.has(t.name.split('.')[0]);
  return {
    lower: new THREE.AnimationClip(clip.name + '@lower', clip.duration, clip.tracks.filter(isLower)),
    upper: new THREE.AnimationClip(clip.name + '@upper', clip.duration, clip.tracks.filter((t) => !isLower(t))),
  };
}

let pending: Promise<CharacterAsset> | null = null;

/** Tải model đúng 1 lần, các người chơi sau dùng lại (cache bằng Promise) */
export function loadCharacter(): Promise<CharacterAsset> {
  pending ??= new GLTFLoader().loadAsync(MODEL_URL).then((gltf) => {
    // Đo chiều cao trên riêng mesh thân người (không tính vợt, vợt có thể chĩa cao hơn đầu)
    const body = gltf.scene.getObjectByName('Body') ?? gltf.scene;
    const box = new THREE.Box3().setFromObject(body);
    const scale = CHARACTER_HEIGHT / (box.max.y - box.min.y);
    const halves = new Map(gltf.animations.map((c) => [c.name, splitHalves(c)] as const));
    return { scene: gltf.scene, clips: gltf.animations, halves, scale };
  });
  return pending;
}

/**
 * Tạo một bản sao độc lập cho mỗi người chơi.
 * Model có xương (skinned mesh) nên phải clone bằng SkeletonUtils, clone thường sẽ dùng chung xương.
 * Vật liệu cũng clone riêng để mỗi người một màu áo, và mặt vợt sáng riêng khi nạp lực.
 */
export function instantiateCharacter(asset: CharacterAsset, color: number): THREE.Object3D {
  const obj = cloneSkinned(asset.scene);
  obj.scale.setScalar(asset.scale);
  obj.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = true;
    mesh.frustumCulled = false; // hộp bao của skinned mesh tính theo tư thế gốc, lúc vung/nhảy dễ bị cắt nhầm
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const cloned = mats.map((m) => {
      const mat = (m as THREE.MeshStandardMaterial).clone();
      if (mat.name === 'Main') mat.color.set(color);
      if (mat.name === 'RacketStrings') {
        mat.emissive.set(0xffaa00);
        mat.emissiveIntensity = 0;
        mat.side = THREE.DoubleSide;
        mat.depthWrite = false; // lưới vợt trong suốt, không che vật phía sau
      }
      return mat;
    });
    mesh.material = Array.isArray(mesh.material) ? cloned : cloned[0];
  });
  return obj;
}

/** Tìm vật liệu theo tên trong một model đã clone (ví dụ 'RacketStrings' để làm sáng mặt vợt) */
export function findMaterial(root: THREE.Object3D, name: string): THREE.MeshStandardMaterial | null {
  let found: THREE.MeshStandardMaterial | null = null;
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (found || !mesh.isMesh) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    found = (mats.find((m) => m.name === name) as THREE.MeshStandardMaterial | undefined) ?? null;
  });
  return found;
}