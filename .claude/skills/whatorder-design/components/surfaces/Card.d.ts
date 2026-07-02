import type React from 'react';

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Surface style. @default "light" */
  surface?: 'light' | 'dark';
  /** Brighten the border on hover (dark marketing cards). @default false */
  hover?: boolean;
  children?: React.ReactNode;
}

export function Card(props: CardProps): JSX.Element;
