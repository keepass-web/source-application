/**
 * Ambient declarations for the globals bundle.js injects into the page.
 *
 * bundle.js concatenates the kdbx library, this page's own pure logic
 * (entryField, groupPathTo, etc., extracted from page.ts into logic.ts so it
 * can be unit tested without a DOM), and page.ts's own compiled output into
 * one IIFE — see bundle-iife.json's "files" list. It also exposes these
 * names as globals via `globalThis.<name> = <name>`, one entry per name in
 * bundle-iife.json's "exports" list, matching what
 * pages/tests/0x67-page.test.ts sets up by hand.
 *
 * This file exists only so page.ts can be type-checked against that surface;
 * it declares only the members page.ts actually calls, mirroring the
 * corresponding signatures in packages/kdbx/src and in logic.ts.
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

interface KdbxCreateOptions {
  databaseName?: string;
}

declare class Kdbx {
  root: XmlElement;
  getRootGroup(): XmlElement;
  save(): Promise<Uint8Array>;
  static load(data: Uint8Array, credentials: Credentials): Promise<Kdbx>;
  static create(credentials: Credentials, options?: KdbxCreateOptions): Promise<Kdbx>;
}

declare function getChildren(element: XmlElement, name: string): XmlElement[];
declare function getChild(element: XmlElement, name: string): XmlElement | undefined;
declare function getText(element: XmlElement): string;
declare function getAttribute(element: XmlElement, name: string): string | undefined;
declare function setAttribute(element: XmlElement, name: string, value: string): void;
declare function createElement(name: string, text?: string): XmlElement;
declare function appendChild(parent: XmlElement, child: XmlNode): XmlElement;
declare function setText(element: XmlElement, text: string): void;

interface EntryInput {
  title?: string;
}

declare function createEntry(input: EntryInput): XmlElement;
declare function createGroup(name: string): XmlElement;
declare function findOrCreateRecycleBin(document: XmlElement): XmlElement;
declare function isInRecycleBin(document: XmlElement, group: XmlElement): boolean;
declare function getEntryTags(entry: XmlElement): string[];
declare function setEntryTags(entry: XmlElement, tags: string[]): void;

// --- this page's own pure logic (see logic.ts) ---

interface EntryWithGroup {
  entry: XmlElement;
  group: XmlElement;
}

declare function entryField(entry: XmlElement, key: string): string;
declare function entryTitle(entry: XmlElement): string;
declare function groupName(group: XmlElement): string;
declare function findEntryParent(rootGroup: XmlElement, entry: XmlElement): XmlElement | null;
declare function collectAllEntries(group: XmlElement, results?: EntryWithGroup[]): EntryWithGroup[];
declare function groupPathTo(
  rootGroup: XmlElement,
  target: XmlElement,
  path?: string[],
): string[] | null;
declare function filterEntriesByQuery(entries: EntryWithGroup[], query: string): EntryWithGroup[];

interface EditedField {
  key: string;
  value: string;
  protect: boolean;
}

declare function applyEntryEdits(entry: XmlElement, fields: EditedField[]): void;
declare function isCustomField(key: string): boolean;
declare function isValidClipboardTimeout(seconds: number): boolean;

interface PasswordGeneratorOptions {
  length: number;
  upper?: boolean;
  lower?: boolean;
  digits?: boolean;
  symbols?: boolean;
}

declare function generatePassword(options: PasswordGeneratorOptions): string;

declare function elementIconId(element: XmlElement): string;
declare function iconEmoji(iconId: string): string;
declare const ICON_PALETTE: ReadonlyArray<{ id: number; emoji: string; label: string }>;
