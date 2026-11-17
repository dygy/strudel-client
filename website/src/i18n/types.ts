// Type definitions for i18n resources
export interface CommonTranslations {
  close: string;
  closePanel: string;
  openPanel: string;
  pinPanel: string;
  menuPanel: string;
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
  // Compact (phone/tablet) layout, spec 016
  more: string;
  library: string;
  openLibrary: string;
  closeLibrary: string;
  settings: string;
  recordAudio: string;
  recordScreen: string;
  stopRecording: string;
  share: string;
  preview: string;
  playPreview: string;
  stopPreview: string;
  /** "Band {{n}}" */
  eqBand: string;
  gain: string;
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
  trackCreated: string;
  trackCreatedAndSaved: string;
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
  exportLibraryAsZip: string;
  importLibraryFromZip: string;
  libraryExported: string;
  libraryImported: string;
  invalidLibraryFile: string;
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
  noTracksToExport: string;
  activeStep: string;
  newMultitrack: string;
  multitrackCreated: string;
  stepRenamed: string;
  multitrackImported: string;
  invalidMultitrackFile: string;
  noValidStepsFound: string;
  multitrackImportFailed: string;
  invalidZipFile: string;
  deleteAllTracks: string;
  confirmDeleteAllTracks: string;
  deleteAllTracksWarning: string;
  deleteAllFoldersWarning: string;
  deleteAllTracksAndFoldersWarning: string;
  allTracksDeleted: string;
  allFoldersDeleted: string;
  allTracksAndFoldersDeleted: string;
  loadingTracks: string;
  loadingTracksDescription: string;

  // Nested objects for better organization
  errors: {
    loadFailed: string;
    createTrackFailed: string;
    createFolderFailed: string;
    deleteFailed: string;
    moveFailed: string;
    importFailed: string;
    exportFailed: string;
    saveFailed: string;
    renameFailed: string;
  };

  success: {
    folderCreated: string;
    itemMoved: string;
    itemDeleted: string;
  };
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
  // Track transitions (spec 017)
  smoothTransitionFailed: string;
  transition: string;
  transitionTypeOff: string;
  transitionTypeDip: string;
  transitionTypeCut: string;
  transitionTypeCrossfade: string;
  transitionTypeFilterSweep: string;
  transitionTypeBassSwap: string;
  transitionTypeEchoOut: string;
  transitionTypeLayeredIntro: string;
  transitionDescOff: string;
  transitionDescDip: string;
  transitionDescCut: string;
  transitionDescCrossfade: string;
  transitionDescFilterSweep: string;
  transitionDescBassSwap: string;
  transitionDescEchoOut: string;
  transitionDescLayeredIntro: string;
  transitionLength: string;
  transitionSnap: string;
  transitionSnapOff: string;
  transitionSnapNext1: string;
  transitionSnapNext4: string;
  transitionSnapNext8: string;
  // Tempo and phrase sync (spec 027)
  transitionSnapNext16: string;
  transitionSnapDescription: string;
  transitionTempo: string;
  transitionTempoJump: string;
  transitionTempoGlide: string;
  transitionTempoMatch: string;
  transitionTempoKeep: string;
  transitionTempoJumpDescription: string;
  transitionTempoGlideDescription: string;
  transitionTempoMatchDescription: string;
  transitionTempoKeepDescription: string;
  transitionMatchLoudness: string;
  transitionMatchLoudnessDescription: string;
  transitionPicker: string;
  transitionPickerLength: string;
  transitionWaiting: string;
  transitionNewTrackFailed: string;
  // Vinyl scratch control (spec 019)
  scratch: string;
  scratchDescription: string;
  scratchPlatter: string;
  scratchDeck: string;
  scratchDeckMain: string;
  scratchDeckPreview: string;
  scratchPreviewOff: string;
  scratchNotPlaying: string;
  scratchUnavailable: string;
  scratchShortcutHint: string;
  scratchShortcutWindowsNote: string;
  scratchOpen: string;
  scratchMidi: string;
  scratchMidiLearn: string;
  scratchMidiLearning: string;
  scratchMidiForget: string;
  scratchMidiNone: string;
  scratchMidiAssigned: string;
  scratchMidiLearnTimeout: string;
  scratchMidiUnsupported: string;
  scratchMidiDenied: string;
  scratchMidiError: string;
  // Snap grid and feel (spec 025)
  scratchSnap: string;
  scratchSnapHint: string;
  scratchSnapOff: string;
  scratchSnapHalf: string;
  scratchSnapBeat: string;
  scratchSnapBar: string;
  scratchBrake: string;
  scratchSpinUp: string;
  scratchFeelReset: string;
  scratchFeelHint: string;
  // Spec 029: MIDI Learn for the Brake and Spin-up sliders
  scratchFeelLearn: string;
  scratchFeelLearning: string;
  scratchFeelForget: string;
  scratchFeelLearnTimeout: string;
  scratchFeelLearnConflict: string;
  scratchMidiLearnConflict: string;
  // Spec 030: the performance view
  performMode: string;
  performModeDescription: string;
  performExit: string;
  performSetTime: string;
  performTrackTime: string;
  performResetClock: string;
  performLevel: string;
  performClip: string;
  performBiggerCode: string;
  performSmallerCode: string;
  // Spec 031: MIDI mapping, volumes and the crossfader
  midiTitle: string;
  midiDescription: string;
  midiStatusUnsupported: string;
  midiStatusIdle: string;
  midiStatusDenied: string;
  midiStatusFailed: string;
  midiStatusReady: string;
  midiStatusNoInputs: string;
  midiGroupEq: string;
  midiGroupMixer: string;
  midiGroupSet: string;
  midiGroupTransport: string;
  midiGroupTransition: string;
  midiGroupView: string;
  midiGroupScratch: string;
  midiTargetBand: string;
  midiTargetEqToggle: string;
  midiTargetEqAb: string;
  midiTargetSpeakers: string;
  midiTargetHeadphones: string;
  midiTargetCrossfader: string;
  midiTargetCueGo: string;
  midiTargetPlayStop: string;
  midiTargetUpdate: string;
  midiTargetNextType: string;
  midiTargetPrevType: string;
  midiTargetPerformance: string;
  midiTargetJog: string;
  midiTargetBrake: string;
  midiTargetSpinUp: string;
  // Spec 032: Master FX (MIDI rows)
  midiGroupMasterFx: string;
  midiTargetMasterFilter: string;
  midiTargetMasterDelay: string;
  midiTargetMasterReverb: string;
  midiTargetMasterRepeat: string;
  midiTargetMasterBrake: string;
  midiTargetMasterRepeatLength: string;
  // Spec 032: the Master FX panel and the performance row
  masterFx: {
    title: string;
    description: string;
    filter: string;
    filterOff: string;
    filterLowPass: string;
    filterHighPass: string;
    filterLp: string;
    filterHp: string;
    filterHint: string;
    resonance: string;
    delay: string;
    delayTime: string;
    delayFeedback: string;
    level: string;
    reverb: string;
    reverbDecay: string;
    repeat: string;
    repeatLength: string;
    brake: string;
    brakeNote: string;
    brakeLink: string;
    holdHint: string;
    holdLabel: string;
    allOff: string;
    cycle: string;
    seconds: string;
  };
  midiBindingCc: string;
  midiBindingNote: string;
  midiLearn: string;
  midiLearning: string;
  midiClear: string;
  midiClearAll: string;
  midiClearAllConfirm: string;
  midiClearAllYes: string;
  midiCancel: string;
  midiExport: string;
  midiImport: string;
  midiImported: string;
  midiImportErrorNotJson: string;
  midiImportErrorNotMap: string;
  midiImportErrorVersion: string;
  midiImportErrorBinding: string;
  midiImportErrorDuplicate: string;
  midiImportErrorConflict: string;
  midiImportErrorRead: string;
  midiPickup: string;
  midiTimedOut: string;
  midiCancelled: string;
  midiConflict: string;
  mixerLevels: string;
  mixerCrossfaderSideA: string;
  mixerCrossfaderSideB: string;
  mixerCrossfaderPlaying: string;
  mixerCrossfaderMixing: string;
  mixerCrossfaderNothingCued: string;
  mixerCrossfaderReturn: string;
  mixerCrossfaderHint: string;
  /** Spec 031 review #7: a jog or feel Learn refused, naming who holds the control. */
  scratchMidiConflictHolder: string;
  // Spec 033: the EQ's Before EQ spectrum layer
  eqSpectrumPre: string;
  eqSpectrumPreHint: string;
  // Spec 033: the loudness meter (Settings → Meter, the header and performance strips)
  meter: {
    title: string;
    description: string;
    on: string;
    offNote: string;
    momentary: string;
    shortTerm: string;
    integrated: string;
    truePeak: string;
    range: string;
    peakRms: string;
    history: string;
    historyLabel: string;
    target: string;
    targetStreaming: string;
    targetBroadcast: string;
    targetClub: string;
    targetOff: string;
    warnings: string;
    warningLight: string;
    warningNone: string;
    warningTitle: string;
    reasonCount: string;
    reasonTruePeak: string;
    reasonLimiter: string;
    reasonClip: string;
    reset: string;
    resetHint: string;
    open: string;
    strip: string;
  };
}

export interface TabsTranslations {
  welcome: string;
  files: string;
  patterns: string;
  sounds: string;
  reference: string;
  shortcuts: string;
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

export interface AuthTranslations {
  signInWithGoogle: string;
  signOut: string;
  signingIn: string;
  welcome: string;
  signInRequired: string;
  signInDescription: string;
  trackAccess: {
    title: string;
    description: string;
    redirectMessage: string;
  };
  login: {
    title: string;
    welcomeTitle: string;
    welcomeSubtitle: string;
    errorPrefix: string;
    errorSuffix: string;
    trackAccessDescription: string;
    signInDescription: string;
    signInButton: string;
    signInFooter: string;
  };
  profile: {
    title: string;
    email: string;
    name: string;
    joinedDate: string;
    trackCount: string;
    folderCount: string;
  };
  errors: {
    signInFailed: string;
    signOutFailed: string;
    notAuthenticated: string;
    sessionExpired: string;
    networkError: string;
    databaseSetupRequired: string;
    databaseSetupInstructions: string;
  };
}

export interface ShortcutsTranslations {
  title: string;
  description: string;
  sections: {
    essential: string;
    file: string;
    editor: string;
  };
  evaluate: string;
  update: string;
  playPause: string;
  save: string;
  comment: string;
  scratch: string;
  tip: {
    title: string;
    description: string;
  };
  keybindings: {
    title: string;
    description: string;
  };
  platform: {
    mac: string;
  };
}

export interface Resources {
  common: CommonTranslations;
  files: FilesTranslations;
  settings: SettingsTranslations;
  tabs: TabsTranslations;
  messages: MessagesTranslations;
  welcome: WelcomeTranslations;
  auth: AuthTranslations;
  shortcuts: ShortcutsTranslations;
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
  options?: any,
) => string;
