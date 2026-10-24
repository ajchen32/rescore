import type { ReaderStrip } from "../corrections";
import { buildPersistSnapshot, persistSnapshotsEqual } from "../persistSnapshot";

const strip: ReaderStrip = { id: "a", uri: "file:///a.png", width: 10, height: 5, pageIndex: 0 };

describe("persist snapshots", () => {
  const base = buildPersistSnapshot([strip], [], 3, 1, "Nocturne");

  it("treats equal content as unchanged, even in new arrays", () => {
    expect(persistSnapshotsEqual(base, buildPersistSnapshot([{ ...strip }], [], 3, 1, "Nocturne"))).toBe(
      true
    );
  });

  it("notices a change to songs", () => {
    const song = { id: "s", title: "Nocturne", start: { pageIndex: 0, y0: 0 } };
    expect(persistSnapshotsEqual(base, buildPersistSnapshot([strip], [], 3, 1, "Nocturne", [song]))).toBe(
      false
    );
  });

  it("notices a change to strips, garbage, counts or title", () => {
    expect(persistSnapshotsEqual(base, buildPersistSnapshot([], [], 3, 1, "Nocturne"))).toBe(false);
    expect(persistSnapshotsEqual(base, buildPersistSnapshot([strip], [strip], 3, 1, "Nocturne"))).toBe(
      false
    );
    expect(persistSnapshotsEqual(base, buildPersistSnapshot([strip], [], 4, 1, "Nocturne"))).toBe(false);
    expect(persistSnapshotsEqual(base, buildPersistSnapshot([strip], [], 3, 2, "Nocturne"))).toBe(false);
    expect(persistSnapshotsEqual(base, buildPersistSnapshot([strip], [], 3, 1, "Ballade"))).toBe(false);
  });
});
