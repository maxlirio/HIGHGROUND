// The economy's calibration tables — now the VALE's, at js/sim/eras/vale/econ-data.js.
//
// docs/eras-plan.md § A game each: every war gets its own campaign, so there will be a second and a third of
// these tables. Almost nothing in economy.js is structurally medieval — every job in it is one of three verbs
// (gather at a node, carry to a store, convert at a workshop), and sheaves to a granary are the same code as
// jerricans to a fuel dump. What IS medieval is the TABLE: what the resources are, what the buildings are, and
// what each one makes out of what. So the table is what moves behind a war's own directory, and the verbs stay.
//
// Forty-odd modules import this path. They keep importing it: this file re-exports the Vale's table so the move
// cost nothing and the playtest hash is untouched. When a second campaign exists, it is this file — and not those
// forty — that learns to answer for `w.era`.
export * from "./eras/vale/econ-data.js";
