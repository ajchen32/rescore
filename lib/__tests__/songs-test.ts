import { mergeWithAbove, moveToGarbage, replaceAt, type ReaderStrip } from "../corrections";
import {
  addSong,
  orderedSongs,
  songAnchor,
  songAtStrip,
  songBreaks,
  songStartIndices,
  type Song,
} from "../songs";

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

function song(id: string, startStrip: ReaderStrip): Song {
  return { id, title: id, start: songAnchor(startStrip) };
}

const songs = [song("one", strips[0]), song("two", strips[2]), song("three", strips[4])];

describe("songs", () => {
  it("resolves each song to its first system", () => {
    expect([...songStartIndices(strips, songs)]).toEqual([
      ["one", 0],
      ["two", 2],
      ["three", 4],
    ]);
  });

  it("knows which song a system belongs to", () => {
    expect(songAtStrip(strips, songs, 1)?.id).toBe("one");
    expect(songAtStrip(strips, songs, 3)?.id).toBe("two");
    expect(songAtStrip(strips, songs, 5)?.id).toBe("three");
    expect(songAtStrip(strips, [song("late", strips[2])], 0)).toBeNull();
  });

  it("breaks columns where songs start, but not before the first system", () => {
    expect(songBreaks(strips, songs)).toEqual([2, 4]);
  });

  it("keeps its start when its first system is deleted", () => {
    const { strips: next } = moveToGarbage(strips, [], 2);
    // "two" now starts at d, the next system.
    expect(songStartIndices(next, songs).get("two")).toBe(2);
    expect(next[2].id).toBe("d");
  });

  it("keeps its start when systems are merged or split before it", () => {
    const merged = mergeWithAbove(strips, 1);
    expect(merged[songStartIndices(merged, songs).get("two") as number].id).toBe("c");
    const split = replaceAt(strips, 0, [strip("a1", 0, 0), strip("a2", 0, 120)]);
    expect(split[songStartIndices(split, songs).get("two") as number].id).toBe("c");
  });

  it("drops songs that start after the last system or on the same system", () => {
    const past: Song = { id: "past", title: "past", start: { pageIndex: 9, y0: 0 } };
    const twin = song("twin", strips[2]);
    expect(orderedSongs(strips, [...songs, past, twin]).map(({ song: entry }) => entry.id)).toEqual([
      "one",
      "two",
      "three",
    ]);
  });

  it("adds songs in reading order", () => {
    const next = addSong([songs[0], songs[2]], songs[1]);
    expect(next.map((entry) => entry.id)).toEqual(["one", "two", "three"]);
  });
});
