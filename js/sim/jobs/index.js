// The gathering lanes' sim modules, loaded once by economy.js (docs/gathering-plan.md). Each lane owns ONE line here.
// (Import cycles: a lane module may import from economy.js, but must only CALL those imports at run time, never at load.)
import "./fields.js";    // lane A
import "./forestry.js";  // lane B
import "./hunting.js";   // lane C
import "./haulage.js";   // lane D
import "./quarry.js";    // lane E
import "./workshops.js"; // the workshops: crews at their stations (docs/gathering-plan.md, "Workshops")
