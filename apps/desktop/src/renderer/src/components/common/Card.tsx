import React from 'react';

export interface CardProps {
  readonly title?: string;
  readonly subtitle?: string;
  readonly headerAction?: React.ReactNode;
  readonly children: React.ReactNode;
  readonly footer?: React.ReactNode;
  readonly elevated?: boolean;
  readonly className?: string;
  readonly role?: string;
  readonly 'aria-label'?: string;
}

export const Card: React.FC<CardProps> = ({
  title,
  subtitle,
  headerAction,
  children,
  footer,
  elevated = false,
  className = '',
  role,
  'aria-label': ariaLabel,
}) => {
  const cardClasses = ['auditor-card', elevated ? 'auditor-card--elevated' : '', className]
    .filter(Boolean)
    .join(' ');

  const hasHeader = title || subtitle || headerAction;

  return (
    <section className={cardClasses} role={role} aria-label={ariaLabel}>
      {hasHeader && (
        <header className="auditor-card__header">
          <div className="auditor-card__titles">
            {title && <h2 className="auditor-card__title">{title}</h2>}
            {subtitle && <p className="auditor-card__subtitle">{subtitle}</p>}
          </div>
          {headerAction && <div className="auditor-card__action">{headerAction}</div>}
        </header>
      )}
      <div className="auditor-card__body">{children}</div>
      {footer && <footer className="auditor-card__footer">{footer}</footer>}
    </section>
  );
};
