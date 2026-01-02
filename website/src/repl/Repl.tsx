/*
Repl.tsx - Main Strudel REPL component
Copyright (C) 2022 Strudel contributors - see <https://codeberg.org/uzu/strudel/src/branch/main/repl/src/App.js>
This program is free software: you can redistribute it and/or modify it under the terms of the GNU Affero General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version. This program is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU Affero General Public License for more details. You should have received a copy of the GNU Affero General Public License along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/

import { isIframe, isUdels } from './util';
import UdelsEditor from '@components/Udels/UdelsEditor';
import ReplEditor from './components/ReplEditor';
import AuthenticatedReplEditor from './components/AuthenticatedReplEditor';
import EmbeddedReplEditor from './components/EmbeddedReplEditor';
import { useReplContext } from './useReplContext';
import { useSettings } from '@src/settings';
import { I18nProvider } from '@src/components/I18nProvider';
import '@src/i18n'; // Initialize i18n system
import type { CSSProperties } from 'react';

// Type definitions
interface ReplProps {
  embedded?: boolean;
}

interface EditorProps {
  context: any;
  style: CSSProperties;
}

export function Repl({ embedded = false }: ReplProps) {
  const isEmbedded = embedded || isIframe();
  const context = useReplContext();
  const { fontFamily } = useSettings();
  
  // Check if there's a track parameter in the URL
  const hasTrackParam = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('track');
  
  // Choose the appropriate editor based on context
  let Editor;
  if (isUdels()) {
    Editor = UdelsEditor;
  } else if (isEmbedded) {
    Editor = EmbeddedReplEditor;
  } else {
    // Always use regular editor - no authentication required
    // Users can sign in via header button if they want cloud features
    Editor = ReplEditor;
  }
  
  return (
    <I18nProvider>
      <Editor context={context} style={{ fontFamily }} />
    </I18nProvider>
  );
}