/**
 * Lyrics in Roman letters, the way people actually write them
 * ("tum hi ho", "ami tomake bhalobashi", "saranghaeyo").
 *
 *  - Indic scripts (Devanagari, Bengali, Gurmukhi, Gujarati, Odia, Tamil,
 *    Telugu, Kannada, Malayalam): letter-by-letter with the inherent vowel
 *    handled properly — dropped at word end and between syllables the way
 *    Hindi / Bengali speech drops it (character tables like any-ascii keep
 *    none of it: "करना" → "krna"; here → "karna").
 *  - Korean: Revised Romanization with linking ("사랑해요" → "saranghaeyo").
 *  - Japanese kana: Hepburn. Kanji are left as they are (no dictionary).
 *  - Chinese: pinyin syllables; Cyrillic, Greek, Arabic…: any-ascii.
 */
import anyAscii from "any-ascii";

/* ------------------------------ detection -------------------------------- */

import { nonLatinShare, needsRomanizing } from "@/utils/script";
export { nonLatinShare, needsRomanizing };

/* -------------------------------- Indic ---------------------------------- */

type Profile = "hindi" | "bengali" | "punjabi" | "south";
const BLOCKS: [number, Profile][] = [
  [0x0900, "hindi"],
  [0x0980, "bengali"],
  [0x0a00, "punjabi"],
  [0x0a80, "hindi"], // Gujarati
  [0x0b00, "bengali"], // Odia: inherent "o"
  [0x0b80, "south"],
  [0x0c00, "south"],
  [0x0c80, "south"],
  [0x0d00, "south"],
];
const blockOf = (cp: number) => (cp >= 0x0900 && cp < 0x0d80 ? BLOCKS[(cp - 0x0900) >> 7] : null);

// Devanagari-aligned offsets (all nine scripts share the layout).
const CONS: Record<number, string> = {
  0x15: "k", 0x16: "kh", 0x17: "g", 0x18: "gh", 0x19: "n",
  0x1a: "ch", 0x1b: "chh", 0x1c: "j", 0x1d: "jh", 0x1e: "n",
  0x1f: "t", 0x20: "th", 0x21: "d", 0x22: "dh", 0x23: "n",
  0x24: "t", 0x25: "th", 0x26: "d", 0x27: "dh", 0x28: "n", 0x29: "n",
  0x2a: "p", 0x2b: "ph", 0x2c: "b", 0x2d: "bh", 0x2e: "m",
  0x2f: "y", 0x30: "r", 0x31: "r", 0x32: "l", 0x33: "l", 0x34: "zh", 0x35: "v",
  0x36: "sh", 0x37: "sh", 0x38: "s", 0x39: "h",
  // precomposed nukta letters
  0x58: "q", 0x59: "kh", 0x5a: "gh", 0x5b: "z", 0x5c: "d", 0x5d: "dh", 0x5e: "f", 0x5f: "y",
};
const NUKTA: Record<string, string> = { k: "q", kh: "kh", g: "gh", j: "z", d: "d", dh: "dh", ph: "f", y: "y" };
const VOWEL_SIGN: Record<number, string> = {
  0x3e: "aa", 0x3f: "i", 0x40: "ii", 0x41: "u", 0x42: "uu", 0x43: "ri", 0x44: "ri",
  0x45: "e", 0x46: "e", 0x47: "e", 0x48: "ai", 0x49: "o", 0x4a: "o", 0x4b: "o", 0x4c: "au",
  0x62: "li", 0x63: "li",
};
const VOWEL_LETTER: Record<number, string> = {
  0x05: "a", 0x06: "aa", 0x07: "i", 0x08: "ii", 0x09: "u", 0x0a: "uu", 0x0b: "ri", 0x0c: "li",
  0x0d: "e", 0x0e: "e", 0x0f: "e", 0x10: "ai", 0x11: "o", 0x12: "o", 0x13: "o", 0x14: "au", 0x60: "ri", 0x61: "li",
};
const CHILLU: Record<number, string> = { 0x0d7a: "n", 0x0d7b: "n", 0x0d7c: "r", 0x0d7d: "l", 0x0d7e: "l", 0x0d7f: "k", 0x0d54: "m", 0x0d55: "y", 0x0d56: "zh" };

interface Unit {
  c: string; // consonant(s), "" for a vowel letter
  v: string | null; // vowel key; null = inherent
  hal: boolean; // ends in a virama (no vowel)
  cluster: boolean;
  nas: "" | "anu" | "chandra";
  vis: boolean;
  del: boolean;
  indep: boolean;
}

function consFor(off: number, p: Profile, inCluster: boolean): string {
  let c = CONS[off];
  if (p === "bengali") {
    if (off === 0x2f) c = inCluster ? "y" : "j"; // য / য-phala
    else if (off === 0x1b) c = "ch";
    else if (off === 0x5c) c = "r"; // ড়
    else if (off === 0x5d) c = "rh"; // ঢ়
    else if (off === 0x19) c = "ng";
  } else if (p === "south") {
    if (off === 0x24) c = "th";
    else if (off === 0x1e) c = "ny";
  } else if (off === 0x35 && inCluster) c = "w";
  return c;
}

function indicWord(word: string, p: Profile): string {
  const units: Unit[] = [];
  let addak = false;
  const chars = [...word];
  for (let i = 0; i < chars.length; i++) {
    const cp = chars[i].codePointAt(0)!;
    const blk = blockOf(cp);
    if (!blk) continue;
    const off = cp - blk[0] + 0x0900 - 0x0900;
    const last = units[units.length - 1];
    if (CHILLU[cp]) {
      units.push({ c: CHILLU[cp], v: null, hal: true, cluster: false, nas: "", vis: false, del: false, indep: false });
    } else if (cp === 0x09ce) {
      units.push({ c: "t", v: null, hal: true, cluster: false, nas: "", vis: false, del: false, indep: false }); // ৎ
    } else if (cp === 0x0a70 || off === 0x02 || off === 0x01) {
      if (last) last.nas = off === 0x01 ? "chandra" : "anu";
    } else if (cp === 0x0a71) {
      addak = true;
    } else if (off === 0x03) {
      if (last) last.vis = true;
    } else if (off === 0x3c) {
      if (last && !last.hal && last.v === null) {
        const tail = last.c.match(/(kh|gh|dh|ph|[kgjdy])$/)?.[0];
        const bn: Record<string, string> = { d: "r", dh: "rh", j: "y" };
        if (tail) last.c = last.c.slice(0, -tail.length) + (p === "bengali" && bn[tail] ? bn[tail] : NUKTA[tail]);
      }
    } else if (off === 0x4d) {
      if (last) last.hal = true;
    } else if (CONS[off] !== undefined) {
      const joined = last && last.hal && last.c && i > 0;
      let c = consFor(off, p, Boolean(joined));
      // Bengali ব-phala is silent (স্বপ্ন → shopno) except after ম (ম্ব → mb)
      if (joined && p === "bengali" && off === 0x2c && !last.c.endsWith("m")) c = "";
      if (addak && c) {
        c = c[0] + c;
        addak = false;
      }
      if (joined) {
        // ज्ञ → gy, Bengali স before a conjunct stays "s"
        if (last.c.endsWith("j") && off === 0x1e) last.c = last.c.slice(0, -1) + "gy";
        else last.c += c;
        last.hal = false;
        last.cluster = true;
      } else units.push({ c, v: null, hal: false, cluster: false, nas: "", vis: false, del: false, indep: false });
    } else if (VOWEL_SIGN[off]) {
      if (last) last.v = VOWEL_SIGN[off];
    } else if (VOWEL_LETTER[off]) {
      units.push({ c: "", v: VOWEL_LETTER[off], hal: false, cluster: false, nas: "", vis: false, del: false, indep: true });
    } else if (off === 0x50) {
      units.push({ c: "", v: "om", hal: false, cluster: false, nas: "", vis: false, del: false, indep: true });
    }
  }
  const n = units.length;
  if (!n) return "";

  // Bengali: স is "sh" except right before another consonant (স্ত, স্ক…).
  if (p === "bengali") for (const u of units) if (u.c === "s") u.c = "sh";

  // Inherent vowel deletion (Hindi / Bengali / Punjabi): at the end of the
  // word, and in V C(a) C V positions, right to left.
  if (p !== "south") {
    const hasV = (u: Unit) => !u.hal && !(u.v === null && u.del);
    const lastU = units[n - 1];
    if (n > 1 && lastU.v === null && !lastU.hal && !lastU.nas) {
      const keep = lastU.cluster && (p === "bengali" || /[ryvw]$/.test(lastU.c));
      if (!keep) lastU.del = true;
    }
    for (let i = n - 2; i >= 1; i--) {
      const u = units[i];
      const prev = units[i - 1];
      const next = units[i + 1];
      if (u.v !== null || u.hal || u.cluster || u.nas || u.vis || !u.c) continue;
      if (!hasV(prev) || prev.nas || prev.vis) continue;
      if (!hasV(next) || next.cluster || !next.c) continue;
      u.del = true;
    }
  }

  const inherent = p === "bengali" ? "o" : "a";
  let out = "";
  units.forEach((u, i) => {
    const final = i === n - 1;
    let v = "";
    if (!u.hal) {
      if (u.v === null) v = u.del ? "" : inherent;
      else if (p === "bengali") v = { aa: "a", ii: "i", uu: "u", ai: "oi", au: "ou" }[u.v] ?? u.v;
      else if (p === "south") v = { ii: "ee", uu: "oo" }[u.v] ?? u.v;
      else if (u.v === "aa") v = final && n > 1 ? "a" : "aa";
      else if (u.v === "ii") v = final ? "i" : "ee";
      else if (u.v === "uu") v = final ? "u" : "oo";
      else v = u.v;
    }
    let nas = "";
    if (u.nas) {
      if (p === "bengali") nas = u.nas === "anu" ? "ng" : "n";
      else if (final && p !== "south") {
        if (u.v === "e") v = "ei";
        else if (u.v === "ii") v = "i";
        else if (u.v === "uu") v = p === "punjabi" ? "u" : "oo";
        else if (u.v === "aa") v = "aa";
        nas = p === "punjabi" && u.v === "uu" ? "" : "n";
      } else {
        const nextC = units[i + 1]?.c ?? "";
        nas = /^[pbm]/.test(nextC) || (final && p === "south") ? "m" : "n";
      }
    }
    out += u.c + v + nas + (u.vis ? "h" : "");
  });
  return out;
}

/* -------------------------------- Korean --------------------------------- */

const KL = ["g", "kk", "n", "d", "tt", "r", "m", "b", "pp", "s", "ss", "", "j", "jj", "ch", "k", "t", "p", "h"];
const KV = ["a", "ae", "ya", "yae", "eo", "e", "yeo", "ye", "o", "wa", "wae", "oe", "yo", "u", "wo", "we", "wi", "yu", "eu", "ui", "i"];
const KT = ["", "k", "k", "k", "n", "n", "n", "t", "l", "k", "m", "l", "l", "l", "p", "l", "m", "p", "p", "t", "t", "ng", "t", "t", "k", "t", "p", "t"];
// final consonant carried over to a following silent ㅇ
const KLINK = ["", "g", "kk", "ks", "n", "nj", "n", "d", "r", "lg", "lm", "lb", "ls", "lt", "lp", "r", "m", "b", "ps", "s", "ss", "ng", "j", "ch", "k", "t", "p", ""];

function hangulWord(word: string): string {
  const syl = [...word].map((ch) => {
    const s = ch.codePointAt(0)! - 0xac00;
    return s >= 0 && s < 11172 ? { l: Math.floor(s / 588), v: Math.floor((s % 588) / 28), t: s % 28 } : null;
  });
  let out = "";
  syl.forEach((x, i) => {
    if (!x) return;
    const prev = syl[i - 1];
    const next = syl[i + 1];
    const linked = prev && prev.t && x.l === 11 && prev.t !== 21;
    out += (linked ? "" : KL[x.l]) + KV[x.v];
    if (x.t) out += next && next.l === 11 && x.t !== 21 ? KLINK[x.t] : KT[x.t];
  });
  return out.replace(/lr/g, "ll").replace(/nr/g, "ll");
}

/* ------------------------------- Japanese -------------------------------- */

const KANA =
  "a i u e o ka ki ku ke ko ga gi gu ge go sa shi su se so za ji zu ze zo ta chi tsu te to da ji zu de do na ni nu ne no ha hi fu he ho ba bi bu be bo pa pi pu pe po ma mi mu me mo ya yu yo ra ri ru re ro wa wo n";
const KANA_CHARS = "あいうえおかきくけこがぎぐげごさしすせそざじずぜぞたちつてとだぢづでどなにぬねのはひふへほばびぶべぼぱぴぷぺぽまみむめもやゆよらりるれろわをん";
const KANA_MAP = new Map<string, string>();
{
  const r = KANA.split(" ");
  [...KANA_CHARS].forEach((c, i) => KANA_MAP.set(c, r[i]));
  KANA_MAP.set("ぁ", "a").set("ぃ", "i").set("ぅ", "u").set("ぇ", "e").set("ぉ", "o").set("ゔ", "vu");
}
const SMALL_Y: Record<string, string> = { ゃ: "ya", ゅ: "yu", ょ: "yo" };

function kanaRun(run: string): string {
  // katakana → hiragana
  const h = [...run].map((c) => {
    const cp = c.codePointAt(0)!;
    return cp >= 0x30a1 && cp <= 0x30f6 ? String.fromCodePoint(cp - 0x60) : c;
  });
  let out = "";
  let double = false;
  for (let i = 0; i < h.length; i++) {
    const c = h[i];
    if (c === "っ") {
      double = true;
      continue;
    }
    if (c === "ー") {
      out += out.slice(-1);
      continue;
    }
    let r = KANA_MAP.get(c);
    if (!r) {
      out += c;
      continue;
    }
    const y = SMALL_Y[h[i + 1]];
    if (y) {
      r = /^(shi|chi|ji)$/.test(r) ? r.slice(0, -1) + y.slice(1) : r.slice(0, -1) + y;
      i++;
    }
    if (double) {
      r = (r.startsWith("ch") ? "t" : r[0]) + r;
      double = false;
    }
    out += r;
  }
  return out;
}

/* ------------------------------- dispatcher ------------------------------ */

const INDIC_RUN = /[\u0900-\u0D7F]+/g;
const HANGUL_RUN = /[\uAC00-\uD7AF]+/g;
const KANA_RUN = /[\u3041-\u3096\u30A1-\u30FA\u30FC]+/g;
const HAN_RUN = /[\u3400-\u9FFF\uF900-\uFAFF]+/g;

export function romanizeLine(line: string, japanese = false): string {
  let s = line
    .replace(INDIC_RUN, (w) => indicWord(w, blockOf(w.codePointAt(0)!)?.[1] ?? "hindi"))
    .replace(HANGUL_RUN, hangulWord)
    .replace(KANA_RUN, kanaRun);
  if (!japanese) s = s.replace(HAN_RUN, (w) => " " + [...w].map((c) => anyAscii(c).toLowerCase()).join(" ") + " ");
  // Indic punctuation, then everything else any-ascii knows (Cyrillic, Arabic…)
  s = s.replace(/[\u0964\u0965]/g, ",").replace(/[^\x00-\x7F\u3400-\u9FFF\uF900-\uFAFF]+/g, (w) => anyAscii(w));
  return s.replace(/\s+([,.!?])/g, "$1").replace(/\s{2,}/g, " ").trim();
}

export function romanizeLines(lines: string[]): string[] {
  const japanese = lines.some((l) => /[\u3041-\u3096\u30A1-\u30FA]/.test(l));
  return lines.map((l) => romanizeLine(l, japanese));
}
