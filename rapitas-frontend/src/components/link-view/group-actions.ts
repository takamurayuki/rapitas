/**
 * group-actions
 *
 * The group operations that touch both stores at once.
 *
 * A group is one thing with two halves: the library owns its name and
 * colour, the tab strip owns which tabs are filed under it. Deleting one
 * therefore has to reach both, and the rule lives here rather than in each
 * component that offers a delete button — two copies of "and don't forget
 * the tabs" is one copy away from a tab pointing at a group that is gone.
 */
import { useLinkViewStore } from '@/stores/link-view-store';
import { useLinkLibraryStore } from '@/stores/link-library-store';

/**
 * Delete a group wherever it is referenced.
 *
 * The pages and the tabs filed under it are released, not closed or
 * deleted — the group is an arrangement of them, and losing the
 * arrangement must not lose the contents.
 *
 * @param groupId - The group to remove / 削除するグループ
 */
export function deleteGroupEverywhere(groupId: string): void {
  useLinkViewStore.getState().ungroupTabs(groupId);
  useLinkLibraryStore.getState().removeGroup(groupId);
}

/**
 * Start a group holding one tab, as "add to new group" does.
 *
 * @param tabId - The tab to file / 対象のタブ
 * @param name - The new group's name / 新しいグループ名
 * @returns The new group's id / 作成したグループのID
 */
export function addTabToNewGroup(tabId: string, name: string): string {
  const groupId = useLinkLibraryStore.getState().addGroup(name);
  useLinkViewStore.getState().setTabGroup(tabId, groupId);
  return groupId;
}
