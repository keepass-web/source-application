/**
 * Convenience helpers over the KDBX XML tree: element navigation, protected
 * values, the document-order protection walk, and builders for creating a new
 * database, groups, and entries.
 *
 * The canonical state of a database is its XML tree. Sensitive `<Value>`
 * elements are marked `Protected="True"`; in memory they hold plaintext, and
 * they are (re-)encrypted against the inner random stream only when saving.
 */

import { fromBase64, toBase64, utf8Decode, utf8Encode } from './bytes.ts';
import { getRandomBytes } from './crypto.ts';
import type { ProtectedStreamCipher } from './protected-stream.ts';
import type { XmlElement, XmlNode } from './xml.ts';

const KX_PROTECTED_ATTRIBUTE = 'Protected';
const KX_GENERATOR = 'keepass-web';

/** A value that is encrypted by the inner random stream when stored on disk. */
export class ProtectedValue {
  readonly #text: string;

  constructor(text: string) {
    this.#text = text;
  }

  static fromString(text: string): ProtectedValue {
    return new ProtectedValue(text);
  }

  get text(): string {
    return this.#text;
  }

  toString(): string {
    return this.#text;
  }
}

// --- Element construction and navigation ------------------------------------

/** Create an element, optionally with a single text child. */
export function createElement(name: string, text?: string): XmlElement {
  const element: XmlElement = { type: 'element', name, attributes: [], children: [] };
  if (text !== undefined) {
    setText(element, text);
  }
  return element;
}

/** First direct child element with the given name. */
export function getChild(element: XmlElement, name: string): XmlElement | undefined {
  for (const child of element.children) {
    if (child.type === 'element' && child.name === name) {
      return child;
    }
  }
  return undefined;
}

/** All direct child elements with the given name. */
export function getChildren(element: XmlElement, name: string): XmlElement[] {
  const out: XmlElement[] = [];
  for (const child of element.children) {
    if (child.type === 'element' && child.name === name) {
      out.push(child);
    }
  }
  return out;
}

/** Concatenated text content of an element. */
export function getText(element: XmlElement): string {
  let text = '';
  for (const child of element.children) {
    if (child.type === 'text') {
      text += child.value;
    }
  }
  return text;
}

/** Replace an element's children with a single text node. */
export function setText(element: XmlElement, text: string): void {
  element.children = [{ type: 'text', value: text, cdata: false }];
}

/** Value of a named attribute, or `undefined`. */
export function getAttribute(element: XmlElement, name: string): string | undefined {
  for (const [attr, value] of element.attributes) {
    if (attr === name) {
      return value;
    }
  }
  return undefined;
}

/** Set (or replace) a named attribute. */
export function setAttribute(element: XmlElement, name: string, value: string): void {
  for (const pair of element.attributes) {
    if (pair[0] === name) {
      pair[1] = value;
      return;
    }
  }
  element.attributes.push([name, value]);
}

/** Append a child node and return the parent. */
export function appendChild(parent: XmlElement, child: XmlNode): XmlElement {
  parent.children.push(child);
  return parent;
}

/** Deep-clone an element tree. */
export function cloneElement(element: XmlElement): XmlElement {
  return {
    type: 'element',
    name: element.name,
    attributes: element.attributes.map(([k, v]) => [k, v] as [string, string]),
    children: element.children.map((child) =>
      child.type === 'element' ? cloneElement(child) : { ...child },
    ),
  };
}

// --- Inner-stream protection ------------------------------------------------

function kx_walkProtected(element: XmlElement, visit: (el: XmlElement) => void): void {
  if (getAttribute(element, KX_PROTECTED_ATTRIBUTE) === 'True') {
    visit(element);
  }
  for (const child of element.children) {
    if (child.type === 'element') {
      kx_walkProtected(child, visit);
    }
  }
}

/**
 * Decrypt every `Protected="True"` value in document order, replacing the
 * Base64 ciphertext with plaintext (the marker attribute is kept).
 */
export function applyInboundProtection(root: XmlElement, cipher: ProtectedStreamCipher): void {
  kx_walkProtected(root, (element) => {
    const ciphertext = fromBase64(getText(element));
    setText(element, utf8Decode(cipher.process(ciphertext)));
  });
}

/**
 * Encrypt every `Protected="True"` value in document order, replacing plaintext
 * with Base64 ciphertext. Operate on a clone so the in-memory tree stays
 * readable.
 */
export function applyOutboundProtection(root: XmlElement, cipher: ProtectedStreamCipher): void {
  kx_walkProtected(root, (element) => {
    const ciphertext = cipher.process(utf8Encode(getText(element)));
    setText(element, toBase64(ciphertext));
  });
}

// --- Builders ---------------------------------------------------------------

function kx_nowIso(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function kx_newUuid(): string {
  return toBase64(getRandomBytes(16));
}

function kx_createTimes(): XmlElement {
  const now = kx_nowIso();
  const times = createElement('Times');
  for (const field of [
    'LastModificationTime',
    'CreationTime',
    'LastAccessTime',
    'ExpiryTime',
    'LocationChanged',
  ]) {
    appendChild(times, createElement(field, now));
  }
  appendChild(times, createElement('Expires', 'False'));
  appendChild(times, createElement('UsageCount', '0'));
  return times;
}

/** A field on a new entry. */
export interface EntryField {
  key: string;
  value: string;
  protect?: boolean;
}

/** Standard fields recognised by {@link createEntry}. */
export interface EntryInput {
  title?: string;
  username?: string;
  password?: string;
  url?: string;
  notes?: string;
  /** Additional custom string fields. */
  fields?: EntryField[];
}

function kx_createStringField(field: EntryField): XmlElement {
  const string = createElement('String');
  appendChild(string, createElement('Key', field.key));
  const value = createElement('Value', field.value);
  if (field.protect) {
    setAttribute(value, KX_PROTECTED_ATTRIBUTE, 'True');
  }
  appendChild(string, value);
  return string;
}

/** Build an `<Entry>` element from the given fields. */
export function createEntry(input: EntryInput): XmlElement {
  const entry = createElement('Entry');
  appendChild(entry, createElement('UUID', kx_newUuid()));
  appendChild(entry, createElement('IconID', '0'));
  appendChild(entry, kx_createTimes());

  const fields: EntryField[] = [
    { key: 'Title', value: input.title ?? '' },
    { key: 'UserName', value: input.username ?? '' },
    { key: 'Password', value: input.password ?? '', protect: true },
    { key: 'URL', value: input.url ?? '' },
    { key: 'Notes', value: input.notes ?? '' },
    ...(input.fields ?? []),
  ];
  for (const field of fields) {
    appendChild(entry, kx_createStringField(field));
  }
  return entry;
}

/**
 * An entry's tags, from its `<Tags>` element — KeePass's own `;`-joined
 * text format. Empty (`[]`) when the element is absent, matching how real
 * KeePass omits it entirely on a tagless entry rather than writing an empty
 * one.
 */
export function getEntryTags(entry: XmlElement): string[] {
  const tagsEl = getChild(entry, 'Tags');
  if (!tagsEl) return [];
  return getText(tagsEl)
    .split(';')
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0);
}

/**
 * Replace an entry's tags. An empty list removes the `<Tags>` element
 * entirely rather than leaving one with empty text, matching real KeePass.
 */
export function setEntryTags(entry: XmlElement, tags: string[]): void {
  const cleaned = tags.map((tag) => tag.trim()).filter((tag) => tag.length > 0);
  const existing = getChild(entry, 'Tags');

  if (cleaned.length === 0) {
    if (existing) {
      entry.children = entry.children.filter((child) => child !== existing);
    }
    return;
  }

  const text = cleaned.join(';');
  if (existing) {
    setText(existing, text);
  } else {
    appendChild(entry, createElement('Tags', text));
  }
}

/** An entry's Times, as plain data — ISO-UTC timestamps, KeePass's own
 * on-disk format. Fields are `''`/`false` when the Times element (or a
 * field within it) is missing, e.g. from a hand-built or malformed entry. */
export interface EntryTimes {
  created: string;
  modified: string;
  expires: boolean;
  expiryTime: string;
}

export function getEntryTimes(entry: XmlElement): EntryTimes {
  const times = getChild(entry, 'Times');
  const read = (name: string): string => {
    const field = times && getChild(times, name);
    return field ? getText(field) : '';
  };
  return {
    created: read('CreationTime'),
    modified: read('LastModificationTime'),
    expires: read('Expires') === 'True',
    expiryTime: read('ExpiryTime'),
  };
}

/**
 * Update an entry's expiration. `expiryTimeIso`, if given, replaces
 * ExpiryTime; an empty string leaves the existing ExpiryTime untouched
 * (e.g. when the caller only means to flip Expires off). Does nothing on an
 * entry with no Times element at all.
 */
export function setEntryExpiry(entry: XmlElement, expires: boolean, expiryTimeIso: string): void {
  const times = getChild(entry, 'Times');
  if (!times) return;

  const expiresEl = getChild(times, 'Expires');
  if (expiresEl) setText(expiresEl, expires ? 'True' : 'False');

  if (expiryTimeIso) {
    const expiryTimeEl = getChild(times, 'ExpiryTime');
    if (expiryTimeEl) setText(expiryTimeEl, expiryTimeIso);
  }
}

/** Bump an entry's LastModificationTime to now — real KeePass does this on
 * every edit; this app's own applyEntryEdits() only ever touched fields. */
export function touchLastModified(entry: XmlElement): void {
  const times = getChild(entry, 'Times');
  const modEl = times && getChild(times, 'LastModificationTime');
  if (modEl) setText(modEl, kx_nowIso());
}

/** Build a `<Group>` element with the given name. */
export function createGroup(name: string): XmlElement {
  const group = createElement('Group');
  appendChild(group, createElement('UUID', kx_newUuid()));
  appendChild(group, createElement('Name', name));
  appendChild(group, createElement('IconID', '49'));
  appendChild(group, kx_createTimes());
  return group;
}

const KX_RECYCLE_BIN_NAME = 'Recycle Bin';

function kx_findGroupByUuid(group: XmlElement, uuid: string): XmlElement | undefined {
  const idEl = getChild(group, 'UUID');
  if (idEl && getText(idEl) === uuid) {
    return group;
  }
  for (const sub of getChildren(group, 'Group')) {
    const found = kx_findGroupByUuid(sub, uuid);
    if (found) return found;
  }
  return undefined;
}

function kx_containsGroup(ancestor: XmlElement, target: XmlElement): boolean {
  if (ancestor === target) return true;
  return getChildren(ancestor, 'Group').some((sub) => kx_containsGroup(sub, target));
}

/** The database's recycle bin group, if `Meta/RecycleBinUUID` names one that still exists. */
function kx_findRecycleBin(document: XmlElement): XmlElement | undefined {
  const meta = getChild(document, 'Meta');
  const uuidEl = meta && getChild(meta, 'RecycleBinUUID');
  const rootElement = getChild(document, 'Root');
  const rootGroup = rootElement && getChild(rootElement, 'Group');
  if (!uuidEl || !rootGroup) return undefined;
  return kx_findGroupByUuid(rootGroup, getText(uuidEl));
}

/**
 * Find the database's recycle bin group, creating it as a child of the root
 * group the first time anything is trashed and recording its UUID in
 * `Meta/RecycleBinUUID` — matching real KeePass, which has no recycle bin
 * group in a fresh database until one is needed.
 */
export function findOrCreateRecycleBin(document: XmlElement): XmlElement {
  const existing = kx_findRecycleBin(document);
  if (existing) return existing;

  const meta = getChild(document, 'Meta');
  const rootElement = getChild(document, 'Root');
  const rootGroup = rootElement && getChild(rootElement, 'Group');
  if (!meta || !rootGroup) {
    throw new Error('database is missing Meta or a root group');
  }

  const bin = createGroup(KX_RECYCLE_BIN_NAME);
  appendChild(rootGroup, bin);
  // createGroup() always appends a UUID child first, so this is always present.
  const binUuid = getText(getChild(bin, 'UUID') as XmlElement);

  const uuidEl = getChild(meta, 'RecycleBinUUID');
  if (uuidEl) {
    setText(uuidEl, binUuid);
  } else {
    appendChild(meta, createElement('RecycleBinUUID', binUuid));
  }
  return bin;
}

/** True if `group` is the database's recycle bin, or nested inside it. */
export function isInRecycleBin(document: XmlElement, group: XmlElement): boolean {
  const bin = kx_findRecycleBin(document);
  return bin !== undefined && kx_containsGroup(bin, group);
}

/**
 * Build a complete `<KeePassFile>` document with a Meta section and a root group
 * (optionally pre-populated by `build`).
 */
export function createDatabaseDocument(
  databaseName: string,
  build?: (rootGroup: XmlElement) => void,
): XmlElement {
  const root = createElement('KeePassFile');

  const meta = createElement('Meta');
  appendChild(meta, createElement('Generator', KX_GENERATOR));
  appendChild(meta, createElement('DatabaseName', databaseName));
  appendChild(meta, createElement('DatabaseNameChanged', kx_nowIso()));
  appendChild(meta, createElement('RecycleBinEnabled', 'True'));
  appendChild(meta, createElement('HistoryMaxItems', '10'));
  appendChild(root, meta);

  const rootElement = createElement('Root');
  const rootGroup = createGroup(databaseName);
  build?.(rootGroup);
  appendChild(rootElement, rootGroup);
  appendChild(root, rootElement);

  return root;
}
