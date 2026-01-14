export interface ImportConflict {
  type: 'track' | 'folder' | 'multitrack';
  name: string;
  path: string;
  existingItem?: {
    created: string;
    modified: string;
  };
  newItem?: {
    size?: number;
    stepsCount?: number;
  };
}
