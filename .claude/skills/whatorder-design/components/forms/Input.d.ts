import type React from 'react';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  /** Surface the input sits on. @default "light" */
  surface?: 'light' | 'dark';
  /** Optional field label rendered above the input. */
  label?: string;
  /** Style applied to the label+input wrapper. */
  wrapperStyle?: React.CSSProperties;
}

export function Input(props: InputProps): JSX.Element;
