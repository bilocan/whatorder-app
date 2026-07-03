import type React from 'react';

export interface QuoteBlockProps {
  quote?: React.ReactNode;
  author?: React.ReactNode;
  style?: React.CSSProperties;
}

export function QuoteBlock(props: QuoteBlockProps): JSX.Element;
