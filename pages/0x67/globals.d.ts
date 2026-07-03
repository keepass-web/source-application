/**
 * Ambient declarations for the globals deps.js injects into the page.
 *
 * deps.js is the bundled kdbx library (see bundle-iife.json): it loads before
 * page.js in the same concatenated <script> tag and exposes these names as
 * globals via `globalThis.<name> = <name>` for each entry in bundle-iife.json's
 * "exports" list. This file exists only so page.ts can be type-checked against
 * that surface; it declares only the members page.ts actually calls, mirroring
 * the corresponding signatures in packages/kdbx/src.
 */

interface XmlElement {
  readonly type: 'element';
  name: string;
  attributes: Array<[string, string]>;
  children: XmlNode[];
}

interface XmlText {
  readonly type: 'text';
  value: string;
  cdata: boolean;
}

type XmlNode = XmlElement | XmlText;

interface CredentialsInput {
  password?: string | Uint8Array;
  keyFile?: Uint8Array;
}

declare class Credentials {
  constructor(input: CredentialsInput);
}

declare class Kdbx {
  getRootGroup(): XmlElement;
  save(): Promise<Uint8Array>;
  static load(data: Uint8Array, credentials: Credentials): Promise<Kdbx>;
}

declare function getChildren(element: XmlElement, name: string): XmlElement[];
declare function getChild(element: XmlElement, name: string): XmlElement | undefined;
declare function getText(element: XmlElement): string;
declare function getAttribute(element: XmlElement, name: string): string | undefined;
declare function setAttribute(element: XmlElement, name: string, value: string): void;
declare function createElement(name: string, text?: string): XmlElement;
declare function appendChild(parent: XmlElement, child: XmlNode): XmlElement;

interface EntryInput {
  title?: string;
}

declare function createEntry(input: EntryInput): XmlElement;
declare function createGroup(name: string): XmlElement;
