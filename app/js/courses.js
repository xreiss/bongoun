// Course definitions. Adding a language later = new fields in concepts.json + a new course here.

// Short-vowel word families (CVC words), one unit per vowel. Ids refer to concepts.json.
const PHONICS = {
  a: ['cat', 'hat', 'bat', 'rat', 'cap', 'map', 'fan', 'van', 'pan'],
  e: ['bed', 'red', 'n10', 'pen', 'net', 'jet', 'wet', 'web'],
  i: ['pig', 'dig', 'pin', 'bin', 'n6', 'sit'],
  o: ['dog', 'log', 'fox', 'box', 'pot', 'hot'],
  u: ['sun', 'run', 'bug', 'hug', 'bus', 'cup', 'nut'],
};

const LETTER_WORDS = {
  A: 'apple', B: 'bag', C: 'cat', D: 'dog', E: 'egg', F: 'fish', G: 'gift', H: 'hat', I: 'ice',
  J: 'juice', K: 'key', L: 'love', M: 'milk', N: 'nose', O: 'orange', P: 'pig', Q: 'queen',
  R: 'rain', S: 'sun', T: 'tea', U: 'umbrella', V: 'violin', W: 'water', X: 'box', Y: 'yellow', Z: 'zebra',
};

export function buildCourses(concepts, script) {
  const byId = Object.fromEntries(concepts.map((c) => [c.id, c]));
  const byCat = (cat) => concepts.filter((c) => c.cat === cat).map((c) => c.id);
  const items = {};
  const word = (id) => {
    items[`w:${id}`] ||= { id: `w:${id}`, kind: 'word', c: byId[id] };
    return `w:${id}`;
  };

  // ---------- English for a Khmer speaker (UI in Khmer, audio-first) ----------
  const letter = (L) => {
    const id = `L:${L}`;
    items[id] ||= { id, kind: 'letter', L, ex: byId[LETTER_WORDS[L]] };
    return id;
  };
  const letters = (s) => [...s].map(letter);
  const words = (ids) => ids.map(word);
  const exWords = (s) => [...s].map((L) => word(LETTER_WORDS[L]));
  const used = new Set([...Object.values(LETTER_WORDS), ...Object.values(PHONICS).flat()]);
  const phonics = (v) =>
    PHONICS[v].map((id) => {
      const wid = word(id);
      items[wid].phonics = v;
      return wid;
    });
  const rest = (cat) => byCat(cat).filter((id) => !used.has(id)).map(word);

  const en = {
    id: 'en',
    target: 'en',
    ui: 'km',
    title: 'English',
    units: [
      { icon: 'Aa', title: 'A B C D E F', items: letters('ABCDEF') },
      { icon: '🍎', title: 'apple · cat · dog', items: exWords('ABCDEF') },
      { icon: 'Aa', title: 'G H I J K L M', items: letters('GHIJKLM') },
      { icon: '🎩', title: 'hat · key · milk', items: exWords('GHIJKLM') },
      { icon: 'Aa', title: 'N O P Q R S T', items: letters('NOPQRST') },
      { icon: '☀️', title: 'pig · sun · tea', items: exWords('NOPQRST') },
      { icon: 'Aa', title: 'U V W X Y Z', items: letters('UVWXYZ') },
      { icon: '🦓', title: 'water · box · zebra', items: exWords('UVWXYZ') },
      { icon: 'a', title: 'a — cat · hat · map', items: phonics('a'), phonics: true },
      { icon: 'e', title: 'e — bed · pen · jet', items: phonics('e'), phonics: true },
      { icon: 'i', title: 'i — pig · pin · six', items: phonics('i'), phonics: true },
      { icon: 'o', title: 'o — dog · fox · box', items: phonics('o'), phonics: true },
      { icon: 'u', title: 'u — sun · bug · cup', items: phonics('u'), phonics: true },
      { icon: '👋', title: 'Hello · Thank you', items: rest('core') },
      { icon: '👨‍👩‍👧', title: 'Family', items: rest('family') },
      { icon: '🍚', title: 'Food', items: rest('food') },
      { icon: '🐘', title: 'Animals', items: rest('animals') },
      { icon: '✋', title: 'Body', items: rest('body') },
      { icon: '🎨', title: 'Colors', items: rest('colors') },
      { icon: '🔢', title: '1 2 3', items: rest('numbers') },
      { icon: '🏠', title: 'Home', items: rest('home') },
      { icon: '🌳', title: 'Nature', items: rest('nature') },
      { icon: '😊', title: 'Feelings', items: rest('feel') },
      { icon: '💬', title: 'Sentences 1', items: words(byCat('phrases').slice(0, 6)) },
      { icon: '💬', title: 'Sentences 2', items: words(byCat('phrases').slice(6)) },
    ],
  };

  // Rhyming partners inside the phonics families (cat ↔ hat), used by the rhyme exercise.
  const phon = Object.values(items).filter((it) => it.phonics);
  const rime = (it) => it.c.en.toLowerCase().slice(-2);
  for (const it of phon) it.rhymes = phon.filter((o) => o !== it && rime(o) === rime(it)).map((o) => o.id);

  // ---------- Khmer for an English speaker (script + vocabulary in parallel) ----------
  const cons = (series, from, to) =>
    script.consonants.filter((c) => c.s === series).slice(from, to).map((c) => {
      const id = `C:${c.ch}`;
      items[id] ||= { id, kind: 'consonant', ...c };
      return id;
    });
  const vows = (from, to) =>
    script.vowels.slice(from, to).map((v) => {
      const id = `V:${v.v}`;
      items[id] ||= { id, kind: 'vowel', ...v };
      return id;
    });
  const cat = (c) => byCat(c).map(word);

  const km = {
    id: 'km',
    target: 'km',
    ui: 'en',
    title: 'Khmer',
    units: [
      { icon: '👋', title: 'Greetings', items: cat('core') },
      { icon: 'ក', title: 'Consonants · series A (1)', items: cons(1, 0, 8) },
      { icon: '👨‍👩‍👧', title: 'Family', items: cat('family') },
      { icon: 'ប', title: 'Consonants · series A (2)', items: cons(1, 8, 15) },
      { icon: '🍚', title: 'Food & drink', items: cat('food') },
      { icon: 'គ', title: 'Consonants · series O (1)', items: cons(2, 0, 9) },
      { icon: '💬', title: 'Phrases', items: cat('phrases') },
      { icon: 'ម', title: 'Consonants · series O (2)', items: cons(2, 9, 18) },
      { icon: '🔢', title: 'Numbers', items: cat('numbers') },
      { icon: 'ា', title: 'Vowels (1)', items: vows(0, 12) },
      { icon: '😊', title: 'Feelings & verbs', items: cat('feel') },
      { icon: 'ោ', title: 'Vowels (2)', items: vows(12, 24) },
      { icon: '🐘', title: 'Animals', items: cat('animals') },
      { icon: '✋', title: 'Body', items: cat('body') },
      { icon: '🎨', title: 'Colors', items: cat('colors') },
      { icon: '🏠', title: 'Home & things', items: cat('home') },
      { icon: '🌳', title: 'Nature', items: cat('nature') },
    ],
  };

  return { courses: { en, km }, items };
}
