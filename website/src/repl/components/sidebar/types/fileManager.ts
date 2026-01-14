/**
 * File Manager Type Definitions
 * Shared types for tracks, folders, and steps
 */

export interface Track {
  id: string;
  name: string;
  code: string;
  created: string;
  modified: string;
  folder?: string;
  isMultitrack?: boolean;
  steps?: TrackStep[];
  activeStep?: number;
}

export interface TrackStep {
  id: string;
  name: string;
  code: string;
  created: string;
  modified: string;
}

export interface Folder {
  id: string;
  name: string;
  path: string;
  parent?: string;
  created: string;
}
