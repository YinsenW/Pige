import type {
  CollectionRenameViewRequest,
  CollectionRenameViewResult,
  CollectionUpdateViewRequest,
  CollectionUpdateViewResult,
  CollectionTrashViewRequest,
  CollectionTrashViewResult
} from "@pige/schemas";

export async function updateCollectionView(
  request: CollectionUpdateViewRequest,
  onCommitted: () => void
): Promise<CollectionUpdateViewResult> {
  const result = await window.pige.collections.updateView(request);
  if (result.status === "committed") onCommitted();
  return result;
}

export async function renameCollectionView(
  request: CollectionRenameViewRequest,
  onCommitted: () => void
): Promise<CollectionRenameViewResult> {
  const result = await window.pige.collections.renameView(request);
  if (result.status === "committed") onCommitted();
  return result;
}

export async function trashCollectionView(
  request: CollectionTrashViewRequest,
  onCommitted: () => void
): Promise<CollectionTrashViewResult> {
  const result = await window.pige.collections.trashView(request);
  if (result.status === "committed") onCommitted();
  return result;
}

export function collectionViewActivityMessageKey(kind: string): string | undefined {
  if (kind === "create_collection_view") return "activity.createdCollectionView";
  if (kind === "update_collection_view") return "activity.updatedCollectionView";
  if (kind === "rename_collection_view") return "activity.renamedCollectionView";
  if (kind === "trash_collection_view") return "activity.trashedCollectionView";
  return undefined;
}
