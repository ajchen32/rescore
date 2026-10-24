import { mergeWithAbove, moveToGarbage, replaceAt, type ReaderStrip } from "../corrections";
import {
  addBookmark,
  bookmarkAnchor,
  bookmarkAtStrip,
  bookmarkBreaks,
  bookmarkStartIndices,
  orderedBookmarks,
  pageBookmarks,
  type Bookmark,
} from "../bookmarks";

function strip(id: string, pageIndex: number, y0: number): ReaderStrip {
  return { id, uri: `file:///${id}.png`, width: 1000, height: 200, pageIndex, x0: 100, y0 };
}

// Page 0: a b c, page 1: d e, page 2: f
const strips = [
  strip("a", 0, 0),
  strip("b", 0, 300),
  strip("c", 0, 600),
  strip("d", 1, 0),
  strip("e", 1, 300),
  strip("f", 2, 0),
];

function bookmark(id: string, startStrip: ReaderStrip): Bookmark {
  return { id, title: id, start: bookmarkAnchor(startStrip) };
}

const bookmarks = [bookmark("one", strips[0]), bookmark("two", strips[2]), bookmark("three", strips[4])];

describe("bookmarks", () => {
  it("resolves each bookmark to its first system", () => {
    expect([...bookmarkStartIndices(strips, bookmarks)]).toEqual([
      ["one", 0],
      ["two", 2],
      ["three", 4],
    ]);
  });

  it("knows which bookmark a system belongs to", () => {
    expect(bookmarkAtStrip(strips, bookmarks, 1)?.id).toBe("one");
    expect(bookmarkAtStrip(strips, bookmarks, 3)?.id).toBe("two");
    expect(bookmarkAtStrip(strips, bookmarks, 5)?.id).toBe("three");
    expect(bookmarkAtStrip(strips, [bookmark("late", strips[2])], 0)).toBeNull();
  });

  it("breaks columns where bookmarks start, but not before the first system", () => {
    expect(bookmarkBreaks(strips, bookmarks)).toEqual([2, 4]);
  });

  it("keeps its start when its first system is deleted", () => {
    const { strips: next } = moveToGarbage(strips, [], 2);
    // "two" now starts at d, the next system.
    expect(bookmarkStartIndices(next, bookmarks).get("two")).toBe(2);
    expect(next[2].id).toBe("d");
  });

  it("keeps its start when systems are merged or split before it", () => {
    const merged = mergeWithAbove(strips, 1);
    expect(merged[bookmarkStartIndices(merged, bookmarks).get("two") as number].id).toBe("c");
    const split = replaceAt(strips, 0, [strip("a1", 0, 0), strip("a2", 0, 120)]);
    expect(split[bookmarkStartIndices(split, bookmarks).get("two") as number].id).toBe("c");
  });

  it("drops bookmarks that start after the last system or on the same system", () => {
    const past: Bookmark = { id: "past", title: "past", start: { pageIndex: 9, y0: 0 } };
    const twin = bookmark("twin", strips[2]);
    expect(orderedBookmarks(strips, [...bookmarks, past, twin]).map(({ bookmark: entry }) => entry.id)).toEqual([
      "one",
      "two",
      "three",
    ]);
  });

  it("adds bookmarks in reading order", () => {
    const next = addBookmark([bookmarks[0], bookmarks[2]], bookmarks[1]);
    expect(next.map((entry) => entry.id)).toEqual(["one", "two", "three"]);
  });

  it("turns pages marked in the picker into bookmarks at their first system", () => {
    // Imported pages 4, 1, 7 (picker indices) in that order; 1 and 7 marked, 9 not imported.
    const marks = pageBookmarks([4, 1, 7], new Set([1, 7, 9]));
    expect(marks.map((entry) => [entry.title, entry.start])).toEqual([
      ["Bookmark 1", { pageIndex: 1, y0: 0 }],
      ["Bookmark 2", { pageIndex: 2, y0: 0 }],
    ]);
    // Position 1 is page d's first system.
    expect(bookmarkStartIndices(strips, [marks[0]]).get(marks[0].id)).toBe(3);
  });
});
