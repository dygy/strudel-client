import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from '@src/i18n';
import { 
  EQUALIZER_PRESETS, 
  saveEqualizerSettings, 
  loadEqualizerSettings, 
  getDefaultSettings,
  generateLogFrequencies,
  frequencyToX,
  gainToY,
  formatFrequency
} from '@strudel/equalizer';

interface EqualizerUIProps {
  mixer: any;
  previewEngine: any;
}

interface BandControl {
  frequency: number;
  gain: number;
  Q: number;
}

export function EqualizerUI({ mixer, previewEngine }: EqualizerUIProps) {
  const { t } = useTranslation('settings');
  const [isEnabled, setIsEnabled] = useState(true);
  const [bands, setBands] = useState<BandControl[]>([]);
  const [activePreset, setActivePreset] = useState('flat');
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const applySettingsToEqualizers = useCallback((settings: any) => {
    // Apply to live stream
    if (mixer?.liveStream?.equalizer) {
      mixer.liveStream.equalizer.setEnabled(settings.isEnabled);
      settings.bands.forEach((band: any, index: number) => {
        mixer.liveStream.equalizer.setBand(index, { gain: band.gain, Q: band.Q });
      });
    }
    
    // Apply to preview stream
    if (mixer?.previewStream?.equalizer) {
      mixer.previewStream.equalizer.setEnabled(settings.isEnabled);
      settings.bands.forEach((band: any, index: number) => {
        mixer.previewStream.equalizer.setBand(index, { gain: band.gain, Q: band.Q });
      });
    }
    
    // Apply to preview engine
    if (previewEngine?.equalizer) {
      previewEngine.equalizer.setEnabled(settings.isEnabled);
      settings.bands.forEach((band: any, index: number) => {
        previewEngine.equalizer.setBand(index, { gain: band.gain, Q: band.Q });
      });
    }
  }, [mixer, previewEngine]);

  // Load saved settings on mount
  useEffect(() => {
    const saved = loadEqualizerSettings();
    const settings = saved || getDefaultSettings();
    
    setIsEnabled(settings.isEnabled);
    setBands(settings.bands);
    setActivePreset(settings.preset);
    
    // Apply to equalizers
    applySettingsToEqualizers(settings);
  }, [mixer, previewEngine, applySettingsToEqualizers]);

  // Update frequency response chart when bands change
  useEffect(() => {
    updateFrequencyResponseChart();
  }, [bands, isEnabled]);

  const updateFrequencyResponseChart = () => {
    if (!canvasRef.current) return;
    
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;

    // Clear canvas
    ctx.clearRect(0, 0, width, height);

    // Draw grid
    drawGrid(ctx, width, height);

    // Draw frequency response curve
    if (isEnabled) {
      drawFrequencyResponse(ctx, width, height);
    }

    // Draw band markers
    drawBandMarkers(ctx, width, height);
  };

  const drawGrid = (ctx: CanvasRenderingContext2D, width: number, height: number) => {
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.lineWidth = 1;

    // Frequency lines (logarithmic)
    const frequencies = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000];
    frequencies.forEach(freq => {
      const x = frequencyToX(freq, width);
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
      
      // Label
      ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
      ctx.font = '10px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(formatFrequency(freq), x, height - 5);
    });

    // Gain lines
    const gains = [-12, -6, 0, 6, 12];
    gains.forEach(gain => {
      const y = gainToY(gain, height);
      ctx.strokeStyle = gain === 0 ? 'rgba(255, 255, 255, 0.3)' : 'rgba(255, 255, 255, 0.1)';
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
      
      // Label
      ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
      ctx.font = '10px sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(`${gain > 0 ? '+' : ''}${gain}dB`, 5, y - 5);
    });
  };

  const drawFrequencyResponse = (ctx: CanvasRenderingContext2D, width: number, height: number) => {
    const numPoints = 200;
    const frequencies = generateLogFrequencies(20, 20000, numPoints);
    
    // Calculate response for each frequency
    const response = new Float32Array(numPoints);
    for (let i = 0; i < numPoints; i++) {
      response[i] = calculateResponseAtFrequency(frequencies[i]);
    }

    // Draw the curve
    ctx.strokeStyle = '#1db954'; // Spotify green
    ctx.lineWidth = 3;
    ctx.beginPath();

    for (let i = 0; i < numPoints; i++) {
      const x = frequencyToX(frequencies[i], width);
      const y = gainToY(response[i], height);
      
      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    }

    ctx.stroke();

    // Add glow effect
    ctx.shadowBlur = 10;
    ctx.shadowColor = '#1db954';
    ctx.stroke();
    ctx.shadowBlur = 0;
  };

  const calculateResponseAtFrequency = (freq: number): number => {
    // Simple approximation of biquad filter response
    let totalGain = 0;
    
    bands.forEach(band => {
      const ratio = freq / band.frequency;
      const logRatio = Math.log2(ratio);
      const bandwidth = 1 / band.Q;
      
      // Gaussian-like response for peaking filters
      if (band.frequency === 31) {
        // Low shelf
        totalGain += freq < band.frequency ? band.gain : band.gain * Math.exp(-Math.pow(logRatio / bandwidth, 2));
      } else if (band.frequency === 16000) {
        // High shelf
        totalGain += freq > band.frequency ? band.gain : band.gain * Math.exp(-Math.pow(logRatio / bandwidth, 2));
      } else {
        // Peaking
        totalGain += band.gain * Math.exp(-Math.pow(logRatio / bandwidth, 2));
      }
    });
    
    return totalGain;
  };

  const drawBandMarkers = (ctx: CanvasRenderingContext2D, width: number, height: number) => {
    bands.forEach(band => {
      const x = frequencyToX(band.frequency, width);
      const y = gainToY(band.gain, height);
      
      // Draw marker
      ctx.fillStyle = band.gain === 0 ? 'rgba(255, 255, 255, 0.3)' : '#1db954';
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fill();
      
      // Draw line from zero to current gain
      const zeroY = gainToY(0, height);
      ctx.strokeStyle = 'rgba(29, 185, 84, 0.3)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, zeroY);
      ctx.lineTo(x, y);
      ctx.stroke();
    });
  };

  const handleEnableToggle = () => {
    const newEnabled = !isEnabled;
    setIsEnabled(newEnabled);
    
    // Apply to all equalizers
    mixer?.liveStream?.equalizer?.setEnabled(newEnabled);
    mixer?.previewStream?.equalizer?.setEnabled(newEnabled);
    previewEngine?.equalizer?.setEnabled(newEnabled);
    
    saveEqualizerSettings({ isEnabled: newEnabled, bands, preset: activePreset });
  };

  const handleBandChange = (index: number, gain: number) => {
    const newBands = [...bands];
    newBands[index] = { ...newBands[index], gain };
    setBands(newBands);
    
    // Apply to all equalizers
    mixer?.liveStream?.equalizer?.setBand(index, { gain });
    mixer?.previewStream?.equalizer?.setBand(index, { gain });
    previewEngine?.equalizer?.setBand(index, { gain });
    
    setActivePreset('custom');
    saveEqualizerSettings({ isEnabled, bands: newBands, preset: 'custom' });
  };

  const handlePresetChange = (presetName: string) => {
    const preset = EQUALIZER_PRESETS[presetName];
    if (!preset) return;
    
    const newBands = bands.map((band, i) => ({
      ...band,
      gain: preset.gains[i]
    }));
    
    setBands(newBands);
    setActivePreset(presetName);
    
    // Apply to all equalizers
    mixer?.liveStream?.equalizer?.applyPreset(presetName);
    mixer?.previewStream?.equalizer?.applyPreset(presetName);
    previewEngine?.equalizer?.applyPreset(presetName);
    
    saveEqualizerSettings({ isEnabled, bands: newBands, preset: presetName });
  };

  const handleReset = () => {
    if (confirm(t('equalizerResetConfirm'))) {
      handlePresetChange('flat');
    }
  };

  if (!mixer && !previewEngine) {
    return (
      <div className="p-4 bg-lineHighlight rounded-lg">
        <div className="flex items-center gap-2 text-foreground opacity-70">
          <span className="text-sm">{t('equalizerNotAvailable')}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header with enable/disable toggle */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-medium text-foreground">{t('equalizer')}</h3>
          <p className="text-xs text-gray-500 mt-0.5">{t('equalizerSubtitle')}</p>
        </div>
        <button
          onClick={handleEnableToggle}
          className={`px-4 py-2 rounded-lg font-medium transition-all duration-200 flex items-center gap-2 ${
            isEnabled
              ? 'bg-green-600 text-white hover:bg-green-700 shadow-lg shadow-green-500/30'
              : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
          }`}
        >
          <div className={`w-2 h-2 rounded-full ${isEnabled ? 'bg-white' : 'bg-gray-500'}`}></div>
          {isEnabled ? t('equalizerEnabled') : t('equalizerDisabled')}
        </button>
      </div>

      {/* Preset selector */}
      <div>
        <label className="block text-sm font-medium text-foreground mb-2">
          {t('equalizerPreset')}
        </label>
        <div className="relative">
          <select
            className="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-green-500 transition-all duration-200 cursor-pointer hover:border-gray-600"
            value={activePreset}
            onChange={(e) => handlePresetChange(e.target.value)}
          >
            {Object.keys(EQUALIZER_PRESETS).map((key) => {
              // Convert preset key to translation key (e.g., 'flat' -> 'equalizerPresetFlat')
              const translationKey = `equalizerPreset${key.charAt(0).toUpperCase()}${key.slice(1)}`;
              return (
                <option key={key} value={key} className="bg-gray-800">
                  {t(translationKey)}
                </option>
              );
            })}
            {activePreset === 'custom' && (
              <option value="custom" className="bg-gray-800">{t('equalizerCustom')}</option>
            )}
          </select>
          <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-gray-500">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </div>
        </div>
        {activePreset === 'custom' && (
          <div className="mt-2 text-xs text-green-400 flex items-center gap-1">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            {t('equalizerCustomActive')}
          </div>
        )}
      </div>

      {/* Frequency Response Chart */}
      <div className="bg-gray-900 border border-gray-700 rounded-lg p-4 hover:border-gray-600 transition-colors">
        <div className="flex items-center justify-between mb-3">
          <label className="text-sm font-medium text-foreground">
            {t('equalizerFrequencyResponse')}
          </label>
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <div className="flex items-center gap-1">
              <div className="w-3 h-0.5 bg-green-500"></div>
              <span>{t('equalizerEQCurve')}</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-2 h-2 rounded-full bg-green-400"></div>
              <span>{t('equalizerBands')}</span>
            </div>
          </div>
        </div>
        <canvas
          ref={canvasRef}
          width={600}
          height={200}
          className="w-full h-auto bg-black rounded border border-gray-800"
        />
      </div>

      {/* Band controls */}
      <div className="space-y-3">
        <label className="block text-sm font-medium text-foreground">
          {t('equalizerFrequencyBands')}
        </label>
        <div className="grid grid-cols-5 sm:grid-cols-10 gap-2">
          {bands.map((band, index) => (
            <div 
              key={index} 
              className="flex flex-col items-center group relative"
              title={`${band.frequency}Hz: ${band.gain > 0 ? '+' : ''}${band.gain.toFixed(1)}dB`}
            >
              {/* Frequency label */}
              <div className="text-xs text-foreground opacity-70 mb-2 font-mono">
                {band.frequency >= 1000 
                  ? `${(band.frequency / 1000).toFixed(band.frequency === 1000 ? 0 : 1)}k` 
                  : `${band.frequency}`}
              </div>
              
              {/* Vertical slider container with visual feedback */}
              <div className="relative h-32 w-8 bg-gray-800 rounded-lg overflow-hidden border border-gray-700 group-hover:border-green-500 transition-colors">
                {/* Zero line indicator */}
                <div 
                  className="absolute left-0 right-0 h-0.5 bg-gray-600 z-10"
                  style={{ top: '50%' }}
                />
                
                {/* Gain level indicator */}
                <div 
                  className={`absolute left-0 right-0 transition-all duration-150 ${
                    band.gain > 0 
                      ? 'bg-gradient-to-t from-green-500/50 to-green-400/30' 
                      : band.gain < 0
                      ? 'bg-gradient-to-b from-red-500/50 to-red-400/30'
                      : ''
                  }`}
                  style={{
                    top: band.gain > 0 ? `${50 - (band.gain / 12) * 50}%` : '50%',
                    bottom: band.gain < 0 ? `${50 - (Math.abs(band.gain) / 12) * 50}%` : '50%',
                  }}
                />
                
                {/* Slider input */}
                <input
                  type="range"
                  min="-12"
                  max="12"
                  step="0.5"
                  value={band.gain}
                  onChange={(e) => handleBandChange(index, parseFloat(e.target.value))}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-20"
                  style={{
                    WebkitAppearance: 'slider-vertical' as any,
                  }}
                />
                
                {/* Gain value indicator dot */}
                <div 
                  className={`absolute left-1/2 -translate-x-1/2 w-3 h-3 rounded-full z-30 transition-all duration-150 ${
                    band.gain === 0 
                      ? 'bg-gray-400' 
                      : 'bg-green-400 shadow-lg shadow-green-500/50'
                  }`}
                  style={{
                    top: `${50 - (band.gain / 12) * 50}%`,
                    transform: 'translate(-50%, -50%)',
                  }}
                />
              </div>
              
              {/* Gain value display */}
              <div className={`text-xs font-mono font-medium mt-2 transition-colors ${
                band.gain === 0 
                  ? 'text-gray-500' 
                  : band.gain > 0 
                  ? 'text-green-400' 
                  : 'text-red-400'
              }`}>
                {band.gain > 0 ? '+' : ''}{band.gain.toFixed(1)}
              </div>
            </div>
          ))}
        </div>
        
        {/* Info text */}
        <div className="text-xs text-foreground opacity-50 text-center mt-2">
          {t('equalizerDragSliders')} • {t('equalizerRange')}
        </div>
      </div>

      {/* Reset button */}
      <button
        onClick={handleReset}
        className="w-full px-4 py-2.5 bg-gray-800 border border-gray-700 rounded-lg text-foreground hover:bg-gray-700 hover:border-gray-600 transition-all duration-200 flex items-center justify-center gap-2 group"
      >
        <svg className="w-4 h-4 group-hover:rotate-180 transition-transform duration-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
        </svg>
        {t('equalizerResetToFlat')}
      </button>
    </div>
  );
}
