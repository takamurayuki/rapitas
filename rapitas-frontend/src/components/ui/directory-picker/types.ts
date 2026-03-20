/**
 * directory-picker/types
 *
 * Shared TypeScript types for the DirectoryPicker component family.
 * Not responsible for any UI rendering or data fetching.
 */

export type DirectoryEntry = {
  name: string;
  path: string;
  isDirectory: boolean;
};

export type BrowseResult = {
  path: string;
  parent: string | null;
  directories: DirectoryEntry[];
  isGitRepo?: boolean;
  error?: string;
  isDriveList?: boolean;
};

export type FavoriteDirectory = {
  id: number;
  path: string;
  name: string | null;
  isGitRepo: boolean;
  createdAt: string;
};

export type DirectoryPickerProps = {
  value: string;
  onChange: (path: string) => void;
  placeholder?: string;
  className?: string;
};
