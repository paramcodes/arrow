/**
 * The fuzzy match of the command palette and the quick-open.
 *
 * A reader types the letters they remember, in the order they remember them,
 * and the palette has to find the label without the letters sitting next to
 * each other. A plain substring search fails that, which is why the palette
 * ranks candidates instead of filtering them.
 *
 * The score rewards a letter that starts a word and a letter that follows the
 * letter before it, and it penalizes the distance between two letters. A
 * candidate that holds every letter in order always matches; the score only
 * decides where it sits in the list.
 */

/** The result of one match. */
export interface FuzzyMatch {
  /** The score of the match. A higher score is a better match. */
  readonly score: number;
  /** The index of every letter of the query inside the text. */
  readonly positions: readonly number[];
}

/** One candidate and its score. */
export interface Ranked<T> {
  /** The candidate. */
  readonly item: T;
  /** The score of the candidate. */
  readonly score: number;
}

/** The characters that end a word. */
const WORD_SEPARATORS = /[^a-z0-9]/;

/** True when the letter at `index` starts a word. */
function startsWord(text: string, index: number): boolean {
  if (index === 0) return true;

  const previous = text[index - 1] ?? "";
  const current = text[index] ?? "";

  if (WORD_SEPARATORS.test(previous)) return true;

  // A lower case letter followed by an upper case one is a camel case word.
  return previous >= "a" && previous <= "z" && current >= "A" && current <= "Z";
}

/** The score of one candidate, or null when the query does not match it. */
export function fuzzyScore(text: string, query: string): FuzzyMatch | null {
  const needle = query.trim().toLowerCase();
  if (needle === "") return { score: 0, positions: [] };

  // `toLowerCase` can change the length of a string, so a case difference
  // between two letters is read on the same spelling the palette shows.
  const haystack = text.toLowerCase();
  const positions: number[] = [];
  let score = 0;
  let cursor = 0;
  let last = -2;

  for (const character of needle) {
    if (character === " ") continue;

    const found = haystack.indexOf(character, cursor);
    if (found === -1) return null;

    score += 1;
    if (startsWord(text, found)) score += 6;
    if (found === last + 1) score += 4;
    score -= Math.min(found - cursor, 6);

    positions.push(found);
    cursor = found + 1;
    last = found;
  }

  // A short label beats a long one that matches just as well, so the palette
  // offers the command before the paragraph.
  score -= Math.min(Math.floor(haystack.length / 20), 5);

  return { score, positions };
}

/**
 * The candidates that match a query, best first.
 *
 * A tie of the score is broken by the length of the text and then by the text
 * itself, so the order of the list is the same on every run.
 */
export function rankByFuzzy<T>(
  items: readonly T[],
  query: string,
  textOf: (item: T) => string,
): readonly Ranked<T>[] {
  const ranked: { item: T; score: number; text: string }[] = [];

  for (const item of items) {
    const text = textOf(item);
    const match = fuzzyScore(text, query);
    if (match) ranked.push({ item, score: match.score, text });
  }

  ranked.sort(
    (left, right) =>
      right.score - left.score ||
      left.text.length - right.text.length ||
      left.text.localeCompare(right.text),
  );

  return ranked.map(({ item, score }) => ({ item, score }));
}

/** The candidates that match a query, best first, without their scores. */
export function filterByFuzzy<T>(
  items: readonly T[],
  query: string,
  textOf: (item: T) => string,
): readonly T[] {
  return rankByFuzzy(items, query, textOf).map((entry) => entry.item);
}
