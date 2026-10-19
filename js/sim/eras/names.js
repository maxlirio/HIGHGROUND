// Who the people of each war are called.
//
// A lord of 1944 was being named "Sir Gilbert of the Ford" and sent against "Lady Maud of Coldharbour", because
// every name in the game came out of one medieval pool. The pool belongs to the WAR, like its troops and its
// powers do (docs/eras-plan.md § A game each).
//
// `first` and `by` are joined with a space, so the shape differs by age and that is the point: the Vale and the
// Marches give a man a name and an epithet, 1944 gives him a given name and a surname.
//
// THE VALE'S TWO LISTS ARE FROZEN. A man's name is derived from his seed at the moment it is shown, not stored —
// so moving one word in either list would quietly rename every legend in the family's realm and in every save.
export const NAMES = {
  vale: {
    lord: "Sir", second: "Sir",
    first: ["Aldric", "Bertram", "Cuthbert", "Drogo", "Edric", "Fulk", "Godwin", "Hamo", "Ivo", "Jocelin", "Kenric", "Leofric", "Martin", "Nigel", "Osbert", "Piers", "Ralf", "Simon", "Thurstan", "Walter", "Wystan", "Hugh", "Roger", "Alan", "Geoffrey", "Odo", "Baldwin", "Gilbert"],
    by: ["of the Marsh", "Ironhand", "the Tall", "Oakheart", "of Harrow", "Longshanks", "the Quiet", "Redbeard", "the Stubborn", "Halfhand", "of the Ford", "Greycloak", "the Younger", "Wolfsbane", "Blackthorn", "the Lucky"],
    bots: ["Sir Aldous of Wyke", "Dame Ysolde", "Sir Hamo Fitzwalter", "Rannulf the Grey", "Sir Gervase Lacy", "Lady Maud of Coldharbour", "Sir Odo Brus", "Walkelin the Reeve's Son",
      "Sir Payn Peverel", "Dame Alys Bohun", "Sir Roger of Hebden", "Thurstan Hardfist", "Sir Baldwin de Redvers", "Dame Petronilla", "Sir Hugh Malet", "Ealdred of the Marsh"],
  },
  march: {
    lord: "Lord", second: "Captain",
    first: ["Brugg", "Ashvara", "Hrothgar", "Gurzag", "Nimue", "Dreng", "Mok", "Elenwe", "Thorgrim", "Vashka", "Kalder", "Yrsa", "Grimnir", "Sylaine", "Urzog", "Haldor", "Mirael", "Snagg", "Bellreth", "Durnak", "Faeleth", "Korrig", "Tavrin", "Ysolde", "Orwyn", "Halfdan", "Lirael", "Narvi"],
    by: ["Stonehand", "the Flayer", "Silversight", "Ironjaw", "of the Green", "Wolfsbane", "the Rune-cut", "Bloodtusk", "of the Deeps", "Starwatcher", "the Unbroken", "Hammerfall", "of the Pass", "Nightbough", "the Red", "Oathkeeper"],
    bots: ["Lord Durnak Stonehand", "Ashvara of the Green", "Gurzag Bloodtusk", "Thane Hrothgar", "Elenwe Starwatcher", "Mok the Flayer", "Lady Nimue Nightbough", "Snagg of the Deeps",
      "Yrsa Hammerfall", "Urzog Ironjaw", "Mirael Silversight", "Korrig of the Pass", "Grimnir the Unbroken", "Vashka the Red", "Faeleth Starwatcher", "Dreng Oathkeeper"],
  },
  ardennes: {
    lord: "Captain", second: "Lieutenant",
    first: ["Henry", "Walter", "Emil", "Clement", "Victor", "Lewis", "Albert", "Roy", "Francis", "Edgar", "Hugo", "Martin", "Owen", "Stanley", "Vernon", "Arthur", "Curtis", "Dennis", "Earl", "Floyd", "Gerald", "Howard", "Irving", "Jarrett", "Keith", "Leonard", "Milton", "Norman"],
    by: ["Hollis", "Vance", "Faber", "Roth", "Dunne", "Keller", "Marek", "Doyle", "Lindqvist", "Obrecht", "Barrow", "Kettner", "Mallory", "Novak", "Prentice", "Rhodes"],
    bots: ["Major Hollis", "Captain Vance", "Captain Obrecht", "Major Lindqvist", "Captain Doyle", "Lieutenant Marek", "Major Kettner", "Captain Faber",
      "Captain Rhodes", "Major Novak", "Captain Barrow", "Lieutenant Keller", "Major Mallory", "Captain Dunne", "Captain Roth", "Major Prentice"],
  },
};
// ──────────────────────────────────────────────────────────────── the ground's names
// The map is the Vale of Harrow in every war — one heightfield, one set of woods and fords — and giving each war
// its own GROUND is a long way off (docs/eras-plan.md, the campaigns). But the names on it are a label, and
// "The Battle of Wychwood Bottom" was the title over a battle fought in 1944 with tanks. (The owner, 2026-10-20:
// "it still sounds medieval".) So a war may bring its own names for the same places.
//
// These are INVENTED. The Ardennes of 1944 is full of villages where real men died within living memory, and
// none of them is named here: nothing in this game depicts a real place or a real engagement.
//
// A war with no list keeps the map's own names, which is right for the Vale and reads well enough for the
// Marches — Blackfell and Harrow Mere are as much a fantasy border as a medieval one.
export const PLACES = {
  ardennes: ["Hervelange", "Bastenbois", "Vauxmont", "Ourthenay", "Rochefoy", "Malmont", "Grandrue", "Beauvresse",
    "Hamiville", "Clairfosse", "Neufsart", "Marchelange", "Houffroy", "Sapinfoy", "Theuxmont", "Remonval",
    "Hautfays-Dessus", "Bois-Thierry", "Steinbruck", "Eschlange", "Wiltzbach", "Cleroy", "Fosse-les-Sapins",
    "Verlaine-sur-Our", "Tavignon", "Haut-le-Pre", "Bourcelles", "Nollemont", "Resteigny", "Aubrefoy"],
};
// A stable renamer for one map's places: the same village is the same village every battle, and no two places on
// the field share a name. Returns the identity when the war keeps the map's own names.
export function placeRenamer(era, names) {
  const pool = PLACES[era]; if (!pool) return (n) => n;
  const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
  const taken = new Map(), used = new Set();
  for (const n of [...new Set(names)].sort()) {
    let k = hash(n) % pool.length;
    for (let i = 0; i < pool.length && used.has(pool[k]); i++) k = (k + 1) % pool.length;
    if (used.has(pool[k])) break;            // more places than names: the rest keep their own
    used.add(pool[k]); taken.set(n, pool[k]);
  }
  return (n) => taken.get(n) || n;
}

export const namesOf = (era) => NAMES[era] || NAMES.vale;
