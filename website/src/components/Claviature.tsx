import { getClaviature } from 'claviature';
import React from 'react';

interface ClaviatureOptions {
  range?: [string, string];
  scaleY?: number;
  scaleX?: number;
  colorize?: Array<{ keys: string[]; color: string }>;
  labels?: Record<string, string>;
}

interface ClaviatureProps {
  options?: ClaviatureOptions;
  onClick?: (note: number) => void;
  onMouseDown?: (note: number) => void;
  onMouseUp?: (note: number) => void;
  onMouseLeave?: (note: number) => void;
}

interface SvgElement {
  name: string;
  attributes: Record<string, any>;
  value?: string;
}

interface ClaviatureSvg {
  attributes: Record<string, any>;
  children: SvgElement[];
}

export default function Claviature({ options, onClick, onMouseDown, onMouseUp, onMouseLeave }: ClaviatureProps) {
  const svg = getClaviature({
    options,
    onClick,
    onMouseDown,
    onMouseUp,
    onMouseLeave,
  }) as ClaviatureSvg;

  return (
    <svg {...svg.attributes}>
      {svg.children.map((el, i) => {
        const TagName = el.name as React.ElementType;
        const { key, ...attributes } = el.attributes;
        return (
          <TagName key={`${el.name}-${i}`} {...attributes}>
            {el.value}
          </TagName>
        );
      })}
    </svg>
  );
}