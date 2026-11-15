import * as THREE from 'three';
import { node01Root } from '../scene/Node01Assembly';
import { play } from '../sim/play';

/**
 * Exports the assembled Node 01 presentation mesh as a binary glTF.
 *  • units converted from millimetres to metres (glTF convention)
 *  • one named node per part, pivots at the node origin, Y up
 *  • simple PBR materials (the custom shader effects are not exported)
 * This is a VISUALISATION mesh, not a fabrication-ready CAD file.
 */
export async function exportNodeGLB(): Promise<void> {
  const root = node01Root.current;
  if (!root) throw new Error('Node 01 is not mounted');
  play.reset();
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const { GLTFExporter } = await import('three/examples/jsm/exporters/GLTFExporter.js');

  const scene = new THREE.Scene();
  scene.name = 'LiquidFrequency_Node01';
  const out = new THREE.Group();
  out.name = 'Node01_TestPad';
  out.scale.setScalar(0.001);
  out.userData = { units: 'metres (authored in mm, scaled 0.001)', disclaimer: 'Presentation mesh derived from reference dimensions. Not validated for manufacture.' };
  scene.add(out);

  const matCache = new Map<THREE.Material, THREE.MeshStandardMaterial>();
  const simple = (src: THREE.Material): THREE.MeshStandardMaterial => {
    let m = matCache.get(src);
    if (!m) {
      const p = src as THREE.MeshPhysicalMaterial;
      m = new THREE.MeshStandardMaterial({ name: (p.name || 'Material') as string, color: p.color?.clone() ?? new THREE.Color('#cccccc'), metalness: p.metalness ?? 0, roughness: p.roughness ?? 0.5, map: p.map ?? null });
      matCache.set(src, m);
    }
    return m;
  };

  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4();
  for (const partGroup of root.children) {
    if (!partGroup.userData.part || !partGroup.visible) continue;
    const g = new THREE.Group();
    g.name = partGroup.name;
    g.userData = { part: partGroup.userData.part };
    out.add(g);
    // matrices relative to the part group, so exploded offsets never leak into the file
    inv.copy(partGroup.matrixWorld).invert();
    partGroup.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || mesh.userData.fx) return;
      const clone = new THREE.Mesh(mesh.geometry, Array.isArray(mesh.material) ? mesh.material.map(simple) : simple(mesh.material));
      clone.name = mesh.name || partGroup.name;
      clone.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, mesh.matrixWorld));
      g.add(clone);
    });
  }

  const exporter = new GLTFExporter();
  const buffer = (await exporter.parseAsync(scene, { binary: true })) as ArrayBuffer;
  const url = URL.createObjectURL(new Blob([buffer], { type: 'model/gltf-binary' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = 'liquid-frequency-node01.glb';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
