# ORBITAL BLOOM 02 reference assets

- `orbital-bloom-02.glb` — the real Node 01 model (trimesh export, metres, **Z-up**, 18 named meshes, positions only).
- `model_manifest.json` — units, key dimensions, which groups move and which stay still, prototype warnings.
- `INTEGRATION_NOTES.txt` — the notes supplied with the pack.

The app loads the GLB in `src/scene/OrbitalBloomNode.tsx`, converts it to the node frame (millimetres, Y-up:
CAD (x, y, z) → (x, z, −y)), computes creased normals, and maps the named meshes to interactive parts in
`src/data/orbitalBloom.ts`. Numbers in that file were measured from this mesh.
