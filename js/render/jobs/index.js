// The gathering lanes' renderers, made and ticked by main.js through one call (docs/gathering-plan.md).
// Each lane owns ONE import and ONE entry in LANES.
import * as fields from "./fields.js";     // lane A
import * as forestry from "./forestry.js"; // lane B
import * as hunting from "./hunting.js";   // lane C
import * as haulage from "./haulage.js";   // lane D
import * as quarry from "./quarry.js";     // lane E
import * as workshops from "./workshops.js"; // the workshops at work (docs/gathering-plan.md, "Workshops")
import * as ambient from "./ambient.js";     // every building alive, idle or busy (after workshops: it fills figures.extras after them)
import * as wildfire from "./wildfire.js";   // fire in the woods: burnt ground, snags and stumps (js/sim/wildfire.js; the flames: render/fire.js)
const LANES = [fields, forestry, hunting, haulage, quarry, workshops, ambient, wildfire];
export function makeLaneRenders(scene, map, ctx) {
  const rs = LANES.map((L) => L.makeRender(scene, map, ctx));
  return { update(w, cam, opts) { for (const r of rs) r.update(w, cam, opts); } };
}
