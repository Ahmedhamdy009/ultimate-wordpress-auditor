import React, { useState, useMemo, useEffect } from 'react';
import type { VisualEvidenceEntryDTO } from '@auditor/shared';
import { Card } from '../common/Card.js';
import { Badge, type BadgeVariant } from '../common/Badge.js';
import { useAuditUi } from '../../context/AuditUiContext.js';

export interface VisualEvidenceGalleryProps {
  readonly visualEvidence?: Readonly<Record<string, VisualEvidenceEntryDTO>>;
  readonly visualEvidenceLoading?: boolean;
  readonly screenshotsDisabled?: boolean;
}

export type ViewportFilter = 'all' | 'desktop' | 'tablet' | 'mobile';

export const VisualEvidenceGallery: React.FC<VisualEvidenceGalleryProps> = ({
  visualEvidence = {},
  visualEvidenceLoading = false,
  screenshotsDisabled = false,
}) => {
  const { locale, tDesktop } = useAuditUi();
  const isArabic = locale === 'ar';

  const [activeViewport, setActiveViewport] = useState<ViewportFilter>('all');
  const [activeScreenshot, setActiveScreenshot] = useState<VisualEvidenceEntryDTO | null>(null);

  const allEntries = useMemo(() => {
    return Object.values(visualEvidence);
  }, [visualEvidence]);

  const filteredEntries = useMemo(() => {
    if (activeViewport === 'all') return allEntries;
    return allEntries.filter(entry => {
      const cat = (entry.viewportCategory || entry.viewport || '').toLowerCase();
      return cat.includes(activeViewport);
    });
  }, [allEntries, activeViewport]);

  // Handle escape key to dismiss zoom modal
  useEffect(() => {
    if (!activeScreenshot) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setActiveScreenshot(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeScreenshot]);

  const resolveBadgeVariant = (status?: string): BadgeVariant => {
    if (!status || status === 'captured') return 'success';
    if (status === 'disabled' || status === 'omitted') return 'neutral';
    return 'warning';
  };

  if (!visualEvidenceLoading && allEntries.length === 0) {
    if (!screenshotsDisabled) {
      return null;
    }
    return (
      <div data-testid="visual-evidence-gallery" className="auditor-visual-evidence-gallery">
        <Card
          title={isArabic ? 'الأدلة البصرية ولقطات الشاشة' : 'Visual Evidence & Page Screenshots'}
          subtitle={
            isArabic
              ? 'تم تعطيل التقاط لقطات الشاشة في إعدادات هذا الفحص.'
              : 'Screenshot capture was disabled in this scan configuration.'
          }
        >
          <div className="auditor-empty-state">
            {isArabic
              ? 'لم تُلتقط أي لقطات شاشة (captureScreenshots: false). اختر وضع Standard أو Deep أو فعّل خيار Capture Screenshots في Custom لإرفاق الأدلة البصرية.'
              : 'No screenshots were captured (captureScreenshots: false). Select Standard, Deep, or enable Capture Screenshots in Custom mode to collect visual evidence.'}
          </div>
        </Card>
      </div>
    );
  }

  const title = isArabic ? 'الأدلة البصرية ولقطات الشاشة' : 'Visual Evidence & Page Screenshots';
  const subtitle = isArabic
    ? `${allEntries.length} لقطة ملتقطة عبر مختلف أبعاد الشاشات (بما في ذلك الصفحات النظيفة)`
    : `${allEntries.length} captured page viewports (including clean pages without defects)`;

  return (
    <div data-testid="visual-evidence-gallery" className="auditor-visual-evidence-gallery">
      <Card title={title} subtitle={subtitle}>
        {/* Filter bar by viewport */}
        <div className="auditor-filter-bar" style={{ marginBottom: 'var(--auditor-space-4)' }}>
          <div className="auditor-filter-tabs">
            <button
              type="button"
              className={`auditor-filter-tab ${activeViewport === 'all' ? 'auditor-filter-tab--active' : ''}`}
              onClick={() => setActiveViewport('all')}
              data-testid="gallery-tab-all"
            >
              {isArabic ? 'الكل' : 'All'} ({allEntries.length})
            </button>
            <button
              type="button"
              className={`auditor-filter-tab ${activeViewport === 'desktop' ? 'auditor-filter-tab--active' : ''}`}
              onClick={() => setActiveViewport('desktop')}
              data-testid="gallery-tab-desktop"
            >
              {isArabic ? 'سطح المكتب' : 'Desktop'} (
              {
                allEntries.filter(e =>
                  (e.viewportCategory || e.viewport || '').toLowerCase().includes('desktop'),
                ).length
              }
              )
            </button>
            <button
              type="button"
              className={`auditor-filter-tab ${activeViewport === 'tablet' ? 'auditor-filter-tab--active' : ''}`}
              onClick={() => setActiveViewport('tablet')}
              data-testid="gallery-tab-tablet"
            >
              {isArabic ? 'جهاز لوحي' : 'Tablet'} (
              {
                allEntries.filter(e =>
                  (e.viewportCategory || e.viewport || '').toLowerCase().includes('tablet'),
                ).length
              }
              )
            </button>
            <button
              type="button"
              className={`auditor-filter-tab ${activeViewport === 'mobile' ? 'auditor-filter-tab--active' : ''}`}
              onClick={() => setActiveViewport('mobile')}
              data-testid="gallery-tab-mobile"
            >
              {isArabic ? 'هاتف محمول' : 'Mobile'} (
              {
                allEntries.filter(e =>
                  (e.viewportCategory || e.viewport || '').toLowerCase().includes('mobile'),
                ).length
              }
              )
            </button>
          </div>
        </div>

        {visualEvidenceLoading ? (
          <div
            style={{
              padding: 'var(--auditor-space-8)',
              textAlign: 'center',
              color: 'var(--auditor-text-muted)',
            }}
          >
            {isArabic ? 'جارٍ تحميل الأدلة البصرية...' : 'Loading visual evidence...'}
          </div>
        ) : filteredEntries.length === 0 ? (
          <div
            style={{
              padding: 'var(--auditor-space-6)',
              textAlign: 'center',
              color: 'var(--auditor-text-muted)',
              border: '1px dashed var(--auditor-border-subtle)',
              borderRadius: 'var(--auditor-radius-md)',
            }}
          >
            {isArabic
              ? 'لا توجد لقطات شاشة مسجلة لهذا العرض.'
              : 'No screenshots found matching this viewport filter.'}
          </div>
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
              gap: 'var(--auditor-space-4)',
            }}
          >
            {filteredEntries.map(entry => (
              <div
                key={entry.fileName}
                data-testid="screenshot-card"
                className="auditor-card auditor-card--elevated"
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  overflow: 'hidden',
                  padding: 'var(--auditor-space-3)',
                }}
              >
                {/* Header: file name & badges */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '8px',
                    marginBottom: 'var(--auditor-space-2)',
                  }}
                >
                  <strong
                    className="font-mono"
                    dir="ltr"
                    style={{
                      fontSize: '12px',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                    title={entry.fileName}
                  >
                    {entry.fileName}
                  </strong>
                  <div style={{ display: 'flex', gap: '4px', flexShrink: 0 }}>
                    {entry.viewportCategory && (
                      <Badge variant="neutral" size="sm">
                        {entry.viewportCategory}
                      </Badge>
                    )}
                    <Badge variant={resolveBadgeVariant(entry.status)} size="sm">
                      {entry.status || (entry.embedded ? 'captured' : 'omitted')}
                    </Badge>
                  </div>
                </div>

                {/* Meta details */}
                <div
                  style={{
                    fontSize: '11px',
                    color: 'var(--auditor-text-muted)',
                    marginBottom: 'var(--auditor-space-2)',
                    lineHeight: '1.4',
                  }}
                >
                  {entry.viewport && (
                    <span>
                      {isArabic ? 'الشاشة:' : 'Viewport:'}{' '}
                      <strong style={{ color: 'var(--auditor-text-primary)' }}>
                        {entry.viewport}
                      </strong>{' '}
                      &bull;{' '}
                    </span>
                  )}
                  {entry.width && entry.height && (
                    <span dir="ltr">
                      {entry.width}&times;{entry.height} &bull;{' '}
                    </span>
                  )}
                  {entry.captureType && (
                    <span>
                      {isArabic ? 'النوع:' : 'Type:'} <strong>{entry.captureType}</strong>{' '}
                      &bull;{' '}
                    </span>
                  )}
                  <span dir="ltr">{Math.round(entry.byteLength / 1024)} KB</span>
                  {entry.pageUrl && (
                    <div
                      className="font-mono"
                      dir="ltr"
                      style={{
                        marginTop: '4px',
                        fontSize: '10px',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                      title={entry.pageUrl}
                    >
                      {entry.pageUrl}
                    </div>
                  )}
                </div>

                {/* Thumbnail / fallback */}
                <div
                  style={{
                    flex: 1,
                    minHeight: '140px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: 'var(--auditor-bg-surface-subtle)',
                    borderRadius: 'var(--auditor-radius-sm)',
                    overflow: 'hidden',
                    position: 'relative',
                  }}
                >
                  {entry.embedded && entry.dataUri ? (
                    <button
                      type="button"
                      onClick={() => setActiveScreenshot(entry)}
                      data-testid="zoom-screenshot-button"
                      style={{
                        padding: 0,
                        border: 'none',
                        background: 'transparent',
                        cursor: 'pointer',
                        width: '100%',
                        height: '100%',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                      title={isArabic ? 'انقر لتكبير لقطة الشاشة' : 'Click to zoom screenshot'}
                    >
                      <img
                        src={entry.dataUri}
                        alt={`Screenshot of ${entry.pageUrl || entry.fileName}`}
                        style={{
                          maxWidth: '100%',
                          maxHeight: '160px',
                          objectFit: 'contain',
                        }}
                      />
                    </button>
                  ) : (
                    <div
                      style={{
                        fontSize: '11px',
                        color: 'var(--auditor-text-muted)',
                        padding: 'var(--auditor-space-3)',
                        textAlign: 'center',
                      }}
                    >
                      {entry.omittedReason ||
                        (isArabic ? 'المعاينة غير متاحة.' : 'Screenshot preview unavailable.')}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Accessible Screenshot Lightbox Modal */}
      {activeScreenshot && activeScreenshot.dataUri && (
        <div
          className="auditor-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label={activeScreenshot.fileName}
          data-testid="screenshot-preview-modal"
        >
          <div className="auditor-modal-content">
            <div className="auditor-modal-header">
              <div>
                <h3 className="auditor-modal-title">
                  {isArabic ? 'معاينة لقطة الشاشة' : 'Screenshot Preview'}
                </h3>
                <div className="auditor-modal-subtitle" dir="ltr">
                  <code>{activeScreenshot.fileName}</code>
                  {activeScreenshot.viewport ? ` • ${activeScreenshot.viewport}` : ''}
                  {activeScreenshot.pageUrl ? ` • ${activeScreenshot.pageUrl}` : ''}
                </div>
              </div>
              <button
                type="button"
                className="auditor-button auditor-button--secondary auditor-button--sm"
                onClick={() => setActiveScreenshot(null)}
                data-testid="close-screenshot-modal"
              >
                {tDesktop('closeModalLabel')}
              </button>
            </div>
            <div className="auditor-modal-body">
              <img
                className="auditor-modal-image"
                src={activeScreenshot.dataUri}
                alt={`Screenshot ${activeScreenshot.fileName}`}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
