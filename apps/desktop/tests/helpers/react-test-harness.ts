import React, { type ReactElement } from 'react';
import * as ReactDOMServer from 'react-dom/server';
import type { Root } from 'react-dom/client';

export interface RenderHookResult<T> {
  current: T;
}

export interface RenderHookController<T> {
  readonly result: RenderHookResult<T>;
  readonly mount: () => Promise<void>;
  readonly unmount: () => Promise<void>;
  readonly rerender: () => Promise<void>;
  readonly act: typeof React.act;
}

/**
 * Lightweight mock DOM node implementation for in-memory React client rendering in Node.
 */
class MockDOMNode {
  public nodeType: number = 1;
  public nodeName: string = 'DIV';
  public tagName: string = 'div';
  public childNodes: MockDOMNode[] = [];
  public ownerDocument: MockDOMDocument | null = null;
  public parentNode: MockDOMNode | null = null;
  public style: Record<string, string> = {};
  public nodeValue: string | null = null;

  public setAttribute(_name: string, _value: string): void {}
  public getAttribute(_name: string): string | null {
    return null;
  }
  public removeAttribute(_name: string): void {}
  public hasAttribute(_name: string): boolean {
    return false;
  }
  public appendChild(child: MockDOMNode): MockDOMNode {
    child.parentNode = this;
    this.childNodes.push(child);
    return child;
  }
  public removeChild(child: MockDOMNode): MockDOMNode {
    const idx = this.childNodes.indexOf(child);
    if (idx >= 0) {
      this.childNodes.splice(idx, 1);
    }
    child.parentNode = null;
    return child;
  }
  public insertBefore(child: MockDOMNode): MockDOMNode {
    return this.appendChild(child);
  }
  public addEventListener(): void {}
  public removeEventListener(): void {}
}

class MockDOMDocument {
  public nodeType: number = 9;
  public nodeName: string = '#document';
  public defaultView: typeof globalThis = globalThis;
  public documentElement: MockDOMNode = new MockDOMNode();
  public body: MockDOMNode = new MockDOMNode();
  public visibilityState: DocumentVisibilityState = 'visible';
  private listeners: Map<string, Set<(event: unknown) => void>> = new Map();

  constructor() {
    this.documentElement.ownerDocument = this;
    this.body.ownerDocument = this;
  }

  public createElement(name: string): MockDOMNode {
    const node = new MockDOMNode();
    node.nodeName = name.toUpperCase();
    node.tagName = name.toLowerCase();
    node.ownerDocument = this;
    return node;
  }

  public createTextNode(text: string): MockDOMNode {
    const node = new MockDOMNode();
    node.nodeType = 3;
    node.nodeName = '#text';
    node.nodeValue = text;
    node.ownerDocument = this;
    return node;
  }

  public createComment(): MockDOMNode {
    const node = new MockDOMNode();
    node.nodeType = 8;
    node.nodeName = '#comment';
    node.ownerDocument = this;
    return node;
  }

  public addEventListener(type: string, listener: (event: unknown) => void): void {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set());
    }
    this.listeners.get(type)!.add(listener);
  }

  public removeEventListener(type: string, listener: (event: unknown) => void): void {
    this.listeners.get(type)?.delete(listener);
  }

  public dispatchEvent(event: { type: string }): boolean {
    const set = this.listeners.get(event.type);
    if (set) {
      for (const listener of set) {
        listener(event);
      }
    }
    return true;
  }
}

let isDOMInitialized = false;
let globalDoc: MockDOMDocument;

/**
 * Initializes minimal DOM globals for React 19 client execution in Node tests.
 */
export function setupReactTestDOM(): void {
  if (isDOMInitialized) return;

  globalDoc = new MockDOMDocument();

  // Install Node/Element constructor mocks for React's instanceof checks
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const g = globalThis as any;
  g.Node = MockDOMNode;
  g.Element = MockDOMNode;
  g.HTMLElement = MockDOMNode;
  g.HTMLIFrameElement = class extends MockDOMNode {};
  g.HTMLInputElement = class extends MockDOMNode {};
  g.HTMLTextAreaElement = class extends MockDOMNode {};
  g.HTMLSelectElement = class extends MockDOMNode {};
  g.document = globalDoc;
  g.window = globalThis;
  g.IS_REACT_ACT_ENVIRONMENT = true;

  isDOMInitialized = true;
}

/**
 * Executes a custom React hook in an authentic React 19 component lifecycle.
 */
export async function renderTestHook<T>(hookCallback: () => T): Promise<RenderHookController<T>> {
  setupReactTestDOM();

  const { createRoot } = await import('react-dom/client');

  const result: RenderHookResult<T> = { current: undefined as unknown as T };

  const HookHarness: React.FC = () => {
    const val = hookCallback();
    result.current = val;
    if (React.isValidElement(val)) {
      return val;
    }
    return null;
  };

  const container = globalDoc.createElement('div');
  const root: Root = createRoot(container as unknown as HTMLElement);

  const mount = async (): Promise<void> => {
    await React.act(async () => {
      root.render(React.createElement(HookHarness));
    });
  };

  const unmount = async (): Promise<void> => {
    await React.act(async () => {
      root.unmount();
    });
  };

  const rerender = async (): Promise<void> => {
    await React.act(async () => {
      root.render(React.createElement(HookHarness));
    });
  };

  return {
    result,
    mount,
    unmount,
    rerender,
    act: React.act,
  };
}

/**
 * Renders a React element to static HTML string using react-dom/server.
 */
export function renderComponentToHtml(element: ReactElement): string {
  return ReactDOMServer.renderToStaticMarkup(element);
}
