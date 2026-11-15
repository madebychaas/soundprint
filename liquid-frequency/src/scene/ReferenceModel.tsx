import { useEffect, useState } from 'react';
import * as THREE from 'three';
import { useApp } from '../state/store';

export const REFERENCE_URL = './models/orbital-bloom-02.glb';

/**
 * Optional ghost overlay of the real ORBITAL BLOOM 02 export on top of the
 * parametric Node 01. The asset was not supplied for this sprint; this is the
 * slot it drops into (see public/models/README.md for the load assumptions).
 */
export function ReferenceModel() {
  const show = useApp((s) => s.showReference);
  const available = useApp((s) => s.refAvailable);
  const [object, setObject] = useState<THREE.Object3D | null>(null);

  useEffect(() => {
    let alive = true;
    fetch(REFERENCE_URL, { method: 'HEAD' })
      .then((r) => { const type = r.headers.get('content-type') ?? ''; if (alive) useApp.getState().set({ refAvailable: r.ok && !type.includes('text/html') }); })
      .catch(() => alive && useApp.getState().set({ refAvailable: false }));
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!show || !available || object) return;
    let alive = true;
    import('three/examples/jsm/loaders/GLTFLoader.js').then(({ GLTFLoader }) => {
      new GLTFLoader().load(REFERENCE_URL, (gltf) => {
        if (!alive) return;
        const root = gltf.scene;
        const box = new THREE.Box3().setFromObject(root);
        const size = box.getSize(new THREE.Vector3());
        const scale = Math.max(size.x, size.y, size.z) < 2 ? 1000 : 1; // metres → mm
        const centre = box.getCenter(new THREE.Vector3());
        root.position.set(-centre.x * scale, -box.min.y * scale, -centre.z * scale);
        root.scale.setScalar(scale);
        const ghost = new THREE.MeshBasicMaterial({ color: '#8ff0ff', wireframe: true, transparent: true, opacity: 0.22, depthWrite: false });
        root.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) { m.material = ghost; m.userData.fx = true; m.raycast = () => undefined; } });
        const holder = new THREE.Group();
        holder.name = 'OrbitalBloom02_ReferenceOverlay';
        holder.add(root);
        setObject(holder);
      }, undefined, () => alive && useApp.getState().set({ refAvailable: false, showReference: false }));
    });
    return () => { alive = false; };
  }, [show, available, object]);

  if (!show || !object) return null;
  return <primitive object={object} />;
}
