import Loader from '@src/repl/components/Loader';
import { Code } from '@src/repl/components/Code';
import BigPlayButton from '@src/repl/components/BigPlayButton';
import UserFacingErrorMessage from '@src/repl/components/UserFacingErrorMessage';
import { Header } from './Header';
import React from 'react';

interface ReplContext {
  pending: boolean;
  started: boolean;
  handleTogglePlay: () => void;
  containerRef: React.RefObject<HTMLElement>;
  editorRef: React.RefObject<any>;
  error: Error | null;
  init: () => void;
  isDirty: boolean;
  activeCode: string;
  handleEvaluate: () => void;
  handleShuffle: () => void;
  handleShare: () => void;
  handleUpdate: (data: any, reset?: boolean) => void;
}

interface EmbeddedReplEditorProps extends React.HTMLAttributes<HTMLDivElement> {
  context: ReplContext;
}

export default function EmbeddedReplEditor({ context, ...editorProps }: EmbeddedReplEditorProps) {
  const { pending, started, handleTogglePlay, containerRef, editorRef, error, init } = context;
  
  return (
    <div className="h-full flex flex-col relative" {...editorProps}>
      <Loader active={pending} />
      <Header context={context} embedded={true} />
      <BigPlayButton started={started} handleTogglePlay={handleTogglePlay} />
      <div className="grow flex relative overflow-hidden">
        <Code containerRef={containerRef} editorRef={editorRef} init={init} />
      </div>
      <UserFacingErrorMessage error={error} />
    </div>
  );
}