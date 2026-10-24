import {
  chunkStrips,
  clampVisibleCount,
  columnContainingStrip,
  continuesOnSamePage,
  insertAtPagePosition,
  makeSplitPieceFromLeaves,
  makeSplitPieces,
  MAX_VISIBLE_COUNT,
  mergedPartColumns,
  mergedPartLayouts,
  mergedStackHeight,
  mergedStackWidth,
  mergedStartY0,
  mergeWithAbove,
  MIN_VISIBLE_COUNT,
  moveToGarbage,
  overlapPxWithNext,
  pageFrames,
  relabelPages,
  replaceAt,
  restoreFromGarbage,
  sortByPagePosition,
  stripInsets,
  stripSlotHeight,
  toReaderStrips,
  type ReaderStrip,
} from "../corrections";

// A slicing-raster strip. Defaults: page 0, 1000 wide at x0 = 100, 200 tall.
function strip(id: string, overrides: Partial<ReaderStrip> = {}): ReaderStrip {
  return {
    id,
    uri: `file:///${id}.png`,
    width: 1000,
    height: 200,
    pageIndex: 0,
    x0: 100,
    y0: 0,
    ...overrides,
  };
}

function ids(strips: ReaderStrip[]): string[] {
  return strips.map((entry) => entry.id);
}

describe("clampVisibleCount", () => {
  it("keeps the count within the allowed range", () => {
    expect(clampVisibleCount(0)).toBe(MIN_VISIBLE_COUNT);
    expect(clampVisibleCount(4)).toBe(4);
    expect(clampVisibleCount(99)).toBe(MAX_VISIBLE_COUNT);
  });
});

describe("page order", () => {
  it("sorts by page, then by y0, without mutating the input", () => {
    const input = [
      strip("b", { pageIndex: 1, y0: 10 }),
      strip("c", { pageIndex: 0, y0: 500 }),
      strip("a", { pageIndex: 0, y0: 20 }),
    ];
    expect(ids(sortByPagePosition(input))).toEqual(["a", "c", "b"]);
    expect(ids(input)).toEqual(["b", "c", "a"]);
  });

  it("puts strips without y0 last on their page", () => {
    const sorted = sortByPagePosition([
      strip("noY", { pageIndex: 0, y0: undefined }),
      strip("top", { pageIndex: 0, y0: 50 }),
      strip("next", { pageIndex: 1, y0: 0 }),
    ]);
    expect(ids(sorted)).toEqual(["top", "noY", "next"]);
  });

  it("orders a merged strip by its first part", () => {
    const merged = strip("m", {
      pageIndex: 0,
      y0: undefined,
      parts: [strip("m1", { pageIndex: 1, y0: 300 }), strip("m2", { pageIndex: 1, y0: 600 })],
    });
    const sorted = sortByPagePosition([strip("p1", { pageIndex: 1, y0: 400 }), merged]);
    expect(ids(sorted)).toEqual(["m", "p1"]);
  });

  it("inserts at the page position", () => {
    const strips = [strip("a", { y0: 0 }), strip("c", { y0: 400 })];
    expect(ids(insertAtPagePosition(strips, strip("b", { y0: 200 })))).toEqual(["a", "b", "c"]);
    expect(ids(insertAtPagePosition(strips, strip("d", { y0: 900 })))).toEqual(["a", "c", "d"]);
  });

  it("inserts a strip without y0 after the last strip on its page", () => {
    const strips = [strip("a", { pageIndex: 0 }), strip("b", { pageIndex: 2 })];
    expect(ids(insertAtPagePosition(strips, strip("x", { pageIndex: 1, y0: undefined })))).toEqual([
      "a",
      "x",
      "b",
    ]);
  });

  it("relabels pages to their import position so a chosen order survives sorting", () => {
    const sliced = [
      { uri: "a", width: 10, height: 10, pageIndex: 2, y0: 0 },
      { uri: "b", width: 10, height: 10, pageIndex: 0, y0: 0 },
    ];
    // Imported in the order: page 2, then page 0.
    const relabelled = relabelPages(sliced, [2, 0]);
    expect(relabelled.map((entry) => entry.pageIndex)).toEqual([0, 1]);
    expect(toReaderStrips(relabelled).map((entry) => entry.uri)).toEqual(["a", "b"]);
  });

  it("gives raw strips ids and page order", () => {
    const readerStrips = toReaderStrips([
      { uri: "u1", width: 10, height: 10, pageIndex: 1, y0: 0 },
      { uri: "u0", width: 10, height: 10, pageIndex: 0, y0: 0 },
    ]);
    expect(ids(readerStrips)).toEqual(["1-u0", "0-u1"]);
  });
});

describe("continuesOnSamePage and overlapPxWithNext", () => {
  it("compares a merged strip's last part with the next strip's first part", () => {
    const spansBreak = strip("m", {
      pageIndex: 0,
      parts: [strip("m1", { pageIndex: 0, y0: 800 }), strip("m2", { pageIndex: 1, y0: 0 })],
    });
    expect(continuesOnSamePage(spansBreak, strip("n", { pageIndex: 1, y0: 300 }))).toBe(true);
    expect(continuesOnSamePage(spansBreak, strip("n", { pageIndex: 0, y0: 300 }))).toBe(false);
  });

  it("measures how far a strip runs into the next one", () => {
    expect(overlapPxWithNext(strip("a", { y0: 0, height: 200 }), strip("b", { y0: 180 }))).toBe(20);
  });

  it("is 0 for gaps, page breaks and missing y0", () => {
    expect(overlapPxWithNext(strip("a", { y0: 0 }), strip("b", { y0: 250 }))).toBe(0);
    expect(overlapPxWithNext(strip("a", { y0: 0 }), strip("b", { y0: 100, pageIndex: 1 }))).toBe(0);
    expect(overlapPxWithNext(strip("a", { y0: undefined }), strip("b", { y0: 100 }))).toBe(0);
  });
});

describe("merged layout", () => {
  const top = strip("top", { y0: 0, height: 200, x0: 100, width: 1000 });
  const bottom = strip("bottom", { y0: 180, height: 200, x0: 300, width: 800 });

  it("hides each part's overlap with the next, never the last part's", () => {
    const layouts = mergedPartLayouts([top, bottom]);
    expect(layouts.map((layout) => layout.hideBottomOverlapPx)).toEqual([20, 0]);
    expect(layouts.map((layout) => layout.stackSpan)).toEqual([180, 200]);
    expect(mergedStackHeight([top, bottom])).toBe(380);
  });

  it("keeps every part at least 1 px tall", () => {
    const covered = strip("covered", { y0: 0, height: 50 });
    const over = strip("over", { y0: 0, height: 200 });
    expect(mergedPartLayouts([covered, over])[0].stackSpan).toBe(1);
  });

  it("places parts by x0 inside the union of their spans", () => {
    // Union runs from 100 to 1100.
    expect(mergedStackWidth([top, bottom])).toBe(1000);
    expect(mergedPartColumns([top, bottom])).toEqual([
      { leftFraction: 0, widthFraction: 1 },
      { leftFraction: 0.2, widthFraction: 0.8 },
    ]);
  });

  it("falls back to full width when a part has no x0", () => {
    const old = strip("old", { x0: undefined, width: 900 });
    expect(mergedPartColumns([top, old])).toEqual([
      { leftFraction: 0, widthFraction: 1 },
      { leftFraction: 0, widthFraction: 1 },
    ]);
    expect(mergedStackWidth([top, old])).toBe(1000);
  });

  it("starts at the first part's y0 on its own page", () => {
    expect(mergedStartY0([])).toBeUndefined();
    expect(
      mergedStartY0([strip("a", { pageIndex: 0, y0: 500 }), strip("b", { pageIndex: 1, y0: 10 })])
    ).toBe(500);
    expect(
      mergedStartY0([strip("a", { pageIndex: 0, y0: undefined }), strip("b", { pageIndex: 0, y0: 40 })])
    ).toBe(40);
  });
});

describe("mergeWithAbove", () => {
  const strips = [
    strip("a", { y0: 0, x0: 100 }),
    strip("b", { y0: 180, x0: 300, width: 800 }),
    strip("c", { y0: 500 }),
  ];

  it("returns the same array for out-of-range indices", () => {
    expect(mergeWithAbove(strips, 0)).toBe(strips);
    expect(mergeWithAbove(strips, 3)).toBe(strips);
  });

  it("merges a strip into the one above", () => {
    const next = mergeWithAbove(strips, 1);
    expect(ids(next)).toEqual(["merged-a-b", "c"]);
    const merged = next[0];
    expect(merged.uri).toBe(strips[0].uri);
    expect(merged.pageIndex).toBe(0);
    expect(merged.x0).toBe(100);
    expect(merged.y0).toBe(0);
    expect(merged.width).toBe(1000);
    expect(merged.height).toBe(380);
    expect(ids(merged.parts ?? [])).toEqual(["a", "b"]);
  });

  it("flattens instead of nesting when merging an already merged strip", () => {
    const twice = mergeWithAbove(mergeWithAbove(strips, 1), 1);
    expect(twice).toHaveLength(1);
    expect(ids(twice[0].parts ?? [])).toEqual(["a", "b", "c"]);
  });

  it("drops x0 when any part lacks it", () => {
    const next = mergeWithAbove([strip("a"), strip("b", { y0: 300, x0: undefined })], 1);
    expect(next[0].x0).toBeUndefined();
  });
});

describe("pageFrames and stripInsets", () => {
  it("keeps an indented first system indented", () => {
    const first = strip("first", { x0: 250, width: 850 });
    const second = strip("second", { x0: 100, width: 1000, y0: 300 });
    const frames = pageFrames([first, second]);
    expect(frames.get(0)).toEqual({ x0: 100, x1: 1100 });
    expect(stripInsets(first, frames)).toEqual({ left: 0.15, right: 0 });
    expect(stripInsets(second, frames)).toEqual({ left: 0, right: 0 });
  });

  it("ignores strips much wider than the page's median", () => {
    const title = strip("title", { x0: 0, width: 1200 });
    const systems = [strip("s1", { y0: 300 }), strip("s2", { y0: 600 })];
    expect(pageFrames([title, ...systems]).get(0)).toEqual({ x0: 100, x1: 1100 });
  });

  it("gives no insets without x0 or without a frame for the page", () => {
    const frames = pageFrames([strip("a")]);
    expect(stripInsets(strip("noX", { x0: undefined }), frames)).toEqual({ left: 0, right: 0 });
    expect(stripInsets(strip("other", { pageIndex: 5 }), frames)).toEqual({ left: 0, right: 0 });
  });

  it("skips pages whose strips have no x0", () => {
    expect(pageFrames([strip("a", { x0: undefined })]).size).toBe(0);
  });
});

describe("columns", () => {
  it("chunks strips into columns of the visible count", () => {
    const columns = chunkStrips([strip("a"), strip("b"), strip("c")], 2);
    expect(columns.map((column) => [column.id, column.startIndex, ids(column.strips)])).toEqual([
      ["col-a", 0, ["a", "b"]],
      ["col-c", 2, ["c"]],
    ]);
    expect(chunkStrips([], 3)).toEqual([]);
  });

  it("starts a new column at each break", () => {
    const strips = ["a", "b", "c", "d", "e"].map((id) => strip(id));
    expect(chunkStrips(strips, 3, [2]).map((column) => ids(column.strips))).toEqual([
      ["a", "b"],
      ["c", "d", "e"],
    ]);
    expect(chunkStrips(strips, 2, [1, 4]).map((column) => ids(column.strips))).toEqual([
      ["a"],
      ["b", "c"],
      ["d"],
      ["e"],
    ]);
  });

  it("finds the column holding a strip, so the top system stays on screen", () => {
    const strips = ["a", "b", "c", "d", "e", "f", "g"].map((id) => strip(id));
    // Top of the screen is system 6 (index 5) with 3 per column…
    const three = chunkStrips(strips, 3);
    expect(three[columnContainingStrip(three, 3)].startIndex).toBe(3);
    // …switching to 4 per column shows systems 5-8, still including it.
    const four = chunkStrips(strips, 4);
    expect(columnContainingStrip(four, 5)).toBe(1);
    expect(columnContainingStrip(chunkStrips(strips, 1), 5)).toBe(5);
    expect(columnContainingStrip([], 5)).toBe(0);
  });

  it("divides the reader height between visible strips", () => {
    expect(stripSlotHeight(900, 3)).toBe(300);
    expect(stripSlotHeight(0, 3)).toBe(0);
    expect(stripSlotHeight(900, 0)).toBe(0);
    expect(stripSlotHeight(5, 10)).toBe(1);
  });
});

describe("garbage", () => {
  const strips = [strip("a", { y0: 0 }), strip("b", { y0: 300 }), strip("c", { y0: 600 })];

  it("round-trips a deleted strip back to its place", () => {
    const deleted = moveToGarbage(strips, [], 1);
    expect(ids(deleted.strips)).toEqual(["a", "c"]);
    expect(ids(deleted.garbage)).toEqual(["b"]);
    const restored = restoreFromGarbage(deleted.strips, deleted.garbage, 0);
    expect(ids(restored.strips)).toEqual(["a", "b", "c"]);
    expect(restored.garbage).toEqual([]);
  });

  it("keeps garbage in page order", () => {
    const first = moveToGarbage(strips, [], 2);
    const second = moveToGarbage(first.strips, first.garbage, 0);
    expect(ids(second.garbage)).toEqual(["a", "c"]);
  });

  it("never deletes the last strip or uses a bad index", () => {
    const one = [strip("only")];
    expect(moveToGarbage(one, [], 0).strips).toBe(one);
    expect(moveToGarbage(strips, [], 7).strips).toBe(strips);
    expect(restoreFromGarbage(strips, [], 0).strips).toBe(strips);
  });
});

describe("splitting", () => {
  it("replaces one strip with its pieces", () => {
    const strips = [strip("a"), strip("b")];
    expect(ids(replaceAt(strips, 0, [strip("a1"), strip("a2")]))).toEqual(["a1", "a2", "b"]);
    expect(replaceAt(strips, 0, [])).toBe(strips);
    expect(replaceAt(strips, 5, [strip("x")])).toBe(strips);
  });

  it("places pieces on the source's page at its y0 plus their origin", () => {
    const source = strip("src", { pageIndex: 2, x0: 120, y0: 1000 });
    const pieces = makeSplitPieces(
      source,
      [
        { uri: "top", width: 900, height: 100, originY: 0 },
        { uri: "bottom", width: 900, height: 120, originY: 90 },
      ],
      4
    );
    expect(pieces.map((piece) => [piece.id, piece.pageIndex, piece.x0, piece.y0])).toEqual([
      ["split-4-0-top", 2, 120, 1000],
      ["split-4-1-bottom", 2, 120, 1090],
    ]);
  });

  it("leaves y0 unset when the source or piece has no position", () => {
    const [piece] = makeSplitPieces(strip("src", { y0: undefined }), [
      { uri: "p", width: 1, height: 1, originY: 5 },
    ], 0);
    expect(piece.y0).toBeUndefined();
  });

  it("builds a piece from leaves", () => {
    expect(() => makeSplitPieceFromLeaves([], 0, 0)).toThrow();
    const leaf = strip("leaf");
    expect(makeSplitPieceFromLeaves([leaf], 0, 0)).toBe(leaf);
    const piece = makeSplitPieceFromLeaves([strip("l1", { y0: 0 }), strip("l2", { y0: 200 })], 1, 2);
    expect(piece.id).toBe("split-1-2-merged-l1-l2");
    expect(piece.height).toBe(400);
    expect(ids(piece.parts ?? [])).toEqual(["l1", "l2"]);
  });
});
