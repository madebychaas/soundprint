# Reference assets

Drop the ORBITAL BLOOM 02 export here as `orbital-bloom-02.glb`.

When the file is present the app detects it, and Specs → "Overlay ORBITAL BLOOM 02 reference" draws it as a
translucent ghost on top of the parametric Node 01 so the two can be compared. Assumptions made on load:
Y is up (or Z-up with a largest-extent heuristic is NOT applied), the model is in metres if its largest
extent is under 2 units and in millimetres otherwise, and its bounding box is centred on the node axis
with its lowest point at Y = 0. Adjust `src/scene/ReferenceModel.tsx` if the export differs.
