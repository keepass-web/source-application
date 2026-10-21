/** Helpers over the KDBX XML tree: navigation, protected-value (de)cryption,
and builders for new databases, groups, and entries. `Protected="True"`
values hold plaintext in memory and are encrypted only on save. */

import { fromBase64, toBase64, utf8Decode, utf8Encode } from './bytes.ts';
import { getRandomBytes } from './crypto.ts';
import type { InnerBinary } from './inner-header.ts';
import type { ProtectedStreamCipher } from './protected-stream.ts';
import type { XmlElement, XmlNode } from './xml.ts';

const KX_PROTECTED_ATTRIBUTE = 'Protected';
const KX_GENERATOR = 'KeePass Web';

// A value that is encrypted by the inner random stream when stored on disk.
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

// Create an element, optionally with a single text child.
export function createElement(name: string, text?: string): XmlElement {
  const element: XmlElement = { type: 'element', name, attributes: [], children: [] };
  if (text !== undefined) {
    setText(element, text);
  }
  return element;
}

// First direct child element with the given name.
export function getChild(element: XmlElement, name: string): XmlElement | undefined {
  for (const child of element.children) {
    if (child.type === 'element' && child.name === name) {
      return child;
    }
  }
  return undefined;
}

// All direct child elements with the given name.
export function getChildren(element: XmlElement, name: string): XmlElement[] {
  const out: XmlElement[] = [];
  for (const child of element.children) {
    if (child.type === 'element' && child.name === name) {
      out.push(child);
    }
  }
  return out;
}

// Concatenated text content of an element.
export function getText(element: XmlElement): string {
  let text = '';
  for (const child of element.children) {
    if (child.type === 'text') {
      text += child.value;
    }
  }
  return text;
}

// Replace an element's children with a single text node.
export function setText(element: XmlElement, text: string): void {
  element.children = [{ type: 'text', value: text, cdata: false }];
}

// Value of a named attribute, or `undefined`.
export function getAttribute(element: XmlElement, name: string): string | undefined {
  for (const [attr, value] of element.attributes) {
    if (attr === name) {
      return value;
    }
  }
  return undefined;
}

// Set the text of `parent`'s named child, adding the child if it is absent.
export function setChildText(parent: XmlElement, name: string, text: string): void {
  const child = getChild(parent, name);
  if (child) {
    setText(child, text);
  } else {
    appendChild(parent, createElement(name, text));
  }
}

// Set (or replace) a named attribute.
export function setAttribute(element: XmlElement, name: string, value: string): void {
  for (const pair of element.attributes) {
    if (pair[0] === name) {
      pair[1] = value;
      return;
    }
  }
  element.attributes.push([name, value]);
}

// Append a child node and return the parent.
export function appendChild(parent: XmlElement, child: XmlNode): XmlElement {
  parent.children.push(child);
  return parent;
}

// Deep-clone an element tree.
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

/** Decrypt every `Protected="True"` value in document order, replacing the
Base64 ciphertext with plaintext (the marker attribute is kept). */
export function applyInboundProtection(root: XmlElement, cipher: ProtectedStreamCipher): void {
  kx_walkProtected(root, (element) => {
    const ciphertext = fromBase64(getText(element));
    setText(element, utf8Decode(cipher.process(ciphertext)));
  });
}

// Encrypts every Protected="True" value in place; call on a clone to keep the original readable.
export function applyOutboundProtection(root: XmlElement, cipher: ProtectedStreamCipher): void {
  kx_walkProtected(root, (element) => {
    const ciphertext = cipher.process(utf8Encode(getText(element)));
    setText(element, toBase64(ciphertext));
  });
}

// Plain XML has no inner stream, so KeePass marks a protected value ProtectInMemory there instead (#137).
export function markProtectedInMemory(root: XmlElement): void {
  kx_walkProtected(root, (element) => {
    element.attributes = element.attributes.filter(([name]) => name !== KX_PROTECTED_ATTRIBUTE);
    setAttribute(element, 'ProtectInMemory', 'True');
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

// A field on a new entry.
export interface EntryField {
  key: string;
  value: string;
  protect?: boolean;
}

// Standard fields recognised by {@link createEntry}.
export interface EntryInput {
  title?: string;
  username?: string;
  password?: string;
  url?: string;
  notes?: string;
  // Additional custom string fields.
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

// Build an `<Entry>` element from the given fields.
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

// An entry's tags from <Tags>; [] if absent, matching real KeePass.
export function getEntryTags(entry: XmlElement): string[] {
  const tagsEl = getChild(entry, 'Tags');
  if (!tagsEl) return [];
  return getText(tagsEl)
    .split(/[,;\t]/) // KeePassXC writes commas and KeePass semicolons (#130)
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0);
}

// Replace an entry's tags; an empty list removes <Tags> entirely, matching KeePass.
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

// An entry's Times as plain ISO-UTC data; fields default to ''/false if missing.
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

// Update expiration; blank expiryTimeIso keeps ExpiryTime. No-op without a Times element.
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

// Set one of an entry's or group's Times, adding it if the file left it out; no-op without Times.
function kx_setTime(element: XmlElement, name: string, iso: string): void {
  const times = getChild(element, 'Times');
  if (times) setChildText(times, name, iso);
}

// Set one of Meta's *Changed times to now, adding it if the file left it out; no-op without Meta.
export function touchMetaTime(document: XmlElement, name: string): void {
  const meta = getChild(document, 'Meta');
  if (meta) setChildText(meta, name, kx_nowIso());
}

// Name this app as the writer, so a file names whoever saved it last, as KeePass does (#136).
export function setGenerator(document: XmlElement): void {
  const meta = getChild(document, 'Meta');
  if (meta) setChildText(meta, 'Generator', KX_GENERATOR);
}

// Bump an entry's or group's LastModificationTime to now; merges keep the newer copy by it (#108).
export function touchLastModified(element: XmlElement): void {
  kx_setTime(element, 'LastModificationTime', kx_nowIso());
}

/** Move an entry or group between groups; merges place it by the newer LocationChanged
(#108), and a restore puts it back in the group it left, as KeePass and KeePassXC do (#133). */
export function moveToGroup(element: XmlElement, from: XmlElement, to: XmlElement): void {
  from.children = from.children.filter((child) => child !== element);
  appendChild(to, element);
  kx_setTime(element, 'LocationChanged', kx_nowIso());
  const fromUuid = getChild(from, 'UUID');
  if (fromUuid) setChildText(element, 'PreviousParentGroup', getText(fromUuid));
}

/** Remove an entry or group for good, recording it and every group and entry
under it in DeletedObjects so a merge elsewhere doesn't bring them back (#108). */
export function deletePermanently(
  document: XmlElement,
  element: XmlElement,
  from: XmlElement,
): void {
  const rootElement = getChild(document, 'Root');
  if (!rootElement) {
    throw new Error('database is missing a Root element');
  }
  let deleted = getChild(rootElement, 'DeletedObjects');
  if (!deleted) {
    deleted = createElement('DeletedObjects');
    appendChild(rootElement, deleted);
  }

  from.children = from.children.filter((child) => child !== element);
  const deletionTime = kx_nowIso();
  const record = (object: XmlElement): void => {
    const uuidEl = getChild(object, 'UUID');
    if (uuidEl) {
      const deletedObject = createElement('DeletedObject');
      appendChild(deletedObject, createElement('UUID', getText(uuidEl)));
      appendChild(deletedObject, createElement('DeletionTime', deletionTime));
      appendChild(deleted, deletedObject);
    }
    for (const child of [...getChildren(object, 'Entry'), ...getChildren(object, 'Group')]) {
      record(child);
    }
  };
  record(element);
}

// Visit every Entry under group, including History revisions (for finding Refs database-wide).
export function walkAllEntries(group: XmlElement, visit: (entry: XmlElement) => void): void {
  for (const entry of getChildren(group, 'Entry')) {
    visit(entry);
    for (const historyEntry of getEntryHistory(entry)) {
      visit(historyEntry);
    }
  }
  for (const sub of getChildren(group, 'Group')) {
    walkAllEntries(sub, visit);
  }
}

// An entry's attachment: a name paired with a Kdbx#binaries pool index.
export interface EntryAttachment {
  name: string;
  ref: number;
}

/** An entry's attachments from `<Binary>` children; `Ref` indexes
`Kdbx#binaries` (see meta-binaries.ts for 3.1's on-disk ID mapping). */
export function getEntryAttachments(entry: XmlElement): EntryAttachment[] {
  const out: EntryAttachment[] = [];
  for (const binaryEl of getChildren(entry, 'Binary')) {
    const keyEl = getChild(binaryEl, 'Key');
    const valueEl = getChild(binaryEl, 'Value');
    const refText = valueEl && getAttribute(valueEl, 'Ref');
    if (keyEl && refText !== undefined) {
      out.push({ name: getText(keyEl), ref: Number.parseInt(refText, 10) });
    }
  }
  return out;
}

// Attach a binary pool reference (see Kdbx#addBinary) to an entry under the given name.
export function addEntryAttachment(entry: XmlElement, name: string, ref: number): void {
  const binaryEl = createElement('Binary');
  appendChild(binaryEl, createElement('Key', name));
  const valueEl = createElement('Value');
  setAttribute(valueEl, 'Ref', String(ref));
  appendChild(binaryEl, valueEl);
  appendChild(entry, binaryEl);
}

// Rename an entry's attachment, matched by its current name.
export function renameEntryAttachment(entry: XmlElement, oldName: string, newName: string): void {
  for (const binaryEl of getChildren(entry, 'Binary')) {
    const keyEl = getChild(binaryEl, 'Key');
    if (keyEl && getText(keyEl) === oldName) {
      setText(keyEl, newName);
      return;
    }
  }
}

// Remove an entry's attachment by name; save() later drops unreferenced pool entries.
export function removeEntryAttachment(entry: XmlElement, name: string): void {
  entry.children = entry.children.filter((child) => {
    if (child.type !== 'element' || child.name !== 'Binary') return true;
    const keyEl = getChild(child, 'Key');
    return !(keyEl && getText(keyEl) === name);
  });
}

const KX_DEFAULT_HISTORY_MAX_ITEMS = 10;
const KX_DEFAULT_HISTORY_MAX_SIZE = 6 * 1024 * 1024; // KeePass's and KeePassXC's default, in bytes

// An entry's past versions from <History>, oldest first; [] if none.
export function getEntryHistory(entry: XmlElement): XmlElement[] {
  const historyEl = getChild(entry, 'History');
  return historyEl ? getChildren(historyEl, 'Entry') : [];
}

// A whole number from Meta, `fallback` when the file leaves it out, or Infinity when it sets no limit.
function kx_historyLimit(document: XmlElement, name: string, fallback: number): number {
  const meta = getChild(document, 'Meta');
  const limitEl = meta && getChild(meta, name);
  const limit = limitEl ? Number.parseInt(getText(limitEl), 10) : fallback;
  return Number.isFinite(limit) && limit >= 0 ? limit : Number.POSITIVE_INFINITY;
}

/** A History version's size as KeePassXC counts it toward HistoryMaxSize (#135): the
UTF-8 bytes of its fields, attachment names and data, tags, auto-type and custom data. */
function kx_historyVersionSize(version: XmlElement, binaries: InnerBinary[]): number {
  const bytes = (text: string): number => utf8Encode(text).length;
  const childBytes = (element: XmlElement, name: string): number => {
    const child = getChild(element, name);
    return child ? bytes(getText(child)) : 0;
  };
  let size = 0;
  for (const string of getChildren(version, 'String')) {
    size += childBytes(string, 'Key') + childBytes(string, 'Value');
  }
  for (const { name, ref } of getEntryAttachments(version)) {
    size += bytes(name) + (binaries[ref]?.data.length ?? 0);
  }
  for (const tag of getEntryTags(version)) size += bytes(tag);
  const autoType = getChild(version, 'AutoType');
  for (const association of autoType ? getChildren(autoType, 'Association') : []) {
    size += childBytes(association, 'Window') + childBytes(association, 'KeystrokeSequence');
  }
  const customData = getChild(version, 'CustomData');
  for (const item of customData ? getChildren(customData, 'Item') : []) {
    size += childBytes(item, 'Key') + childBytes(item, 'Value');
  }
  return size;
}

/** Trim an entry's History as KeePassXC does whenever it grows: newest first, a version
goes, with all older ones, once it passes HistoryMaxItems or takes the total past
HistoryMaxSize (#135). */
export function trimHistory(
  document: XmlElement,
  entry: XmlElement,
  binaries: InnerBinary[],
): void {
  const historyEl = getChild(entry, 'History');
  if (!historyEl) return;
  const maxItems = kx_historyLimit(document, 'HistoryMaxItems', KX_DEFAULT_HISTORY_MAX_ITEMS);
  const maxSize = kx_historyLimit(document, 'HistoryMaxSize', KX_DEFAULT_HISTORY_MAX_SIZE);
  const kept = new Set<XmlElement>();
  let size = 0;
  for (const version of getChildren(historyEl, 'Entry').reverse()) {
    if (kept.size >= maxItems) break;
    size += kx_historyVersionSize(version, binaries);
    if (size > maxSize) break;
    kept.add(version);
  }
  historyEl.children = historyEl.children.filter(
    (child) => !(child.type === 'element' && child.name === 'Entry' && !kept.has(child)),
  );
}

// Snapshot `entry`'s current state onto its History, then trim it. Call before applying an edit, not after.
export function pushHistorySnapshot(
  document: XmlElement,
  entry: XmlElement,
  binaries: InnerBinary[],
): void {
  const snapshot = cloneElement(entry);
  snapshot.children = snapshot.children.filter(
    (child) => !(child.type === 'element' && child.name === 'History'),
  );

  let historyEl = getChild(entry, 'History');
  if (!historyEl) {
    historyEl = createElement('History');
    appendChild(entry, historyEl);
  }
  appendChild(historyEl, snapshot);
  trimHistory(document, entry, binaries);
}

/** Restore `entry` to a past version: snapshots current state first, then
replaces its fields. `snapshot` must come from `getEntryHistory(entry)`. For
merges, the restore is the newest edit and keeps the current LocationChanged,
since the entry has not moved (#108). */
export function restoreHistoryEntry(
  document: XmlElement,
  entry: XmlElement,
  snapshot: XmlElement,
  binaries: InnerBinary[],
): void {
  const restoredFields = cloneElement(snapshot);
  const currentTimes = getChild(entry, 'Times');
  const locationChanged = currentTimes && getChild(currentTimes, 'LocationChanged');
  pushHistorySnapshot(document, entry, binaries);

  const uuidEl = getChild(entry, 'UUID');
  const historyEl = getChild(entry, 'History');
  const newChildren: XmlNode[] = [];
  if (uuidEl) newChildren.push(uuidEl);
  for (const child of restoredFields.children) {
    if (child.type === 'element' && (child.name === 'UUID' || child.name === 'History')) continue;
    newChildren.push(child);
  }
  if (historyEl) newChildren.push(historyEl);
  entry.children = newChildren;

  if (locationChanged) kx_setTime(entry, 'LocationChanged', getText(locationChanged));
  touchLastModified(entry);
}

// Permanently remove one past version from an entry's History.
export function deleteHistoryEntry(entry: XmlElement, snapshot: XmlElement): void {
  const historyEl = getChild(entry, 'History');
  if (!historyEl) return;
  historyEl.children = historyEl.children.filter((child) => child !== snapshot);
}

// Build a `<Group>` element with the given name.
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

// The database's recycle bin group, if `Meta/RecycleBinUUID` names one that still exists.
function kx_findRecycleBin(document: XmlElement): XmlElement | undefined {
  const meta = getChild(document, 'Meta');
  const uuidEl = meta && getChild(meta, 'RecycleBinUUID');
  const rootElement = getChild(document, 'Root');
  const rootGroup = rootElement && getChild(rootElement, 'Group');
  if (!uuidEl || !rootGroup) return undefined;
  return kx_findGroupByUuid(rootGroup, getText(uuidEl));
}

/** Find (or lazily create) the recycle bin group, recording its UUID in
Meta/RecycleBinUUID; merges keep the bin with the newer RecycleBinChanged (#108). */
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
  setChildText(bin, 'IconID', '43'); // TrashBin, as KeePass and KeePassXC give their own bin (#121)
  // Left out of search and auto-type, as KeePass and KeePassXC make their own bins (#132).
  appendChild(bin, createElement('EnableAutoType', 'false'));
  appendChild(bin, createElement('EnableSearching', 'false'));
  appendChild(rootGroup, bin);
  // createGroup() always appends a UUID child first, so this is always present.
  const binUuid = getText(getChild(bin, 'UUID') as XmlElement);

  setChildText(meta, 'RecycleBinUUID', binUuid);
  setChildText(meta, 'RecycleBinChanged', kx_nowIso());
  return bin;
}

// Off only when the database says so, making deletes permanent; on by default, as in KeePass (#132).
export function isRecycleBinEnabled(document: XmlElement): boolean {
  const meta = getChild(document, 'Meta');
  const enabledEl = meta && getChild(meta, 'RecycleBinEnabled');
  return !enabledEl || getText(enabledEl).trim().toLowerCase() !== 'false';
}

// True if `group` is the database's recycle bin, or nested inside it.
export function isInRecycleBin(document: XmlElement, group: XmlElement): boolean {
  const bin = kx_findRecycleBin(document);
  return bin !== undefined && kx_containsGroup(bin, group);
}

// The group an entry or group was last moved out of, if it still exists outside the recycle bin (#133).
export function findPreviousParentGroup(
  document: XmlElement,
  element: XmlElement,
): XmlElement | undefined {
  const uuidEl = getChild(element, 'PreviousParentGroup');
  const rootElement = getChild(document, 'Root');
  const rootGroup = rootElement && getChild(rootElement, 'Group');
  if (!uuidEl || !rootGroup) return undefined;
  const group = kx_findGroupByUuid(rootGroup, getText(uuidEl));
  return group && !isInRecycleBin(document, group) ? group : undefined;
}

// Build a complete <KeePassFile> document with Meta and a root group, optionally via build().
export function createDatabaseDocument(
  databaseName: string,
  build?: (rootGroup: XmlElement) => void,
): XmlElement {
  const root = createElement('KeePassFile');

  const meta = createElement('Meta');
  appendChild(meta, createElement('Generator', KX_GENERATOR));
  appendChild(meta, createElement('DatabaseName', databaseName));
  appendChild(meta, createElement('DatabaseNameChanged', kx_nowIso()));
  appendChild(meta, createElement('MasterKeyChanged', kx_nowIso()));
  appendChild(meta, createElement('RecycleBinEnabled', 'True'));
  appendChild(meta, createElement('HistoryMaxItems', String(KX_DEFAULT_HISTORY_MAX_ITEMS)));
  appendChild(meta, createElement('HistoryMaxSize', String(KX_DEFAULT_HISTORY_MAX_SIZE)));
  appendChild(root, meta);

  const rootElement = createElement('Root');
  const rootGroup = createGroup(databaseName);
  build?.(rootGroup);
  appendChild(rootElement, rootGroup);
  appendChild(root, rootElement);

  return root;
}
