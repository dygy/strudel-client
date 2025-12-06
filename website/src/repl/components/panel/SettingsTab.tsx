import { defaultSettings, settingsMap, useSettings } from '../../../settings';
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
    <label>
      <input disabled={disabled} type="checkbox" checked={value} onChange={onChange} />
      {' ' + label}
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
      className="p-2 bg-background rounded-md text-foreground  border-foreground"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {Object.entries(options).map(([k, label]) => (
        <option key={k} className="bg-background" value={k}>
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
  return (
    <div className="flex space-x-2 gap-1">
      <input
        className="p-2 grow"
        type="range"
        value={value}
        step={step}
        onChange={(e) => onChange(Number(e.target.value))}
        {...rest}
      />
      <input
        type="number"
        value={value}
        step={step}
        className="w-16 bg-background rounded-md"
        onChange={(e) => onChange(Number(e.target.value))}
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
    <div className="grid gap-2">
      {label && <label>{label}</label>}
      {children}
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
    <div className="text-foreground p-4 space-y-4 w-full" style={{ fontFamily }}>
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
        <div className="space-y-2">
          <Checkbox
            label={t('autosaveEnabled')}
            onChange={(cbEvent) => {
              settingsMap.setKey('isAutosaveEnabled', cbEvent.target.checked);
            }}
            value={isAutosaveEnabled}
          />
          {isAutosaveEnabled && (
            <div className="ml-6">
              <FormItem label={t('autosaveInterval')}>
                <NumberSlider
                  value={autosaveInterval / 1000} // Convert ms to seconds for UI
                  onChange={(seconds) => settingsMap.setKey('autosaveInterval', seconds * 1000)}
                  min={5}
                  max={300}
                  step={5}
                />
              </FormItem>
              <p className="text-xs text-gray-400 mt-1">{t('autosaveDescription')}</p>
            </div>
          )}
        </div>
      </FormItem>
      
      <FormItem label={t('theme')}>
        <SelectInput options={themeOptions} value={theme} onChange={(theme) => settingsMap.setKey('theme', theme)} />
      </FormItem>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 font-sans">
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
        ></ButtonGroup>
      </FormItem>
      <FormItem label={t('panelPosition')}>
        <ButtonGroup
          value={panelPosition}
          onChange={(value) => settingsMap.setKey('panelPosition', value)}
          items={{ bottom: t('bottom'), right: t('right') }}
        ></ButtonGroup>
      </FormItem>
      <FormItem label={t('openPanelOn')}>
        <ButtonGroup
          value={togglePanelTrigger}
          onChange={(value) => settingsMap.setKey('togglePanelTrigger', value)}
          items={{ click: t('click'), hover: t('hover') }}
        />
      </FormItem>
      <FormItem label={t('moreSettings')}>
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
      </FormItem>
      <FormItem label={t('zenMode')}>{tMessages('zenModeHint')}</FormItem>
      <FormItem label={t('resetSettings')}>
        <button
          className="bg-background p-2 max-w-[300px] rounded-md hover:opacity-50"
          onClick={() => {
            confirmDialog(tMessages('confirmReset')).then((r) => {
              if (r) {
                const { userPatterns } = settingsMap.get(); // keep current patterns
                settingsMap.set({ ...defaultSettings, userPatterns });
              }
            });
          }}
        >
          {t('restoreDefaults')}
        </button>
      </FormItem>
    </div>
  );
}