/** Which script a text is in (tiny; the romanizer itself loads only when used). */

const NON_LATIN = /[\u0370-\u03FF\u0400-\u052F\u0590-\u08FF\u0900-\u0DFF\u0E00-\u0EFF\u1100-\u11FF\u3040-\u30FF\u3130-\u318F\u3400-\u9FFF\uAC00-\uD7AF\uF900-\uFAFF]/;
const LETTER = /\p{L}/u;

/** Share of letters outside the Latin script (0…1). */
export function nonLatinShare(text: string): number {
  let all = 0;
  let non = 0;
  for (const ch of text) {
    if (!LETTER.test(ch)) continue;
    all++;
    if (NON_LATIN.test(ch)) non++;
  }
  return all ? non / all : 0;
}

export const needsRomanizing = (lines: string[]) => nonLatinShare(lines.join(" ")) > 0.2;
