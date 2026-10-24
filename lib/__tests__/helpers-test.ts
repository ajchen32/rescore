import {
  normalizeFileUri,
  resolveLandscapeVisibleCount,
  resolvePortraitVisibleCount,
  savedStripToReaderStrip,
  uniqueScoreTitle,
  type SavedScore,
} from "../library";
import { isPdfAsset } from "../pdf";
import { clampOverlapRatio, clampSplitRatio, getStripStackSize } from "../splitStrip";

function score(overrides: Partial<SavedScore>): SavedScore {
  return { id: "s", title: "Score", createdAt: 0, stripCount: 0, strips: [], ...overrides };
}

describe("uniqueScoreTitle", () => {
  const scores = [score({ title: "Nocturne" }), score({ title: "Nocturne (1)" })];

  it("adds the first free number to a taken title", () => {
    expect(uniqueScoreTitle("Nocturne", scores)).toBe("Nocturne (2)");
    expect(uniqueScoreTitle("  Ballade ", scores)).toBe("Ballade");
  });

  it("names an empty title", () => {
    expect(uniqueScoreTitle("   ", [])).toBe("Untitled score");
  });
});

describe("saved scores", () => {
  it("reads visible counts, including the old single count", () => {
    expect(resolvePortraitVisibleCount(score({ visibleCount: 4 }))).toBe(4);
    expect(resolvePortraitVisibleCount(score({ portraitVisibleCount: 2, visibleCount: 4 }))).toBe(2);
    expect(resolvePortraitVisibleCount(score({}))).toBe(3);
    expect(resolveLandscapeVisibleCount(score({ landscapeVisibleCount: 99 }))).toBe(10);
    expect(resolveLandscapeVisibleCount(score({}))).toBe(1);
  });

  it("restores merged strips with their parts and ids", () => {
    const strip = savedStripToReaderStrip({
      uri: "file:///m.png",
      width: 10,
      height: 20,
      pageIndex: 1,
      parts: [{ id: "p", uri: "file:///p.png", width: 10, height: 10, pageIndex: 1, y0: 5 }],
    });
    expect(strip.id).toBe("1-file:///m.png");
    expect(strip.parts?.[0]).toMatchObject({ id: "p", y0: 5 });
  });

  it("leaves full file URIs alone", () => {
    expect(normalizeFileUri("file:///data/x.png")).toBe("file:///data/x.png");
  });

  // "file:/data/x.png" currently becomes "file://data/x.png" (one slash short).
  it.todo("repairs single-slash file URIs");
});

describe("isPdfAsset", () => {
  it("accepts a .pdf name or a PDF mime type", () => {
    expect(isPdfAsset("Score.PDF")).toBe(true);
    expect(isPdfAsset("download", "application/pdf")).toBe(true);
    expect(isPdfAsset("photo.jpg", "image/jpeg")).toBe(false);
    expect(isPdfAsset("photo.jpg")).toBe(false);
  });
});

describe("split helpers", () => {
  it("clamps cut and overlap ratios", () => {
    expect(clampSplitRatio(0)).toBe(0.05);
    expect(clampSplitRatio(0.5)).toBe(0.5);
    expect(clampSplitRatio(1)).toBe(0.95);
    expect(clampOverlapRatio(-1)).toBe(0);
    expect(clampOverlapRatio(1)).toBe(0.15);
  });

  it("measures a merged strip as its stacked size", () => {
    const top = { id: "t", uri: "t", width: 1000, height: 200, pageIndex: 0, x0: 100, y0: 0 };
    const bottom = { id: "b", uri: "b", width: 800, height: 200, pageIndex: 0, x0: 300, y0: 180 };
    expect(getStripStackSize(top)).toEqual({ width: 1000, height: 200 });
    expect(
      getStripStackSize({ ...top, id: "m", width: 1000, height: 380, parts: [top, bottom] })
    ).toEqual({ width: 1000, height: 380 });
  });
});
