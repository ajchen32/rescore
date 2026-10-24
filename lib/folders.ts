/** A library folder. Folders nest through `parentId`; null is the library root. */
export type Folder = {
  id: string;
  name: string;
  parentId: string | null;
  createdAt: number;
};

// The parts of the library the folder logic needs, so this stays free of file I/O.
type FolderTree<Item extends { folderId?: string | null }> = {
  folders: Folder[];
  items: Item[];
};

/** The folder an item or folder lives in; anything pointing at a missing folder is at the root. */
export function resolveParentId(folders: Folder[], parentId: string | null | undefined): string | null {
  if (!parentId) {
    return null;
  }
  return folders.some((folder) => folder.id === parentId) ? parentId : null;
}

export function childFolders(folders: Folder[], parentId: string | null): Folder[] {
  return folders
    .filter((folder) => resolveParentId(folders, folder.parentId) === parentId)
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true }));
}

/** Folders from the root down to `folderId` (inclusive); empty for the root or a missing folder. */
export function folderPath(folders: Folder[], folderId: string | null): Folder[] {
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const path: Folder[] = [];
  let current = folderId ? byId.get(folderId) : undefined;
  while (current && !path.includes(current)) {
    path.unshift(current);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return path;
}

/** Whether `folderId` is `ancestorId` or somewhere inside it. */
export function isInsideFolder(folders: Folder[], folderId: string | null, ancestorId: string): boolean {
  return folderPath(folders, folderId).some((folder) => folder.id === ancestorId);
}

/** A folder can't move into itself or into one of its own subfolders. */
export function canMoveFolder(folders: Folder[], folderId: string, targetParentId: string | null): boolean {
  return !isInsideFolder(folders, targetParentId, folderId);
}

/** Folders and items directly inside `folderId`. */
export function folderItemCount<Item extends { folderId?: string | null }>(
  tree: FolderTree<Item>,
  folderId: string
): number {
  const folders = tree.folders.filter(
    (folder) => resolveParentId(tree.folders, folder.parentId) === folderId
  ).length;
  const items = tree.items.filter(
    (item) => resolveParentId(tree.folders, item.folderId) === folderId
  ).length;
  return folders + items;
}

/** Removes a folder; its subfolders and items move up to the folder's parent. */
export function removeFolder<Item extends { folderId?: string | null }>(
  tree: FolderTree<Item>,
  folderId: string
): FolderTree<Item> {
  const removed = tree.folders.find((folder) => folder.id === folderId);
  if (!removed) {
    return tree;
  }
  const parentId = resolveParentId(tree.folders, removed.parentId);
  return {
    folders: tree.folders
      .filter((folder) => folder.id !== folderId)
      .map((folder) => (folder.parentId === folderId ? { ...folder, parentId } : folder)),
    items: tree.items.map((item) => (item.folderId === folderId ? { ...item, folderId: parentId } : item)),
  };
}
