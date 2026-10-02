import * as THREE from 'three';

const cache = new Map<string, THREE.MeshStandardMaterial>();

/** Shared PBR materials keyed by colour and finish so meshes batch well. */
export function mat(color: THREE.ColorRepresentation, roughness = 0.7, metalness = 0, extra?: Partial<THREE.MeshStandardMaterialParameters>): THREE.MeshStandardMaterial {
  const key = `${new THREE.Color(color).getHexString()}|${roughness}|${metalness}|${extra ? JSON.stringify(extra) : ''}`;
  let m = cache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra });
    cache.set(key, m);
  }
  return m;
}

export function shadowed<T extends THREE.Object3D>(o: T, cast = true, receive = true): T {
  o.traverse((c) => {
    if ((c as THREE.Mesh).isMesh) {
      c.castShadow = cast;
      c.receiveShadow = receive;
    }
  });
  return o;
}
