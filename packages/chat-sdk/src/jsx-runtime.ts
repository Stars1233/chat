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

import {
  Actions,
  Button,
  type ButtonElement,
  type CardChild,
  type CardElement,
  Divider,
  Field,
  type FieldElement,
  Fields,
  Image,
  Section,
  Text,
  type TextStyle,
} from "./cards";

// Symbol to identify our JSX elements before they're processed
const JSX_ELEMENT = Symbol.for("chat-sdk.jsx.element");

/**
 * Represents a JSX element from the chat-sdk JSX runtime.
 * This is the type returned when using JSX syntax with chat-sdk components.
 */
export interface CardJSXElement {
  $$typeof: typeof JSX_ELEMENT;
  type: CardComponentFunction;
  props: Record<string, unknown>;
  children: unknown[];
}

// Internal alias for backwards compatibility
type JSXElement = CardJSXElement;

// biome-ignore lint/suspicious/noExplicitAny: Card builder functions have varying signatures
type CardComponentFunction = (...args: any[]) => CardElement | CardChild;

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

/** Non-null card element for children arrays */
type CardChildOrNested = CardChild | ButtonElement | FieldElement;

/**
 * Process children, converting JSX elements to card elements.
 */
function processChildren(children: unknown): CardChildOrNested[] {
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
      return [resolved as CardChildOrNested];
    }
    return [];
  }

  // If it's already a card element, return it
  if (typeof children === "object" && "type" in children) {
    return [children as CardChildOrNested];
  }

  // If it's a string, it might be text content for a Button
  if (typeof children === "string") {
    // Return as-is, the component will handle it
    return [children as unknown as CardChildOrNested];
  }

  return [];
}

/** Any card element type that can be created */
type AnyCardElement =
  | CardElement
  | CardChild
  | ButtonElement
  | FieldElement
  | null;

/**
 * Resolve a JSX element by calling its component function.
 * Transforms JSX props into the format each builder function expects.
 */
function resolveJSXElement(element: JSXElement): AnyCardElement {
  const { type, props, children } = element;

  // Process children first
  const processedChildren = processChildren(children);

  // Use identity comparison to determine which builder function this is
  // This is necessary because function names get minified in production builds
  // Cast to unknown first to allow comparison between different function types
  const fn = type as unknown;

  if (fn === Text) {
    // Text(content: string, options?: { style })
    // JSX children become the content string
    const content =
      processedChildren.length > 0
        ? String(processedChildren[0])
        : ((props.children as string) ?? "");
    return Text(content, { style: props.style as TextStyle | undefined });
  }

  if (fn === Section) {
    // Section takes array as first argument
    return Section(processedChildren as CardChild[]);
  }

  if (fn === Actions) {
    // Actions takes array of ButtonElements
    return Actions(processedChildren as unknown as ButtonElement[]);
  }

  if (fn === Fields) {
    // Fields takes array of FieldElements
    return Fields(processedChildren as unknown as FieldElement[]);
  }

  if (fn === Button) {
    // Button({ id, label, style, value })
    // JSX children become the label
    const label =
      processedChildren.length > 0
        ? String(processedChildren[0])
        : ((props.label as string) ?? "");
    return Button({
      id: props.id as string,
      label,
      style: props.style as ButtonElement["style"],
      value: props.value as string | undefined,
    });
  }

  if (fn === Image) {
    // Image({ url, alt })
    return Image({ url: props.url as string, alt: props.alt as string });
  }

  if (fn === Field) {
    // Field({ label, value })
    return Field({
      label: props.label as string,
      value: props.value as string,
    });
  }

  if (fn === Divider) {
    // Divider() - no args
    return Divider();
  }

  // Default: Card({ title, subtitle, imageUrl, children })
  // Pass props with processed children
  return type({
    ...props,
    children: processedChildren,
  });
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
    children: Array.isArray(children)
      ? children
      : children != null
        ? [children]
        : [],
  };
}

/**
 * Development JSX factory (same as jsx, but called in dev mode).
 */
export const jsxDEV = jsx;

/**
 * Fragment support (flattens children).
 */
export function Fragment(props: { children?: unknown }): CardChild[] {
  return processChildren(props.children) as CardChild[];
}

/**
 * Convert a JSX element tree to a CardElement.
 * Call this on the root JSX element to get a usable CardElement.
 */
export function toCardElement(jsxElement: unknown): CardElement | null {
  if (isJSXElement(jsxElement)) {
    const resolved = resolveJSXElement(jsxElement);
    if (
      resolved &&
      typeof resolved === "object" &&
      "type" in resolved &&
      resolved.type === "card"
    ) {
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
    return (
      symbolStr.includes("react.element") ||
      symbolStr.includes("react.transitional.element")
    );
  }
  return false;
}

// Re-export for JSX namespace
export namespace JSX {
  export interface Element extends JSXElement {}
  // biome-ignore lint/complexity/noBannedTypes: Required for JSX namespace
  export type IntrinsicElements = {};
  export interface ElementChildrenAttribute {
    // biome-ignore lint/complexity/noBannedTypes: Required for JSX children attribute
    children: {};
  }
}
