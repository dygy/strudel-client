import React from 'react';

interface CodeProps {
  containerRef: React.MutableRefObject<HTMLElement | null>;
  editorRef: React.MutableRefObject<any>;
  init: () => void;
}

export function Code({ editorRef, containerRef, init }: CodeProps) {
  return (
    <section
      className={'text-gray-100 cursor-text pb-0 overflow-auto grow'}
      id="code"
      dir="ltr"
      ref={(el) => {
        containerRef.current = el;
        if (!editorRef.current) {
          init();
        }
      }}
    ></section>
  );
}