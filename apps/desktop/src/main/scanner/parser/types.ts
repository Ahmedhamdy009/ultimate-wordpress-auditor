/**
 * Structured types for the HTML Parser Engine.
 * Provides rich, type-safe representations of parsed HTML elements
 * without requiring browser automation or JavaScript execution.
 */

export interface PageMetadata {
  readonly title: string | null;
  readonly description: string | null;
  readonly robots: string | null;
  readonly canonical: string | null;
  readonly generator?: string | null;
  readonly lang: string | null;
  readonly dir: string | null;
  readonly charset: string | null;
  readonly viewport: string | null;
  readonly openGraph: Readonly<Record<string, string>>;
  readonly twitterCard: Readonly<Record<string, string>>;
}

export type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;
export type HeadingTag = 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';

export interface HeadingItem {
  readonly tag: HeadingTag;
  readonly level: HeadingLevel;
  readonly text: string;
  readonly id: string | null;
}

export interface ExtractedLink {
  readonly originalValue: string;
  readonly resolvedUrl: string | null;
  readonly text: string;
  readonly rel: string | null;
  readonly target: string | null;
  readonly isInternal: boolean;
  readonly isEligibleForCrawl: boolean;
  readonly rejectionReason?: string;
}

export interface ExtractedImage {
  readonly src: string | null;
  readonly srcset: string | null;
  readonly dataSrc: string | null;
  readonly dataSrcset: string | null;
  readonly alt: string | null;
  readonly width: string | null;
  readonly height: string | null;
  readonly loading: string | null;
}

export type MediaResourceType = 'script' | 'stylesheet' | 'icon' | 'iframe' | 'audio' | 'video';

export interface ExtractedMediaResource {
  readonly type: MediaResourceType;
  readonly url: string | null;
  readonly originalValue: string;
  readonly extra?: Readonly<Record<string, string>>;
}

export interface ExtractedFormField {
  readonly name: string;
  readonly type: string;
  readonly id: string | null;
  readonly required: boolean;
  readonly disabled: boolean;
  // NOTE: Form values and passwords are NEVER extracted or stored.
}

export interface ExtractedButton {
  readonly type: string;
  readonly name: string | null;
  readonly text: string;
}

export interface ExtractedForm {
  readonly id: string | null;
  readonly name: string | null;
  readonly action: string | null;
  readonly rawAction: string | null;
  readonly method: string;
  readonly enctype: string | null;
  readonly fields: readonly ExtractedFormField[];
  readonly buttons: readonly ExtractedButton[];
}

export interface InlineEventHandlerInfo {
  readonly tag: string;
  readonly attribute: string;
  readonly valueSnippet: string;
}

export interface MetaRefreshInfo {
  readonly delaySeconds: number;
  readonly targetUrl: string | null;
}

export interface HtmlStructureInfo {
  readonly elementIds: readonly string[];
  readonly inlineEventHandlers: readonly InlineEventHandlerInfo[];
  readonly metaRefresh: MetaRefreshInfo | null;
  readonly hasDoctype: boolean;
}

export interface ParserMetrics {
  readonly parseDurationMs: number;
  readonly totalNodes: number;
  readonly htmlSizeBytes: number;
}

export interface ParsedHtmlDocument {
  readonly pageUrl: string;
  readonly authorizedOrigin: string;
  readonly metadata: PageMetadata;
  readonly headings: readonly HeadingItem[];
  readonly links: readonly ExtractedLink[];
  readonly images: readonly ExtractedImage[];
  readonly resources: readonly ExtractedMediaResource[];
  readonly forms: readonly ExtractedForm[];
  readonly structure: HtmlStructureInfo;
  readonly metrics: ParserMetrics;
  readonly visibleWordCount?: number;
}

export interface HtmlParserOptions {
  /**
   * Maximum characters of text snippet to extract for inline event handlers.
   * Default: 100 characters.
   */
  readonly maxSnippetLength?: number;

  /**
   * Maximum links to process per page.
   * Default: 500.
   */
  readonly maxLinks?: number;

  /**
   * Maximum images to process per page.
   * Default: 500.
   */
  readonly maxImages?: number;

  /**
   * Maximum resources to process per page.
   * Default: 500.
   */
  readonly maxResources?: number;
}
