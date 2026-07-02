import type React from 'react';

export interface TagProps {
  children?: React.ReactNode;
  style?: React.CSSProperties;
}

export function Tag(props: TagProps): JSX.Element;
