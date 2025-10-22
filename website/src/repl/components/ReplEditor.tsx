import Loader from '@src/repl/components/Loader';
import { HorizontalPanel, VerticalPanel } from '@src/repl/components/panel/Panel';
import { Code } from '@src/repl/components/Code';
import UserFacingErrorMessage from '@src/repl/components/UserFacingErrorMessage';
import { Header } from './Header';
import { useSettings } from '@src/settings';
import { ResizableSidebar } from './sidebar/ResizableSidebar';
import { FileManager } from './sidebar/FileManager';
import React from 'react';

interface ReplContext {
  containerRef: React.RefObject<HTMLDivElement>;
  editorRef: React.RefObject<any>;
  error: Error | null;
  init: () => void;
  pending: boolean;
  started: boolean;
  isDirty: boolean;
  activeCode: string;
  handleTogglePlay: () => void;
  handleEvaluate: () => void;
  handleShuffle: () => void;
  handleShare: () => void;
  handleUpdate: (data: any, reset?: boolean) => void;
}

interface ReplEditorProps extends React.HTMLAttributes<HTMLDivElement> {
  context: ReplContext;
}

export default function ReplEditor({ context, ...editorProps }: ReplEditorProps) {
  const { containerRef, editorRef, error, init, pending } = context;
  const settings = useSettings();
  const { panelPosition, isZen, isFileManagerOpen } = settings;

  return (
    <div className="h-full flex flex-col relative" {...editorProps}>
      <Loader active={pending} />
      <Header context={context} />
      <div className="grow flex relative overflow-hidden">
        {!isZen && isFileManagerOpen && (
          <ResizableSidebar defaultWidth={300} minWidth={200} maxWidth={500}>
            <FileManager context={context} />
          </ResizableSidebar>
        )}
        <Code containerRef={containerRef} editorRef={editorRef} init={init} />
        {!isZen && panelPosition === 'right' && <VerticalPanel context={context} />}
      </div>
      <UserFacingErrorMessage error={error} />
      {!isZen && panelPosition === 'bottom' && <HorizontalPanel context={context} />}
    </div>
  );
}