import Loader from '@src/repl/components/Loader';
import { HorizontalPanel } from '@src/repl/components/panel/Panel';
import { Code } from '@src/repl/components/Code';
import BigPlayButton from '@src/repl/components/BigPlayButton';
import UserFacingErrorMessage from '@src/repl/components/UserFacingErrorMessage';
import React from 'react';

interface ReplContext {
  containerRef: React.RefObject<HTMLElement>;
  editorRef: React.RefObject<any>;
  error: Error | null;
  init: () => void;
  pending: boolean;
  started: boolean;
  handleTogglePlay: () => void;
  isDirty: boolean;
  activeCode: string;
  handleEvaluate: () => void;
  handleShuffle: () => void;
  handleShare: () => void;
  handleUpdate: (data: any, reset?: boolean) => void;
}

interface UdelsEditorProps extends React.HTMLAttributes<HTMLDivElement> {
  context: ReplContext;
}

export default function UdelsEditor({ context, ...editorProps }: UdelsEditorProps) {
  const { containerRef, editorRef, error, init, pending, started, handleTogglePlay } = context;

  return (
    <div className={'h-full flex w-full flex-col relative'} {...editorProps}>
      <Loader active={pending} />
      <BigPlayButton started={started} handleTogglePlay={handleTogglePlay} />
      <div className="grow flex relative overflow-hidden">
        <Code containerRef={containerRef} editorRef={editorRef} init={init} />
      </div>
      <UserFacingErrorMessage error={error} />
      <HorizontalPanel context={context} />
    </div>
  );
}