/**
 * ExportDialog — modal shown after a recording session ends, allowing
 * the user to choose WAV or MP3 format and download the recording.
 *
 * Requirements: 4.1, 4.2, 4.3, 5.1, 5.2, 5.3, 5.4
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Modal } from './ui/Modal';
import { encodeWAV } from '../recording/wavEncoder';
import { encodeMP3, isMP3Available } from '../recording/mp3Encoder';
import { generateFilename } from '../recording/formatUtils';

export interface ExportDialogProps {
  audioBlob: Blob;
  audioContext: AudioContext;
  onClose: () => void;
}

type ExportState = 'choosing' | 'encoding' | 'error' | 'empty';

export function ExportDialog({ audioBlob, audioContext, onClose }: ExportDialogProps) {
  const [audioBuffer, setAudioBuffer] = useState<AudioBuffer | null>(null);
  const [exportState, setExportState] = useState<ExportState>('choosing');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [encodingFormat, setEncodingFormat] = useState<'wav' | 'mp3' | null>(null);
  const decodedRef = useRef(false);

  // Decode audioBlob to AudioBuffer on mount / when blob changes
  useEffect(() => {
    if (decodedRef.current) return;
    decodedRef.current = true;

    const reader = new FileReader();
    reader.onload = () => {
      const arrayBuffer = reader.result as ArrayBuffer;
      audioContext
        .decodeAudioData(arrayBuffer)
        .then((buffer) => {
          if (buffer.duration === 0 || buffer.length === 0) {
            setExportState('empty');
          } else {
            setAudioBuffer(buffer);
            setExportState('choosing');
          }
        })
        .catch(() => {
          setExportState('empty');
        });
    };
    reader.onerror = () => {
      setExportState('empty');
    };
    reader.readAsArrayBuffer(audioBlob);
  }, [audioBlob, audioContext]);

  /** Trigger a browser download from a Blob. */
  const triggerDownload = useCallback((blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, []);

  /** Handle format selection and encode + download. */
  const handleExport = useCallback(
    async (format: 'wav' | 'mp3') => {
      if (!audioBuffer) return;

      setEncodingFormat(format);
      setExportState('encoding');
      setErrorMessage(null);

      try {
        let blob: Blob;
        if (format === 'wav') {
          blob = encodeWAV(audioBuffer);
        } else {
          blob = await encodeMP3(audioBuffer);
        }

        const filename = generateFilename(new Date(), format);
        triggerDownload(blob, filename);
        onClose();
      } catch (err) {
        if (format === 'mp3') {
          // Req 5.4: MP3 failure — show error, fall back to WAV option
          setErrorMessage('MP3 encoding failed. You can still download as WAV.');
          setExportState('error');
        } else {
          setErrorMessage(
            `Export failed: ${err instanceof Error ? err.message : String(err)}`,
          );
          setExportState('error');
        }
      }
    },
    [audioBuffer, triggerDownload, onClose],
  );

  const mp3Available = isMP3Available();

  return (
    <Modal isOpen={true} onClose={onClose} title="Export Recording" size="sm">
      <div className="space-y-4">
        {/* Empty recording warning (Req 4.3) */}
        {exportState === 'empty' && (
          <div className="p-3 bg-yellow-500/10 border border-yellow-500/30 rounded">
            <p className="text-sm text-foreground">
              Recording is empty (zero duration). Nothing to export.
            </p>
          </div>
        )}

        {/* Encoding progress indicator */}
        {exportState === 'encoding' && (
          <div className="flex items-center space-x-3 p-3 bg-lineHighlight/30 rounded">
            <div className="w-4 h-4 border-2 border-foreground/30 border-t-foreground rounded-full animate-spin" />
            <p className="text-sm text-foreground">
              Encoding {encodingFormat?.toUpperCase()}…
            </p>
          </div>
        )}

        {/* Error message */}
        {exportState === 'error' && errorMessage && (
          <div className="p-3 bg-red-500/10 border border-red-500/30 rounded">
            <p className="text-sm text-foreground">{errorMessage}</p>
          </div>
        )}

        {/* Format selection buttons (Req 5.1) */}
        {(exportState === 'choosing' || exportState === 'error') && audioBuffer && (
          <div className="space-y-3">
            <p className="text-sm text-foreground/70">Choose export format:</p>
            <div className="flex space-x-2">
              <button
                onClick={() => handleExport('wav')}
                className="flex-1 px-4 py-2 bg-lineHighlight hover:bg-lineHighlight/80 text-foreground rounded transition-colors focus:outline-none focus:ring-2 focus:ring-lineHighlight"
              >
                WAV
                <span className="block text-xs text-foreground/50 mt-0.5">Lossless</span>
              </button>
              <button
                onClick={() => handleExport('mp3')}
                disabled={!mp3Available}
                className={`flex-1 px-4 py-2 rounded transition-colors focus:outline-none focus:ring-2 focus:ring-lineHighlight ${
                  mp3Available
                    ? 'bg-lineHighlight hover:bg-lineHighlight/80 text-foreground'
                    : 'bg-lineHighlight/30 text-foreground/30 cursor-not-allowed'
                }`}
              >
                MP3
                <span className="block text-xs text-foreground/50 mt-0.5">
                  {mp3Available ? 'Smaller file' : 'Not available'}
                </span>
              </button>
            </div>
            {/* Req 5.4: Explanatory message when MP3 is unavailable */}
            {!mp3Available && (
              <p className="text-xs text-foreground/50">
                MP3 encoding is not available in this browser. Only WAV export is supported.
              </p>
            )}
          </div>
        )}

        {/* Cancel / Close button */}
        <div className="pt-2 border-t border-lineHighlight/30">
          <button
            onClick={onClose}
            className="w-full px-4 py-2 text-sm bg-lineHighlight/40 hover:bg-lineHighlight/60 text-foreground rounded transition-colors focus:outline-none focus:ring-2 focus:ring-lineHighlight"
          >
            Cancel
          </button>
        </div>
      </div>
    </Modal>
  );
}
