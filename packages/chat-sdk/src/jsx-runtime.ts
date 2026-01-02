/**
 * Custom JSX runtime for chat-sdk cards.
 *
 * This allows using JSX syntax without React. Configure your bundler:
 *
 * tsconfig.json:
 * {
 *   "compilerOptions": {
 *     "jsx": "react-jsx",
 *     "jsxImportSource": "chat-sdk"
 *   }
 * }
 *
 * Or per-file:
 * /** @jsxImportSource chat-sdk *\/
 *
 * Usage:
 * ```tsx
 * import { Card, Text, Button, Actions } from "chat-sdk";
 *
 * const card = (
 *   <Card title="Order #1234">
 *     <Text>Your order is ready!</Text>
 *     <Actions>
 *       <Button id="pickup" style="primary">Schedule Pickup</Button>
 *     </Actions>
 *   </Card>
 * );
 * ```
 */

import type { CardChild, CardElement } from "./cards";

// Symbol to identify our JSX elements before they're processed
const JSX_ELEMENT = Symbol.for("chat-sdk.jsx.element");

interface JSXElement {
  $$typeof: typeof JSX_ELEMENT;
  type: CardComponentFunction;
  props: Record<string, unknown>;
  children: unknown[];
}

type CardComponentFunction = (props: Record<string, unknown>) => CardElement | CardChild;

/**
 * Check if a value is a JSX element from our runtime.
 */
function isJSXElement(value: unknown): value is JSXElement {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as JSXElement).$$typeof === JSX_ELEMENT
  );
}

/**
 * Process children, converting JSX elements to card elements.
 */
function processChildren(children: unknown): CardChild[] {
  if (children == null) {
    return [];
  }

  if (Array.isArray(children)) {
    return children.flatMap(processChildren);
  }

  // If it's a JSX element, resolve it
  if (isJSXElement(children)) {
    const resolved = resolveJSXElement(children);
    if (resolved) {
      return [resolved as CardChild];
    }
    return [];
  }

  // If it's already a card element, return it
  if (typeof children === "object" && "type" in children) {
    return [children as CardChild];
  }

  // If it's a string, it might be text content for a Button
  if (typeof children === "string") {
    // Return as-is, the component will handle it
    return [children as unknown as CardChild];
  }

  return [];
}

/**
 * Resolve a JSX element by calling its component function.
 */
function resolveJSXElement(element: JSXElement): CardElement | CardChild | null {
  const { type, props, children } = element;

  // Process children first
  const processedChildren = processChildren(children);

  // Merge children into props
  const fullProps = {
    ...props,
    children: processedChildren.length === 1 ? processedChildren[0] : processedChildren,
  };

  // Call the component function
  return type(fullProps);
}

/**
 * JSX factory function (used by the JSX transform).
 * Creates a lazy JSX element that will be resolved when needed.
 */
export function jsx(
  type: CardComponentFunction,
  props: Record<string, unknown>,
  _key?: string,
): JSXElement {
  const { children, ...restProps } = props;
  return {
    $$typeof: JSX_ELEMENT,
    type,
    props: restProps,
    children: children != null ? [children] : [],
  };
}

/**
 * JSX factory for elements with multiple children.
 */
export function jsxs(
  type: CardComponentFunction,
  props: Record<string, unknown>,
  _key?: string,
): JSXElement {
  const { children, ...restProps } = props;
  return {
    $$typeof: JSX_ELEMENT,
    type,
    props: restProps,
    children: Array.isArray(children) ? children : children != null ? [children] : [],
  };
}

/**
 * Fragment support (flattens children).
 */
export function Fragment(props: { children?: unknown }): CardChild[] {
  return processChildren(props.children);
}

/**
 * Convert a JSX element tree to a CardElement.
 * Call this on the root JSX element to get a usable CardElement.
 */
export function toCardElement(jsxElement: unknown): CardElement | null {
  if (isJSXElement(jsxElement)) {
    const resolved = resolveJSXElement(jsxElement);
    if (resolved && typeof resolved === "object" && "type" in resolved && resolved.type === "card") {
      return resolved as CardElement;
    }
  }

  // Already a CardElement
  if (
    typeof jsxElement === "object" &&
    jsxElement !== null &&
    "type" in jsxElement &&
    (jsxElement as CardElement).type === "card"
  ) {
    return jsxElement as CardElement;
  }

  return null;
}

/**
 * Check if a value is a JSX element (from our runtime or React).
 */
export function isJSX(value: unknown): boolean {
  if (isJSXElement(value)) {
    return true;
  }
  // Check for React elements
  if (
    typeof value === "object" &&
    value !== null &&
    "$$typeof" in value &&
    typeof (value as { $$typeof: unknown }).$$typeof === "symbol"
  ) {
    const symbolStr = (value as { $$typeof: symbol }).$$typeof.toString();
    return symbolStr.includes("react.element") || symbolStr.includes("react.transitional.element");
  }
  return false;
}

// Re-export for JSX namespace
export namespace JSX {
  export interface Element extends JSXElement {}
  export interface IntrinsicElements {}
  export interface ElementChildrenAttribute {
    children: {};
  }
}
