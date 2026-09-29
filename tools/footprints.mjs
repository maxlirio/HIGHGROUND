// Measures every building/prop GLB's ground footprint from its LOD0 geometry, so the sim's obstacles
// match the models exactly. Writes assets/footprints.json: { asset: [minX, maxX, minY, maxY] } in
// model space metres (Blender axes: +Y = back, front faces −Y). Re-run after new assets land.
import fs from "node:fs";
const dir = new URL("../assets/glb/", import.meta.url).pathname;
const out = {};
for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".glb"))) {
  const b = fs.readFileSync(dir + f); const jsonLen = b.readUInt32LE(12);
  const gl = JSON.parse(b.slice(20, 20 + jsonLen).toString());
  let mnx = Infinity, mxx = -Infinity, mnz = Infinity, mxz = -Infinity;
  for (const node of gl.nodes || []) {
    if (node.mesh === undefined || /_LOD[12]/.test(node.name || "")) continue;
    const t = node.translation || [0, 0, 0];
    for (const p of gl.meshes[node.mesh].primitives) {
      const acc = gl.accessors[p.attributes.POSITION];
      mnx = Math.min(mnx, acc.min[0] + t[0]); mxx = Math.max(mxx, acc.max[0] + t[0]);
      mnz = Math.min(mnz, acc.min[2] + t[2]); mxz = Math.max(mxz, acc.max[2] + t[2]);
    }
  }
  if (!isFinite(mnx)) continue;
  // glTF z = −Blender y
  out[f.replace(".glb", "")] = [+mnx.toFixed(2), +mxx.toFixed(2), +(-mxz).toFixed(2), +(-mnz).toFixed(2)];
}
fs.writeFileSync(new URL("../assets/footprints.json", import.meta.url), JSON.stringify(out, null, 1));
console.log(Object.keys(out).length, "footprints", JSON.stringify(out.town_hall), JSON.stringify(out.oak_a));
