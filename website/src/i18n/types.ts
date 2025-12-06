// Type definitions for i18n resources
export interface CommonTranslations {
  close: string;
  cancel: string;
  confirm: string;
  save: string;
  delete: string;
  edit: string;
  loading: string;
  error: string;
  success: string;
  selectOption: string;
  play: string;
  stop: string;
  update: string;
  shuffle: string;
  files: string;
  docs: string;
  toggleFileManager: string;
}

export interface FilesTranslations {
  newTrack: string;
  save: string;
  load: string;
  delete: string;
  download: string;
  downloadFolder: string;
  import: string;
  duplicate: string;
  rename: string;
  copyCode: string;
  untitled: string;
  confirmDelete: string;
  playFile: string;
  copyPath: string;
  copySampleCode: string;
  info: string;
  empty: string;
  helpText: string;
  trackProperties: string;
  fileProperties: string;
  folderProperties: string;
  deleteTrack: string;
  confirmDeleteTrack: string;
  actionCannotBeUndone: string;
  name: string;
  type: string;
  path: string;
  created: string;
  modified: string;
  size: string;
  linesOfCode: string;
  characters: string;
  extension: string;
  folder: string;
  audioFile: string;
  unknown: string;
  noCodeToSave: string;
  trackSaved: string;
  trackDuplicated: string;
  trackDownloaded: string;
  trackRenamed: string;
  trackDeleted: string;
  codeCopied: string;
  pathCopied: string;
  copyFailed: string;
  rightClickForOptions: string;
  currentTrack: string;
  saveChanges: string;
  trackName: string;
  create: string;
  noTracksYet: string;
  importTrack: string;
  newFolder: string;
  folderName: string;
  createFolder: string;
  openFolder: string;
  folderDeleted: string;
  folderRenamed: string;
  folderNotEmpty: string;
  noItemsInFolder: string;
  trackMoved: string;
  folderMoved: string;
  rootFolder: string;
  rightClickToCreate: string;
  exportAll: string;
  dropToImport: string;
  trackImported: string;
  invalidFileType: string;
  convertToMultitrack: string;
  convertedToMultitrack: string;
  addStep: string;
  stepName: string;
  stepAdded: string;
  stepDeleted: string;
  cannotDeleteLastStep: string;
  multitrackDownloaded: string;
  folderDownloaded: string;
  emptyFolder: string;
  activeStep: string;
  newMultitrack: string;
  multitrackCreated: string;
  stepRenamed: string;
}

export interface SettingsTranslations {
  language: string;
  audioOutput: string;
  audioEngine: string;
  maxPolyphony: string;
  multiChannelOrbits: string;
  theme: string;
  fontFamily: string;
  fontSize: string;
  keybindings: string;
  panelPosition: string;
  openPanelOn: string;
  moreSettings: string;
  bracketMatching: string;
  autoCloseBrackets: string;
  lineNumbers: string;
  highlightActiveLine: string;
  highlightEvents: string;
  autoCompletion: string;
  tooltips: string;
  lineWrapping: string;
  tabIndentation: string;
  multiCursor: string;
  flashOnEval: string;
  syncTabs: string;
  hideButtons: string;
  disableAnimations: string;
  zenMode: string;
  resetSettings: string;
  restoreDefaults: string;
  bottom: string;
  right: string;
  click: string;
  hover: string;
  autosave: string;
  autosaveEnabled: string;
  autosaveInterval: string;
  autosaveDescription: string;
}

export interface TabsTranslations {
  welcome: string;
  files: string;
  patterns: string;
  sounds: string;
  reference: string;
  console: string;
  settings: string;
}

export interface MessagesTranslations {
  zenModeHint: string;
  reloadRequired: string;
  confirmReset: string;
}

export interface WelcomeTranslations {
  title: string;
  description: string;
  steps: string;
  getStarted: string;
  interactiveTutorial: string;
  joinDiscord: string;
  discordChannel: string;
  discordText: string;
  aboutTitle: string;
  aboutDescription: string;
  tidalcycles: string;
  tidalDescription: string;
  license: string;
  sourceCode: string;
  codeberg: string;
  licensingInfo: string;
  defaultSounds: string;
  support: string;
  supportText: string;
}

export interface Resources {
  common: CommonTranslations;
  files: FilesTranslations;
  settings: SettingsTranslations;
  tabs: TabsTranslations;
  messages: MessagesTranslations;
  welcome: WelcomeTranslations;
}

// Namespace type
export type Namespace = keyof Resources;

// Translation function type for a specific namespace
export type TranslationFunction<T extends Namespace> = (key: keyof Resources[T], options?: any) => string;

// Translation function type for multiple namespaces
export type MultiNamespaceTranslationFunction<T extends Namespace[]> = (
  key: T extends readonly [infer First, ...infer Rest]
    ? First extends Namespace
      ? Rest extends Namespace[]
        ? `${First}:${keyof Resources[First] & string}` | MultiNamespaceTranslationFunction<Rest>
        : `${First}:${keyof Resources[First] & string}`
      : never
    : never,
  options?: any
) => string;