/**
 * A small XML parser and serializer covering the subset of XML that KeePass
 * produces: elements, attributes, text, CDATA sections, comments, and the XML
 * declaration. It does not support namespaces, DTD validation, or processing
 * instructions beyond the declaration — none of which appear in KDBX documents.
 *
 * `DOMParser`/`XMLSerializer` are not available outside browsers, so this keeps
 * the package isomorphic and dependency-free.
 */

/** A parsed XML element. */
export interface XmlElement {
  readonly type: 'element';
  name: string;
  /** Attributes in document order. */
  attributes: Array<[string, string]>;
  children: XmlNode[];
}

/** A parsed run of text (possibly originating from a CDATA section). */
export interface XmlText {
  readonly type: 'text';
  value: string;
  cdata: boolean;
}

export type XmlNode = XmlElement | XmlText;

const KX_NAME_END = new Set([' ', '\t', '\r', '\n', '/', '>', '=']);

function kx_decodeEntities(text: string): string {
  if (!text.includes('&')) {
    return text;
  }
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, body: string) => {
    switch (body) {
      case 'amp':
        return '&';
      case 'lt':
        return '<';
      case 'gt':
        return '>';
      case 'quot':
        return '"';
      case 'apos':
        return "'";
      default:
        if (body.startsWith('#x') || body.startsWith('#X')) {
          return String.fromCodePoint(Number.parseInt(body.slice(2), 16));
        }
        if (body.startsWith('#')) {
          return String.fromCodePoint(Number.parseInt(body.slice(1), 10));
        }
        return match;
    }
  });
}

class KX_XmlParser {
  readonly #s: string;
  #i = 0;

  constructor(source: string) {
    this.#s = source;
  }

  parse(): XmlElement {
    this.#skipProlog();
    const root = this.#parseElement();
    return root;
  }

  #skipWhitespace(): void {
    while (this.#i < this.#s.length) {
      const ch = this.#s[this.#i];
      if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n') {
        this.#i += 1;
      } else {
        break;
      }
    }
  }

  #skipProlog(): void {
    for (;;) {
      this.#skipWhitespace();
      if (this.#s.startsWith('<?', this.#i)) {
        this.#i = this.#s.indexOf('?>', this.#i) + 2;
      } else if (this.#s.startsWith('<!--', this.#i)) {
        this.#i = this.#s.indexOf('-->', this.#i) + 3;
      } else if (this.#s.startsWith('<!', this.#i)) {
        this.#i = this.#s.indexOf('>', this.#i) + 1;
      } else {
        break;
      }
    }
  }

  #readName(): string {
    const start = this.#i;
    while (this.#i < this.#s.length && !KX_NAME_END.has(this.#s[this.#i] ?? '')) {
      this.#i += 1;
    }
    return this.#s.slice(start, this.#i);
  }

  #parseElement(): XmlElement {
    if (this.#s[this.#i] !== '<') {
      throw new Error(`expected '<' at offset ${this.#i}`);
    }
    this.#i += 1;
    const name = this.#readName();
    const attributes = this.#parseAttributes();

    if (this.#s.startsWith('/>', this.#i)) {
      this.#i += 2;
      return { type: 'element', name, attributes, children: [] };
    }
    if (this.#s[this.#i] !== '>') {
      throw new Error(`malformed start tag for <${name}>`);
    }
    this.#i += 1;

    const children = this.#parseChildren(name);
    return { type: 'element', name, attributes, children: kx_canonicalize(children) };
  }

  #parseAttributes(): Array<[string, string]> {
    const attributes: Array<[string, string]> = [];
    for (;;) {
      this.#skipWhitespace();
      const ch = this.#s[this.#i];
      if (ch === '>' || ch === '/' || ch === undefined) {
        return attributes;
      }
      const name = this.#readName();
      this.#skipWhitespace();
      if (this.#s[this.#i] !== '=') {
        throw new Error(`expected '=' after attribute ${name}`);
      }
      this.#i += 1;
      this.#skipWhitespace();
      const quote = this.#s[this.#i];
      if (quote !== '"' && quote !== "'") {
        throw new Error(`expected quoted value for attribute ${name}`);
      }
      this.#i += 1;
      const start = this.#i;
      this.#i = this.#s.indexOf(quote, this.#i);
      if (this.#i < 0) {
        throw new Error(`unterminated attribute value for ${name}`);
      }
      const value = kx_decodeEntities(this.#s.slice(start, this.#i));
      this.#i += 1;
      attributes.push([name, value]);
    }
  }

  #parseChildren(name: string): XmlNode[] {
    const children: XmlNode[] = [];
    for (;;) {
      if (this.#i >= this.#s.length) {
        throw new Error(`unexpected end of document inside <${name}>`);
      }
      if (this.#s.startsWith('</', this.#i)) {
        this.#i += 2;
        const closeName = this.#readName();
        if (closeName !== name) {
          throw new Error(`mismatched closing tag </${closeName}> for <${name}>`);
        }
        this.#i = this.#s.indexOf('>', this.#i) + 1;
        return children;
      }
      if (this.#s.startsWith('<!--', this.#i)) {
        this.#i = this.#s.indexOf('-->', this.#i) + 3;
        continue;
      }
      if (this.#s.startsWith('<![CDATA[', this.#i)) {
        const start = this.#i + 9;
        const end = this.#s.indexOf(']]>', start);
        children.push({ type: 'text', value: this.#s.slice(start, end), cdata: true });
        this.#i = end + 3;
        continue;
      }
      if (this.#s[this.#i] === '<') {
        children.push(this.#parseElement());
        continue;
      }
      const start = this.#i;
      this.#i = this.#s.indexOf('<', this.#i);
      children.push({
        type: 'text',
        value: kx_decodeEntities(this.#s.slice(start, this.#i)),
        cdata: false,
      });
    }
  }
}

/**
 * Remove insignificant whitespace: when an element has element children, any
 * whitespace-only text between them is layout, not content, and is dropped so
 * that parsing pretty-printed XML yields a canonical tree.
 */
function kx_canonicalize(children: XmlNode[]): XmlNode[] {
  const hasElement = children.some((child) => child.type === 'element');
  if (!hasElement) {
    return children;
  }
  return children.filter(
    (child) => child.type === 'element' || (child.type === 'text' && child.value.trim() !== ''),
  );
}

/** Parse an XML document, returning its root element. */
export function parseXml(source: string): XmlElement {
  return new KX_XmlParser(source).parse();
}

function kx_escapeText(value: string): string {
  return value.replace(/[&<>]/g, (ch) => (ch === '&' ? '&amp;' : ch === '<' ? '&lt;' : '&gt;'));
}

function kx_escapeAttribute(value: string): string {
  return value.replace(/[&<"]/g, (ch) => (ch === '&' ? '&amp;' : ch === '<' ? '&lt;' : '&quot;'));
}

function kx_serializeAttributes(attributes: Array<[string, string]>): string {
  let out = '';
  for (const [name, value] of attributes) {
    out += ` ${name}="${kx_escapeAttribute(value)}"`;
  }
  return out;
}

function kx_serializeElement(element: XmlElement, depth: number, out: string[]): void {
  const indent = '  '.repeat(depth);
  const attrs = kx_serializeAttributes(element.attributes);

  if (element.children.length === 0) {
    out.push(`${indent}<${element.name}${attrs}/>\n`);
    return;
  }

  const onlyText = element.children.every((child) => child.type === 'text');
  if (onlyText) {
    const text = element.children.map((child) => (child as XmlText).value).join('');
    out.push(`${indent}<${element.name}${attrs}>${kx_escapeText(text)}</${element.name}>\n`);
    return;
  }

  out.push(`${indent}<${element.name}${attrs}>\n`);
  for (const child of element.children) {
    if (child.type === 'element') {
      kx_serializeElement(child, depth + 1, out);
    } else if (child.value.trim() !== '') {
      out.push(`${'  '.repeat(depth + 1)}${kx_escapeText(child.value)}\n`);
    }
  }
  out.push(`${indent}</${element.name}>\n`);
}

/** Serialize an element tree to an XML document string (with declaration). */
export function serializeXml(root: XmlElement): string {
  const out = ['<?xml version="1.0" encoding="utf-8" standalone="yes"?>\n'];
  kx_serializeElement(root, 0, out);
  return out.join('');
}
