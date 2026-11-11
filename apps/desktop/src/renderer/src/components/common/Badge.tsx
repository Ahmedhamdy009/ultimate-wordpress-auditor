import React from 'react';

export type BadgeVariant = 'default' | 'success' | 'warning' | 'danger' | 'info' | 'neutral';
export type BadgeSize = 'sm' | 'md';

export interface BadgeProps {
  readonly variant?: BadgeVariant;
  readonly size?: BadgeSize;
  readonly children: React.ReactNode;
  readonly className?: string;
  readonly title?: string;
}

export const Badge: React.FC<BadgeProps> = ({
  variant = 'default',
  size = 'md',
  children,
  className = '',
  title,
}) => {
  const badgeClasses = [
    'auditor-badge',
    `auditor-badge--${variant}`,
    `auditor-badge--${size}`,
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <span className={badgeClasses} title={title}>
      {children}
    </span>
  );
};
