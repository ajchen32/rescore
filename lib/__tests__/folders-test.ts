import {
  canMoveFolder,
  childFolders,
  folderItemCount,
  folderPath,
  isInsideFolder,
  removeFolder,
  resolveParentId,
  type Folder,
} from "../folders";

function folder(id: string, parentId: string | null, name = id): Folder {
  return { id, name, parentId, createdAt: 0 };
}

// Library ─ chopin ─ nocturnes
//         └ recital
const folders = [
  folder("chopin", null, "Chopin"),
  folder("nocturnes", "chopin", "Nocturnes"),
  folder("recital", null, "Recital"),
];
const items = [
  { id: "a", folderId: null },
  { id: "b", folderId: "chopin" },
  { id: "c", folderId: "nocturnes" },
  { id: "d", folderId: "gone" },
];

describe("folder tree", () => {
  it("treats items in a missing folder as being at the root", () => {
    expect(resolveParentId(folders, "gone")).toBeNull();
    expect(resolveParentId(folders, undefined)).toBeNull();
    expect(resolveParentId(folders, "chopin")).toBe("chopin");
  });

  it("lists child folders by name", () => {
    expect(childFolders(folders, null).map((entry) => entry.id)).toEqual(["chopin", "recital"]);
    expect(childFolders(folders, "chopin").map((entry) => entry.id)).toEqual(["nocturnes"]);
  });

  it("sorts numbered names naturally", () => {
    const books = [folder("b10", null, "Book 10"), folder("b2", null, "Book 2")];
    expect(childFolders(books, null).map((entry) => entry.name)).toEqual(["Book 2", "Book 10"]);
  });

  it("builds the path from the root", () => {
    expect(folderPath(folders, "nocturnes").map((entry) => entry.id)).toEqual(["chopin", "nocturnes"]);
    expect(folderPath(folders, null)).toEqual([]);
    expect(folderPath(folders, "gone")).toEqual([]);
  });

  it("stops on a parent cycle instead of looping", () => {
    const looped = [folder("x", "y"), folder("y", "x")];
    expect(folderPath(looped, "x").map((entry) => entry.id)).toEqual(["y", "x"]);
  });

  it("refuses to move a folder into itself or a subfolder", () => {
    expect(isInsideFolder(folders, "nocturnes", "chopin")).toBe(true);
    expect(canMoveFolder(folders, "chopin", "nocturnes")).toBe(false);
    expect(canMoveFolder(folders, "chopin", "chopin")).toBe(false);
    expect(canMoveFolder(folders, "nocturnes", null)).toBe(true);
    expect(canMoveFolder(folders, "nocturnes", "recital")).toBe(true);
  });

  it("counts what is directly inside a folder", () => {
    expect(folderItemCount({ folders, items }, "chopin")).toBe(2);
    expect(folderItemCount({ folders, items }, "recital")).toBe(0);
  });

  it("moves a deleted folder's contents up to its parent", () => {
    const next = removeFolder({ folders, items }, "chopin");
    expect(next.folders.map((entry) => [entry.id, entry.parentId])).toEqual([
      ["nocturnes", null],
      ["recital", null],
    ]);
    expect(next.items.find((item) => item.id === "b")?.folderId).toBeNull();
    expect(next.items.find((item) => item.id === "c")?.folderId).toBe("nocturnes");
  });

  it("ignores deleting a folder that doesn't exist", () => {
    const tree = { folders, items };
    expect(removeFolder(tree, "nope")).toBe(tree);
  });
});
