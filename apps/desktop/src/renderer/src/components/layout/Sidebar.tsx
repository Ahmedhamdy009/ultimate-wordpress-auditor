import React from 'react';
import { Badge } from '../common/Badge.js';
import { ACTIVE_NAV_ITEMS, UPCOMING_MODULES, type ViewId } from '../../types/navigation.js';

export interface SidebarProps {
  readonly activeView: ViewId;
  readonly onSelectView: (view: ViewId) => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ activeView, onSelectView }) => {
  return (
    <aside className="auditor-sidebar" role="navigation" aria-label="Main Navigation">
      <div className="auditor-sidebar__section-title">Audit Engine</div>
      <ul className="auditor-sidebar__nav">
        {ACTIVE_NAV_ITEMS.map(item => {
          const isActive = activeView === item.id;
          return (
            <li key={item.id} className="auditor-sidebar__item">
              <button
                type="button"
                id={`nav-item-${item.id}`}
                className={`auditor-nav-button ${isActive ? 'auditor-nav-button--active' : ''}`}
                onClick={() => onSelectView(item.id)}
                aria-current={isActive ? 'page' : undefined}
                title={item.description}
              >
                <span>{item.label}</span>
                {isActive && (
                  <Badge variant="info" size="sm">
                    Active
                  </Badge>
                )}
              </button>
            </li>
          );
        })}
      </ul>

      <div className="auditor-sidebar__section-title">Upcoming Engines</div>
      <ul className="auditor-sidebar__nav">
        {UPCOMING_MODULES.map(mod => (
          <li key={mod.id} className="auditor-sidebar__item">
            <button
              type="button"
              className="auditor-nav-button auditor-nav-button--disabled"
              disabled
              aria-disabled="true"
              title={`Planned for ${mod.phase} — Not yet available`}
            >
              <span>{mod.label}</span>
              <Badge variant="neutral" size="sm">
                {mod.badge}
              </Badge>
            </button>
          </li>
        ))}
      </ul>
    </aside>
  );
};
