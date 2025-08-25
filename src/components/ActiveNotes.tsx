import React, { useEffect, useState } from 'react';

interface ActiveNote {
  note: string;
  velocity: number;
  time: number;
  color?: string;
}

interface ActiveNotesProps {
  className?: string;
}

export const ActiveNotes: React.FC<ActiveNotesProps> = ({ className = '' }) => {
  const [activeNotes, setActiveNotes] = useState<ActiveNote[]>([]);

  useEffect(() => {
    // Listen for Strudel events to track active notes
    const handleNoteOn = (event: CustomEvent) => {
      const detail = event.detail;
      const note = {
        note: detail.note || 'unknown',
        velocity: detail.velocity || 0.7,
        time: detail.time || Date.now(),
        color: detail.color || '#3b82f6'
      };
      
      setActiveNotes(prev => [...prev.slice(-20), note]); // Keep last 20 notes
      
      // Remove note after a short time
      setTimeout(() => {
        setActiveNotes(prev => prev.filter(n => n.time !== note.time));
      }, 500);
    };

    // Listen for custom Strudel note events
    window.addEventListener('strudel-note', handleNoteOn as EventListener);

    return () => {
      window.removeEventListener('strudel-note', handleNoteOn as EventListener);
    };
  }, []);

  if (activeNotes.length === 0) {
    return (
      <div className={`flex items-center text-gray-500 dark:text-gray-400 text-xs ${className}`}>
        <div className="flex items-center space-x-1">
          <div className="w-1.5 h-1.5 bg-gray-300 dark:bg-gray-600 rounded-full"></div>
          <span>♪</span>
        </div>
      </div>
    );
  }

  return (
    <div className={`flex items-center space-x-1 ${className}`}>
      {activeNotes.slice(-5).map((note, index) => (
        <div
          key={`${note.time}-${index}`}
          className="flex items-center space-x-1 px-1.5 py-0.5 rounded text-xs font-mono animate-pulse"
          style={{
            backgroundColor: note.color + '20',
            borderColor: note.color,
            borderWidth: '1px',
            color: note.color,
            opacity: Math.max(0.4, 1 - (Date.now() - note.time) / 300)
          }}
        >
          <div 
            className="w-1.5 h-1.5 rounded-full"
            style={{ backgroundColor: note.color }}
          />
          <span>{note.note}</span>
        </div>
      ))}
      {activeNotes.length > 5 && (
        <span className="text-xs text-gray-400">+{activeNotes.length - 5}</span>
      )}
    </div>
  );
};