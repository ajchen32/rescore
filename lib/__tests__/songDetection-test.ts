import type { ReaderStrip } from "../corrections";
import { suggestSongStarts } from "../songDetection";

let nextId = 0;
function strip(pageIndex: number, y0: number, height: number): ReaderStrip {
  nextId += 1;
  return { id: `s${nextId}`, uri: "", width: 1600, height, pageIndex, x0: 40, y0 };
}

// A page of systems: `first` is [y0, height] of its first system, then `count`
// regular systems of `height` below it.
function page(pageIndex: number, first: [number, number], count = 5, height = 360): ReaderStrip[] {
  const strips = [strip(pageIndex, first[0], first[1])];
  let y = first[0] + first[1];
  for (let i = 0; i < count; i += 1) {
    strips.push(strip(pageIndex, y, height));
    y += height;
  }
  return strips;
}

describe("suggestSongStarts", () => {
  it("always starts a song at the first system", () => {
    expect(suggestSongStarts([], [])).toEqual([0]);
    expect(suggestSongStarts(page(0, [20, 360]), [])).toEqual([0]);
  });

  it("finds a title folded into a page's first system (Seasons)", () => {
    // Page 1 continues the piece (starts below the page number); page 2 starts a new one.
    const strips = [...page(0, [20, 360]), ...page(1, [20, 360]), ...page(2, [0, 480])];
    expect(suggestSongStarts(strips, [])).toEqual([0, 12]);
  });

  it("finds a heading sliced on its own at the top of a page (Preludes)", () => {
    const strips = [...page(0, [20, 360]), ...page(1, [0, 250])];
    expect(suggestSongStarts(strips, [])).toEqual([0, 6]);
  });

  it("ignores a very short page header line", () => {
    const strips = [...page(0, [20, 360]), ...page(1, [0, 120])];
    expect(suggestSongStarts(strips, [])).toEqual([0]);
  });

  it("ignores a slightly taller first system that doesn't reach the top", () => {
    const strips = [...page(0, [20, 360]), ...page(1, [40, 480])];
    expect(suggestSongStarts(strips, [])).toEqual([0]);
  });

  it("finds a tall removed title band right above the first system", () => {
    const strips = [...page(0, [20, 360]), ...page(1, [400, 360])];
    const title: ReaderStrip = { ...strip(1, 0, 400), id: "title" };
    expect(suggestSongStarts(strips, [title])).toEqual([0, 6]);
    // A short header band doesn't count.
    const header: ReaderStrip = { ...strip(1, 300, 100), id: "header" };
    expect(suggestSongStarts(strips, [header])).toEqual([0]);
  });

  it("skips pages with a single system", () => {
    const strips = [...page(0, [20, 360]), strip(1, 0, 900)];
    expect(suggestSongStarts(strips, [])).toEqual([0]);
  });
});
