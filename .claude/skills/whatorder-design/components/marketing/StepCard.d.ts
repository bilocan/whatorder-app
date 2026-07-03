import type React from 'react';

export interface StepCardProps {
  /** Step eyebrow, e.g. "Step 01". */
  step?: string;
  /** Step heading. */
  title?: React.ReactNode;
  /** Step description. */
  children?: React.ReactNode;
  style?: React.CSSProperties;
}

export function StepCard(props: StepCardProps): JSX.Element;
