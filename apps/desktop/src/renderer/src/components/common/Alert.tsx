import React from 'react';

export type AlertVariant = 'info' | 'success' | 'warning' | 'danger';

export interface AlertProps {
  readonly variant: AlertVariant;
  readonly title?: string;
  readonly children: React.ReactNode;
  readonly onDismiss?: () => void;
  readonly className?: string;
}

export const Alert: React.FC<AlertProps> = ({
  variant,
  title,
  children,
  onDismiss,
  className = '',
}) => {
  const alertClasses = ['auditor-alert', `auditor-alert--${variant}`, className]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={alertClasses} role="alert">
      <div className="auditor-alert__body">
        {title && <div className="auditor-alert__title">{title}</div>}
        <div className="auditor-alert__message">{children}</div>
      </div>
      {onDismiss && (
        <button
          type="button"
          className="auditor-alert__dismiss"
          onClick={onDismiss}
          aria-label="Dismiss alert"
        >
          &times;
        </button>
      )}
    </div>
  );
};
