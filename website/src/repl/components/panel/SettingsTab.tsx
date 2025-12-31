import { defaultSettings, settingsMap, useSettings } from '@src/settings';
import { themes } from '@strudel/codemirror';
import { Textbox } from '../textbox/Textbox';
import { isUdels, confirmDialog } from '../../util';
import { ButtonGroup } from './Forms';
import { AudioDeviceSelector } from './AudioDeviceSelector';
import { AudioEngineTargetSelector } from './AudioEngineTargetSelector';
import { LanguageSelector } from './LanguageSelector';
import { DEFAULT_MAX_POLYPHONY, setMaxPolyphony, setMultiChannelOrbits } from '@strudel/webaudio';
import { useTranslation } from '@src/i18n';

interface CheckboxProps {
  label: string;
  value: boolean;
  onChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  disabled?: boolean;
}

function Checkbox({ label, value, onChange, disabled = false }: CheckboxProps) {
  return (
    <label className="flex items-center gap-3 cursor-pointer group">
      <div className="relative">
        <input
          disabled={disabled}
          type="checkbox"
          checked={value}
          onChange={onChange}
          className="sr-only"
        />
        <div className={`w-5 h-5 rounded-md border-2 transition-all duration-200 flex items-center justify-center ${
          value 
            ? 'bg-foreground border-foreground' 
            : 'border-lineHighlight bg-transparent hover:border-foreground'
        } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}>
          {value && (
            <svg className="w-3 h-3 text-background" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
            </svg>
          )}
        </div>
      </div>
      <span className={`text-sm font-medium transition-colors ${disabled ? 'text-foreground opacity-50' : 'text-foreground group-hover:text-foreground'}`}>
        {label}
      </span>
    </label>
  );
}

interface SelectInputProps {
  value: string;
  options: Record<string, string>;
  onChange: (value: string) => void;
}

function SelectInput({ value, options, onChange }: SelectInputProps) {
  return (
    <select
      className="w-full px-4 py-3 bg-background border border-lineHighlight rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-foreground focus:border-transparent transition-all duration-200 appearance-none cursor-pointer"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {Object.entries(options).map(([k, label]) => (
        <option key={k} className="bg-background text-foreground" value={k}>
          {label}
        </option>
      ))}
    </select>
  );
}

interface NumberSliderProps {
  value: number;
  onChange: (value: number) => void;
  step?: number;
  min?: number;
  max?: number;
  [key: string]: any;
}

function NumberSlider({ value, onChange, step = 1, ...rest }: NumberSliderProps) {
  const min = rest.min || 0;
  const max = rest.max || 100;

  const handleNumberChange = (newValue: number) => {
    // Ensure the value is within bounds
    const clampedValue = Math.max(min, Math.min(max, newValue));
    onChange(clampedValue);
  };

  return (
    <div className="flex items-center gap-4">
      <div className="flex-1 relative">
        <input
          className="w-full h-2 bg-lineHighlight rounded-lg appearance-none cursor-pointer"
          type="range"
          value={value}
          step={step}
          min={min}
          max={max}
          onChange={(e) => handleNumberChange(Number(e.target.value))}
        />
      </div>
      <input
        type="number"
        value={value}
        step={step}
        min={min}
        max={max}
        className="w-16 px-2 py-1 bg-background border border-lineHighlight rounded-md text-foreground text-center text-sm focus:outline-none focus:ring-2 focus:ring-foreground focus:border-transparent transition-all duration-200"
        onChange={(e) => handleNumberChange(Number(e.target.value))}
      />
    </div>
  );
}

interface FormItemProps {
  label?: string;
  children: React.ReactNode;
  sublabel?: string;
}

function FormItem({ label, children, sublabel }: FormItemProps) {
  return (
    <div className="bg-background bg-opacity-40 backdrop-blur-sm rounded-xl p-6 border border-lineHighlight border-opacity-20 hover:border-opacity-40 transition-all duration-300 shadow-sm hover:shadow-md">
      {label && (
        <label className="block text-base font-semibold text-foreground mb-4">
          {label}
        </label>
      )}
      <div className="space-y-3">
        {children}
      </div>
      {sublabel && (
        <p className="text-sm text-foreground opacity-60 mt-3 leading-relaxed">
          {sublabel}
        </p>
      )}
    </div>
  );
}

const themeOptions = Object.fromEntries(Object.keys(themes).map((k) => [k, k]));
const fontFamilyOptions = {
  monospace: 'monospace',
  Courier: 'Courier',
  CutiePi: 'CutiePi',
  JetBrains: 'JetBrains',
  Hack: 'Hack',
  FiraCode: 'FiraCode',
  'FiraCode-SemiBold': 'FiraCode SemiBold',
  teletext: 'teletext',
  tic80: 'tic80',
  mode7: 'mode7',
  BigBlueTerminal: 'BigBlueTerminal',
  x3270: 'x3270',
  Monocraft: 'Monocraft',
  PressStart: 'PressStart2P',
  'we-come-in-peace': 'we-come-in-peace',
  galactico: 'galactico',
};

interface SettingsTabProps {
  started: boolean;
}

export function SettingsTab({ started }: SettingsTabProps) {
  const { t } = useTranslation('settings');
  const { t: tMessages } = useTranslation('messages');
  const {
    theme,
    keybindings,
    isBracketClosingEnabled,
    isBracketMatchingEnabled,
    isLineNumbersDisplayed,
    isPatternHighlightingEnabled,
    isActiveLineHighlighted,
    isAutoCompletionEnabled,
    isTooltipEnabled,
    isSignatureHelpEnabled,
    isLinterEnabled,
    isFlashEnabled,
    isButtonRowHidden,
    isCSSAnimationDisabled,
    isSyncEnabled,
    isLineWrappingEnabled,
    fontSize,
    fontFamily,
    panelPosition,
    audioDeviceName,
    audioEngineTarget,
    togglePanelTrigger,
    maxPolyphony,
    multiChannelOrbits,
    isTabIndentationEnabled,
    isMultiCursorEnabled,
    language,
    isAutosaveEnabled,
    autosaveInterval,
  } = useSettings();
  const shouldAlwaysSync = isUdels();
  const canChangeAudioDevice = 'setSinkId' in AudioContext.prototype;

  const handleReloadConfirm = (callback: () => void) => {
    confirmDialog(tMessages('reloadRequired')).then((r) => {
      if (r == true) {
        callback();
        return window.location.reload();
      }
    });
  };

  return (
    <div className="h-full overflow-y-auto bg-background bg-opacity-30">
      <div className="max-w-4xl mx-auto p-6 space-y-6" style={{ fontFamily }}>
        <div className="text-center mb-8 py-6">
          <h1 className="text-3xl font-bold text-foreground mb-3 tracking-tight">{t('settingsTitle')}</h1>
          <p className="text-foreground opacity-70 text-lg">{t('settingsSubtitle')}</p>
        </div>

        <FormItem label={t('language')}>
          <LanguageSelector
            currentLanguage={language}
            onChange={(newLanguage) => settingsMap.setKey('language', newLanguage)}
          />
        </FormItem>

        {canChangeAudioDevice && (
          <FormItem label={t('audioOutput')}>
            <AudioDeviceSelector
              isDisabled={started}
              audioDeviceName={audioDeviceName}
              onChange={(audioDeviceName) => {
                handleReloadConfirm(() => settingsMap.setKey('audioDeviceName', audioDeviceName));
              }}
            />
          </FormItem>
        )}

        <FormItem label={t('audioEngine')}>
          <AudioEngineTargetSelector
            target={audioEngineTarget}
            onChange={(target) => {
              handleReloadConfirm(() => settingsMap.setKey('audioEngineTarget', target));
            }}
          />
        </FormItem>

        <FormItem label={t('maxPolyphony')}>
          <Textbox
            min={1}
            max={Infinity}
            onBlur={(e) => {
              let v = parseInt(e.target.value);
              v = isNaN(v) ? DEFAULT_MAX_POLYPHONY : v;
              setMaxPolyphony(v);
              settingsMap.setKey('maxPolyphony', v);
            }}
            onChange={(v) => {
              v = String(Math.max(1, parseInt(v)));
              settingsMap.setKey('maxPolyphony', isNaN(Number(v)) ? undefined : v);
            }}
            type="number"
            placeholder=""
            value={maxPolyphony ?? ''}
          />
        </FormItem>

        <FormItem>
          <Checkbox
            label={t('multiChannelOrbits')}
            onChange={(cbEvent) => {
              const val = cbEvent.target.checked;
              handleReloadConfirm(() => {
                settingsMap.setKey('multiChannelOrbits', val);
                setMultiChannelOrbits(val);
              });
            }}
            value={multiChannelOrbits}
          />
        </FormItem>

        <FormItem label={t('autosave')}>
          <div className="space-y-4">
            <Checkbox
              label={t('autosaveEnabled')}
              onChange={(cbEvent) => {
                settingsMap.setKey('isAutosaveEnabled', cbEvent.target.checked);
              }}
              value={isAutosaveEnabled}
            />
            {isAutosaveEnabled && (
              <div className="space-y-3 bg-opacity-20 rounded-lg">
                <div>
                  <label className="block text-sm font-medium text-foreground mb-2">
                    {t('autosaveInterval')}
                  </label>
                  <NumberSlider
                    value={autosaveInterval / 1000}
                    onChange={(seconds) => settingsMap.setKey('autosaveInterval', seconds * 1000)}
                    min={5}
                    max={300}
                    step={5}
                  />
                </div>
                <p className="text-xs text-foreground opacity-60">{t('autosaveDescription')}</p>
              </div>
            )}
          </div>
        </FormItem>

        <FormItem label={t('theme')}>
          <SelectInput options={themeOptions} value={theme} onChange={(theme) => settingsMap.setKey('theme', theme)} />
        </FormItem>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <FormItem label={t('fontFamily')}>
            <SelectInput
              options={fontFamilyOptions}
              value={fontFamily}
              onChange={(fontFamily) => settingsMap.setKey('fontFamily', fontFamily)}
            />
          </FormItem>
          <FormItem label={t('fontSize')}>
            <NumberSlider
              value={fontSize}
              onChange={(fontSize) => settingsMap.setKey('fontSize', fontSize)}
              min={10}
              max={40}
              step={2}
            />
          </FormItem>
        </div>

        <FormItem label={t('keybindings')}>
          <ButtonGroup
            value={keybindings}
            onChange={(keybindings) => settingsMap.setKey('keybindings', keybindings)}
            items={{ codemirror: 'Codemirror', vim: 'Vim', emacs: 'Emacs', vscode: 'VSCode' }}
          />
        </FormItem>

        <FormItem label={t('panelPosition')}>
          <ButtonGroup
            value={panelPosition}
            onChange={(value) => settingsMap.setKey('panelPosition', value)}
            items={{ bottom: t('bottom'), right: t('right') }}
          />
        </FormItem>

        <FormItem label={t('openPanelOn')}>
          <ButtonGroup
            value={togglePanelTrigger}
            onChange={(value) => settingsMap.setKey('togglePanelTrigger', value)}
            items={{ click: t('click'), hover: t('hover') }}
          />
        </FormItem>

        <FormItem label={t('moreSettings')}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Checkbox
              label={t('bracketMatching')}
              onChange={(cbEvent) => settingsMap.setKey('isBracketMatchingEnabled', cbEvent.target.checked)}
              value={isBracketMatchingEnabled}
            />
            <Checkbox
              label={t('autoCloseBrackets')}
              onChange={(cbEvent) => settingsMap.setKey('isBracketClosingEnabled', cbEvent.target.checked)}
              value={isBracketClosingEnabled}
            />
            <Checkbox
              label={t('lineNumbers')}
              onChange={(cbEvent) => settingsMap.setKey('isLineNumbersDisplayed', cbEvent.target.checked)}
              value={isLineNumbersDisplayed}
            />
            <Checkbox
              label={t('highlightActiveLine')}
              onChange={(cbEvent) => settingsMap.setKey('isActiveLineHighlighted', cbEvent.target.checked)}
              value={isActiveLineHighlighted}
            />
            <Checkbox
              label={t('highlightEvents')}
              onChange={(cbEvent) => settingsMap.setKey('isPatternHighlightingEnabled', cbEvent.target.checked)}
              value={isPatternHighlightingEnabled}
            />
            <Checkbox
              label={t('autoCompletion')}
              onChange={(cbEvent) => settingsMap.setKey('isAutoCompletionEnabled', cbEvent.target.checked)}
              value={isAutoCompletionEnabled}
            />
            <Checkbox
              label={t('tooltips')}
              onChange={(cbEvent) => settingsMap.setKey('isTooltipEnabled', cbEvent.target.checked)}
              value={isTooltipEnabled}
            />
            <Checkbox
              label={t('signatureHelp')}
              onChange={(cbEvent) => settingsMap.setKey('isSignatureHelpEnabled', cbEvent.target.checked)}
              value={isSignatureHelpEnabled}
            />
            <Checkbox
              label={t('errorHighlighting')}
              onChange={(cbEvent) => settingsMap.setKey('isLinterEnabled', cbEvent.target.checked)}
              value={isLinterEnabled}
            />
            <Checkbox
              label={t('lineWrapping')}
              onChange={(cbEvent) => settingsMap.setKey('isLineWrappingEnabled', cbEvent.target.checked)}
              value={isLineWrappingEnabled}
            />
            <Checkbox
              label={t('tabIndentation')}
              onChange={(cbEvent) => settingsMap.setKey('isTabIndentationEnabled', cbEvent.target.checked)}
              value={isTabIndentationEnabled}
            />
            <Checkbox
              label={t('multiCursor')}
              onChange={(cbEvent) => settingsMap.setKey('isMultiCursorEnabled', cbEvent.target.checked)}
              value={isMultiCursorEnabled}
            />
            <Checkbox
              label={t('flashOnEval')}
              onChange={(cbEvent) => settingsMap.setKey('isFlashEnabled', cbEvent.target.checked)}
              value={isFlashEnabled}
            />
            <Checkbox
              label={t('syncTabs')}
              onChange={(cbEvent) => {
                const newVal = cbEvent.target.checked;
                handleReloadConfirm(() => settingsMap.setKey('isSyncEnabled', newVal));
              }}
              disabled={shouldAlwaysSync}
              value={isSyncEnabled}
            />
            <Checkbox
              label={t('hideButtons')}
              onChange={(cbEvent) => settingsMap.setKey('isButtonRowHidden', cbEvent.target.checked)}
              value={isButtonRowHidden}
            />
            <Checkbox
              label={t('disableAnimations')}
              onChange={(cbEvent) => settingsMap.setKey('isCSSAnimationDisabled', cbEvent.target.checked)}
              value={isCSSAnimationDisabled}
            />
          </div>
        </FormItem>

        <FormItem label={t('zenMode')}>
          <p className="text-foreground opacity-70 leading-relaxed">{tMessages('zenModeHint')}</p>
        </FormItem>

        <FormItem label={t('resetSettings')}>
          <button
            className="px-6 py-3 bg-lineHighlight hover:bg-foreground hover:text-background text-foreground rounded-lg transition-all duration-200 font-medium shadow-sm hover:shadow-md"
            onClick={() => {
              confirmDialog(tMessages('confirmReset')).then((r) => {
                if (r) {
                  const { userPatterns } = settingsMap.get();
                  settingsMap.set({ ...defaultSettings, userPatterns });
                }
              });
            }}
          >
            {t('restoreDefaults')}
          </button>
        </FormItem>
      </div>
    </div>
  );
}
