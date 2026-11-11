import React from 'react';

export interface ViewportProps {
  readonly children: React.ReactNode;
}

export const Viewport: React.FC<ViewportProps> = ({ children }) => {
  return (
    <main className="auditor-viewport" role="main">
      {children}
    </main>
  );
};
