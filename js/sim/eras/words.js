// The words each war is told in.
//
// The owner, 2026-10-20, on the aftermath of a battle in the Ardennes: *"it still sounds medieval"* — and it did.
// His riflemen "broke under the shafts", 30 of his men "fell to arrows", and the chronicle named a mortar crew's
// gunner as "a mortar… who felled 12 with his own hand". Every noun in the story was a longbow's.
//
// So the handful of words that belong to an AGE rather than to a battle live here, and the three places that
// write the story — js/sim/battle-record.js (the moments as they happen), js/sim/battle-story.js (why it was won,
// and the chronicle) and js/ui/aftermath.js (the table) — ask for them instead of saying "arrows".
//
// What is NOT here is anything true in every age: a line gives way, a flank is turned, men break and run, the
// winner keeps the field. Those sentences are the game, not the century.
export const WORDS = {
  vale: {
    shot: "arrows",                      // what the dead fell to
    shotBy: "The bows",                  // "THE BOWS of the men of Rookham won the day"
    volley: "the shafts",                // "broke under THE SHAFTS"
    firstKicker: "The arrows fly",
    firstText: "The first shafts fall among",
    brokeKicker: "Broken by the arrows",
    causeShot: "Arrows and bolts",
    causeBlades: "Sword, axe and spear",
    causeHorse: "Ridden down",
    rain: "in a driving rain that soaked the bowstrings and turned the field to mire",
    fog: "in a mist so thick a man could not see his own banner at a bowshot",
    word: "horn",                        // "the word ran down the line faster than any HORN"
    taken: "were taken for ransom",
    takenCol: "Taken for ransom",
    byHand: "with his own hand",
  },
  march: {
    shot: "arrows", shotBy: "The bows", volley: "the shafts",
    firstKicker: "The arrows fly", firstText: "The first shafts fall among", brokeKicker: "Broken by the arrows",
    causeShot: "Arrows and bolts", causeBlades: "Blade, axe and spear", causeHorse: "Ridden down",
    rain: "in a driving rain that soaked the bowstrings and turned the field to mire",
    fog: "in a mist so thick a man could not see his own banner at a bowshot",
    word: "horn", taken: "were taken", takenCol: "Taken", byHand: "with his own hand",
  },
  ardennes: {
    shot: "fire", shotBy: "The guns", volley: "the fire",
    firstKicker: "The first rounds", firstText: "The first rounds come down among", brokeKicker: "Pinned and broken",
    causeShot: "Shot and shell", causeBlades: "At close quarters", causeHorse: "Run down",
    rain: "in a cold rain that soaked everything a man carried and turned the ground to mud",
    fog: "in a fog so thick a man could not see the next position along",
    word: "runner", taken: "were taken prisoner", takenCol: "Taken prisoner", byHand: "himself",
  },
};
export const wordsOf = (era) => WORDS[era] || WORDS.vale;
