import { describe, expect, it } from "vitest";
import { briefFor, parseCsv, parseEpisodes, pickRows, toCsv } from "./episodes.js";

describe("parseCsv / toCsv", () => {
  it("handles quotes, embedded commas, doubled quotes and newlines, and round-trips", () => {
    const text = 'a,b,c\n1,"x, y","say ""hi"""\n2,"two\nlines",\n';
    const rows = parseCsv(text);
    expect(rows).toEqual([
      ["a", "b", "c"],
      ["1", "x, y", 'say "hi"'],
      ["2", "two\nlines", ""],
    ]);
    expect(parseCsv(toCsv(rows))).toEqual(rows);
  });

  it("ignores a trailing blank line and CRLF endings", () => {
    expect(parseCsv("a,b\r\n1,2\r\n\r\n")).toEqual([["a", "b"], ["1", "2"]]);
  });

  it("rejects an unclosed quote", () => {
    expect(() => parseCsv('a\n"open')).toThrow(/unclosed quote/);
  });
});

const HEAD = "ep,title,year,format,product,punchline,hook,tone";

describe("parseEpisodes", () => {
  it("reads rows into episodes and fills defaults", () => {
    const eps = parseEpisodes(`${HEAD}\n2,Ringtones,2004,F3,ringtone subscription,"Five stars, and my phone screams.",Five stars. My phone screams.,deadpan\n`);
    expect(eps[0]).toMatchObject({ ep: 2, year: 2004, format: "F3", product: "ringtone subscription", hook: "Five stars. My phone screams.", slug: "cb-ep02-ringtone-subscription" });
  });

  it("names the row and column of a bad value", () => {
    expect(() => parseEpisodes(`${HEAD}\n2,T,20x4,F3,p,punch,hook,tone\n`)).toThrow(/row 2: year/);
    expect(() => parseEpisodes(`${HEAD}\n2,T,2004,F99,p,punch,hook,tone\n`)).toThrow(/row 2: format/);
  });

  it("requires the core columns and refuses duplicate episode numbers", () => {
    expect(() => parseEpisodes("ep,title\n1,x\n")).toThrow(/missing column.*year/);
    expect(() => parseEpisodes(`${HEAD}\n1,a,1999,F2,p,punch,h,t\n1,b,1999,F2,p,punch,h,t\n`)).toThrow(/ep 1 appears twice/);
  });

  it("refuses a slug that could escape renders/", () => {
    expect(() => parseEpisodes(`${HEAD},slug\n1,a,1999,F2,p,punch,h,t,../../etc\n`)).toThrow(/slug/);
  });
});

describe("pickRows", () => {
  const eps = parseEpisodes(`${HEAD}\n${[1, 2, 3, 4, 5, 6].map((n) => `${n},t${n},1999,F2,p${n},punch,h,t`).join("\n")}\n`);
  it("defaults to the first 5 rows", () => expect(pickRows(eps, undefined).map((e) => e.ep)).toEqual([1, 2, 3, 4, 5]));
  it("takes ranges and lists of episode numbers", () => {
    expect(pickRows(eps, "2-4").map((e) => e.ep)).toEqual([2, 3, 4]);
    expect(pickRows(eps, "1,6").map((e) => e.ep)).toEqual([1, 6]);
  });
  it("rejects episode numbers not in the file", () => expect(() => pickRows(eps, "7")).toThrow(/ep 7/));
});

describe("briefFor", () => {
  it("builds a brief that carries the punchline's facts (the claims guard checks lines against it)", () => {
    const [e] = parseEpisodes(`${HEAD}\n4,T9,2003,F5,T9 texting,"Typing 'hello' takes 13 presses. What if it took 5?",13 presses for hello.,deadpan\n`);
    if (!e) throw new Error("row");
    const b = briefFor(e);
    expect(b).toContain("2003");
    expect(b).toContain("13 presses");
    expect(b).toMatch(/generic/i);
    expect(b).toMatch(/parody/i);
  });

  it("uses the brief column when the row has one", () => {
    const [e] = parseEpisodes(`${HEAD},brief\n1,a,1999,F2,p,punch,h,t,"A custom brief that is long enough to use."\n`);
    if (!e) throw new Error("row");
    expect(briefFor(e)).toBe("A custom brief that is long enough to use.");
  });
});
