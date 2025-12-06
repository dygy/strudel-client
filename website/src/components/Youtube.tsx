import LiteYouTubeEmbed from 'react-lite-youtube-embed';
import 'react-lite-youtube-embed/dist/LiteYouTubeEmbed.css';
import React from 'react';

interface YoutubeProps {
  id: string;
  title?: string;
  params?: string;
  [key: string]: any;
}

export function Youtube({ title = 'YouTube video', ...props }: YoutubeProps) {
  return <LiteYouTubeEmbed title={title} {...props} />;
}