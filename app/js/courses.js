// Course definitions. Adding a language later = new fields in concepts.json + a new course here.

// Short-vowel word families (CVC words), one unit per vowel. Ids refer to concepts.json.
const PHONICS = {
  a: ['cat', 'hat', 'bat', 'rat', 'cap', 'map', 'fan', 'van', 'pan'],
  e: ['bed', 'red', 'n10', 'pen', 'net', 'jet', 'wet', 'web'],
  i: ['pig', 'dig', 'pin', 'bin', 'n6', 'sit'],
  o: ['dog', 'log', 'fox', 'box', 'pot', 'hot'],
  u: ['sun', 'run', 'bug', 'hug', 'bus', 'cup', 'nut'],
};

// Two letters, one sound.
const DIGRAPHS = { sh: ['ship', 'shop', 'fish', 'dish'], ch: ['chip', 'chick', 'chop'], th: ['bath', 'thumb', 'think'] };

const LETTER_WORDS = {
  A: 'apple', B: 'bag', C: 'cat', D: 'dog', E: 'egg', F: 'fish', G: 'gift', H: 'hat', I: 'ice',
  J: 'juice', K: 'key', L: 'love', M: 'milk', N: 'nose', O: 'orange', P: 'pig', Q: 'queen',
  R: 'rain', S: 'sun', T: 'tea', U: 'umbrella', V: 'violin', W: 'water', X: 'box', Y: 'yellow', Z: 'zebra',
};

export function buildCourses(concepts, script, grammar = []) {
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
  const used = new Set([...Object.values(LETTER_WORDS), ...Object.values(PHONICS).flat(), ...Object.values(DIGRAPHS).flat()]);
  const sight = (from, to) =>
    byCat('sight').slice(from, to).map((id) => {
      const wid = word(id);
      items[wid].sight = true;
      return wid;
    });
  const digraphs = () =>
    Object.entries(DIGRAPHS).flatMap(([dg, ids]) =>
      ids.map((id) => {
        const wid = word(id);
        items[wid].digraph = dg;
        return wid;
      }));
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
      { section: 'Alphabet', icon: 'Aa', title: 'A B C D E F', items: letters('ABCDEF') },
      { section: 'Alphabet', icon: '🍎', title: 'apple · cat · dog', items: exWords('ABCDEF') },
      { section: 'Alphabet', icon: 'Aa', title: 'G H I J K L M', items: letters('GHIJKLM') },
      { section: 'Alphabet', icon: '🎩', title: 'hat · key · milk', items: exWords('GHIJKLM') },
      { section: 'Alphabet', icon: 'Aa', title: 'N O P Q R S T', items: letters('NOPQRST') },
      { section: 'Alphabet', icon: '☀️', title: 'pig · sun · tea', items: exWords('NOPQRST') },
      { section: 'Alphabet', icon: 'Aa', title: 'U V W X Y Z', items: letters('UVWXYZ') },
      { section: 'Alphabet', icon: '🦓', title: 'water · box · zebra', items: exWords('UVWXYZ') },
      { section: 'Phonics', icon: 'a', title: 'a — cat · hat · map', items: phonics('a'), phonics: true },
      { section: 'Phonics', icon: 'e', title: 'e — bed · pen · jet', items: phonics('e'), phonics: true },
      { section: 'Phonics', icon: 'i', title: 'i — pig · pin · six', items: phonics('i'), phonics: true },
      { section: 'Phonics', icon: 'o', title: 'o — dog · fox · box', items: phonics('o'), phonics: true },
      { section: 'Phonics', icon: 'u', title: 'u — sun · bug · cup', items: phonics('u'), phonics: true },
      { section: 'Phonics', icon: 'sh', title: 'sh · ch · th — ship · chip · bath', items: digraphs() },
      { section: 'Sight words', icon: 'the', title: 'the · a · is · my · it · and · I', items: [word('i'), ...sight(0, 6)] },
      { section: 'Sight words', icon: 'see', title: 'see · like · have · can · we · he', items: sight(6, 12) },
      { section: 'Sight words', icon: 'she', title: 'she · this · in · on · look · here', items: sight(12, 18) },
      { section: 'Sight words', icon: 'am', title: 'am · are · at · to', items: sight(18, 22) },
      { section: 'Words', icon: '👋', title: 'Hello · Thank you', items: rest('core') },
      { section: 'Words', icon: '👨‍👩‍👧', title: 'Family', items: rest('family') },
      { section: 'Words', icon: '🍚', title: 'Food', items: rest('food') },
      { section: 'Words', icon: '🐘', title: 'Animals', items: rest('animals') },
      { section: 'Words', icon: '✋', title: 'Body', items: rest('body') },
      { section: 'Words', icon: '🎨', title: 'Colors', items: rest('colors') },
      { section: 'Words', icon: '🔢', title: '1 2 3', items: rest('numbers') },
      { section: 'Words', icon: '🏠', title: 'Home', items: rest('home') },
      { section: 'Words', icon: '🌳', title: 'Nature', items: rest('nature') },
      { section: 'Words', icon: '😊', title: 'Feelings', items: rest('feel') },
      // Grammar & tenses: each lesson = a spoken Khmer explanation + practice sentences.
      ...grammar.map((g) => ({
        section: 'Grammar',
        icon: { past: '⏪', now: '▶️', future: '⏩' }[g.time] || '🧩',
        title: g.title,
        lesson: g,
        items: g.items.map((it, i) => {
          const id = `g:${g.id}:${i}`;
          items[id] ||= { id, kind: 'gram', lesson: g, ...it };
          return id;
        }),
      })),
      { section: 'Sentences', icon: '💬', title: 'Sentences 1', items: words(byCat('phrases').slice(0, 6)) },
      { section: 'Sentences', icon: '💬', title: 'Sentences 2', items: words(byCat('phrases').slice(6)) },
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
      { section: 'Vocabulary', icon: '👋', title: 'Greetings', items: cat('core') },
      { section: 'Script', icon: 'ក', title: 'Consonants · series A (1)', items: cons(1, 0, 8) },
      { section: 'Vocabulary', icon: '👨‍👩‍👧', title: 'Family', items: cat('family') },
      { section: 'Script', icon: 'ប', title: 'Consonants · series A (2)', items: cons(1, 8, 15) },
      { section: 'Vocabulary', icon: '🍚', title: 'Food & drink', items: cat('food') },
      { section: 'Script', icon: 'គ', title: 'Consonants · series O (1)', items: cons(2, 0, 9) },
      { section: 'Phrases', icon: '💬', title: 'Phrases', items: cat('phrases') },
      { section: 'Script', icon: 'ម', title: 'Consonants · series O (2)', items: cons(2, 9, 18) },
      { section: 'Vocabulary', icon: '🔢', title: 'Numbers', items: cat('numbers') },
      { section: 'Script', icon: 'ា', title: 'Vowels (1)', items: vows(0, 12) },
      { section: 'Vocabulary', icon: '😊', title: 'Feelings & verbs', items: cat('feel') },
      { section: 'Script', icon: 'ោ', title: 'Vowels (2)', items: vows(12, 24) },
      { section: 'Vocabulary', icon: '🐘', title: 'Animals', items: cat('animals') },
      { section: 'Vocabulary', icon: '✋', title: 'Body', items: cat('body') },
      { section: 'Vocabulary', icon: '🎨', title: 'Colors', items: cat('colors') },
      { section: 'Vocabulary', icon: '🏠', title: 'Home & things', items: cat('home') },
      { section: 'Vocabulary', icon: '🌳', title: 'Nature', items: cat('nature') },
    ],
  };

  return { courses: { en, km }, items };
}
