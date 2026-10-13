/** Pure logic for 0x67: field/tree lookups, search, and edit-commit over a
decoded KDBX doc — no DOM, so unit-tested directly. A real ES module;
bundle-iife hoists its exports onto globalThis alongside kdbx.

Imports kdbx's model.ts/xml.ts directly, not the index.ts barrel, to
sidestep a latent bug: kdbx.ts's own chacha20 import resolves relative to
source, not build, and breaks when actually run from build output. */

import type { CredentialsInput } from '../../build/packages/kdbx/src/credentials.js';
import {
  appendChild,
  createElement,
  getChild,
  getChildren,
  getEntryAttachments,
  getEntryTags,
  getEntryTimes,
  getText,
  setAttribute,
} from '../../build/packages/kdbx/src/model.js';
import type { XmlElement } from '../../build/packages/kdbx/src/xml.js';

export function entryField(entry: XmlElement, key: string): string {
  for (const string of getChildren(entry, 'String')) {
    const k = getChild(string, 'Key');
    const v = getChild(string, 'Value');
    if (k && getText(k) === key) return v ? getText(v) : '';
  }
  return '';
}

export function entryTitle(entry: XmlElement): string {
  return entryField(entry, 'Title') || '(no title)';
}

export function groupName(group: XmlElement): string {
  const n = getChild(group, 'Name');
  return n ? getText(n) : '(unnamed)';
}

// An entry or group's IconID, as text — direct children, not String fields.
export function elementIconId(element: XmlElement): string {
  const iconEl = getChild(element, 'IconID');
  return iconEl ? getText(iconEl) : '0';
}

/* KeePass's standard icons, indexed by IconID, so an icon picked here means the
same in every KeePass app (#121); each names a symbol in page.html's sprite. */
export const ICON_PALETTE: ReadonlyArray<{ icon: string; label: string }> = [
  { icon: 'key', label: 'Key' },
  { icon: 'web', label: 'Web' },
  { icon: 'warning', label: 'Warning' },
  { icon: 'server', label: 'Server' },
  { icon: 'folder-marked', label: 'Marked folder' },
  { icon: 'conversation', label: 'Conversation' },
  { icon: 'parts', label: 'Parts' },
  { icon: 'notepad', label: 'Notepad' },
  { icon: 'network', label: 'Network' },
  { icon: 'identity', label: 'Identity' },
  { icon: 'document-ready', label: 'Document ready' },
  { icon: 'camera', label: 'Camera' },
  { icon: 'wireless', label: 'Wireless' },
  { icon: 'keys', label: 'Keys' },
  { icon: 'energy', label: 'Energy' },
  { icon: 'scanner', label: 'Scanner' },
  { icon: 'favorite-site', label: 'Favorite site' },
  { icon: 'disc', label: 'Disc' },
  { icon: 'monitor', label: 'Monitor' },
  { icon: 'email', label: 'Email' },
  { icon: 'configuration', label: 'Configuration' },
  { icon: 'clipboard', label: 'Clipboard' },
  { icon: 'document-new', label: 'New document' },
  { icon: 'window', label: 'Window' },
  { icon: 'high-voltage', label: 'High voltage' },
  { icon: 'inbox', label: 'Inbox' },
  { icon: 'save', label: 'Disk' },
  { icon: 'drive', label: 'Drive' },
  { icon: 'document-question', label: 'Question' },
  { icon: 'terminal-encrypted', label: 'Encrypted terminal' },
  { icon: 'console', label: 'Console' },
  { icon: 'printer', label: 'Printer' },
  { icon: 'programs', label: 'Programs' },
  { icon: 'run', label: 'Run' },
  { icon: 'settings', label: 'Settings' },
  { icon: 'web-computer', label: 'Web computer' },
  { icon: 'archive', label: 'Archive' },
  { icon: 'bank', label: 'Bank' },
  { icon: 'drive-system', label: 'System drive' },
  { icon: 'clock', label: 'Clock' },
  { icon: 'email-search', label: 'Email search' },
  { icon: 'document-flagged', label: 'Flagged document' },
  { icon: 'memory', label: 'Memory' },
  { icon: 'trash', label: 'Trash' },
  { icon: 'note', label: 'Note' },
  { icon: 'expired', label: 'Expired' },
  { icon: 'info', label: 'Info' },
  { icon: 'package', label: 'Package' },
  { icon: 'folder', label: 'Folder' },
  { icon: 'folder-open', label: 'Open folder' },
  { icon: 'folder-package', label: 'Folder package' },
  { icon: 'lock-open', label: 'Unlocked' },
  { icon: 'document-locked', label: 'Locked document' },
  { icon: 'checked', label: 'Checked' },
  { icon: 'pen', label: 'Pen' },
  { icon: 'picture', label: 'Picture' },
  { icon: 'book', label: 'Book' },
  { icon: 'list', label: 'List' },
  { icon: 'user-key', label: 'User key' },
  { icon: 'tool', label: 'Tool' },
  { icon: 'home', label: 'Home' },
  { icon: 'star', label: 'Star' },
  { icon: 'linux', label: 'Linux' },
  { icon: 'feather', label: 'Feather' },
  { icon: 'apple', label: 'Apple' },
  { icon: 'wiki', label: 'Wiki' },
  { icon: 'money', label: 'Money' },
  { icon: 'certificate', label: 'Certificate' },
  { icon: 'phone', label: 'Phone' },
];

// The sprite symbol for a given IconID text value, or a generic one outside KeePass's set.
export function iconName(iconId: string): string {
  return ICON_PALETTE[Number.parseInt(iconId, 10)]?.icon ?? 'unknown';
}

// Find the group that directly contains the given entry.
export function findEntryParent(rootGroup: XmlElement, entry: XmlElement): XmlElement | null {
  for (const e of getChildren(rootGroup, 'Entry')) {
    if (e === entry) return rootGroup;
  }
  for (const sub of getChildren(rootGroup, 'Group')) {
    const found = findEntryParent(sub, entry);
    if (found) return found;
  }
  return null;
}

// Find the group directly containing the given subgroup, or null for rootGroup itself.
export function findGroupParent(rootGroup: XmlElement, group: XmlElement): XmlElement | null {
  for (const sub of getChildren(rootGroup, 'Group')) {
    if (sub === group) return rootGroup;
    const found = findGroupParent(sub, group);
    if (found) return found;
  }
  return null;
}

// True if candidate is ancestor itself or nested inside it (blocks moving a group into itself).
export function isDescendantGroup(ancestor: XmlElement, candidate: XmlElement): boolean {
  if (ancestor === candidate) return true;
  return getChildren(ancestor, 'Group').some((sub) => isDescendantGroup(sub, candidate));
}

export interface EntryWithGroup {
  entry: XmlElement;
  group: XmlElement;
}

// Collect every entry in the tree, paired with its containing group.
export function collectAllEntries(
  group: XmlElement,
  results: EntryWithGroup[] = [],
): EntryWithGroup[] {
  for (const entry of getChildren(group, 'Entry')) {
    results.push({ entry, group });
  }
  for (const sub of getChildren(group, 'Group')) {
    collectAllEntries(sub, results);
  }
  return results;
}

// Return the group path from rootGroup to target as an array of names.
export function groupPathTo(
  rootGroup: XmlElement,
  target: XmlElement,
  path: string[] = [],
): string[] | null {
  const thisPath = path.concat(groupName(rootGroup));
  if (rootGroup === target) return thisPath;
  for (const sub of getChildren(rootGroup, 'Group')) {
    const found = groupPathTo(sub, target, thisPath);
    if (found) return found;
  }
  return null;
}

// Keep only entries with a String field or tag matching the query, case-insensitively.
export function filterEntriesByQuery(entries: EntryWithGroup[], query: string): EntryWithGroup[] {
  const q = query.toLowerCase();
  return entries.filter(({ entry }) => {
    for (const string of getChildren(entry, 'String')) {
      const v = getChild(string, 'Value');
      if (v && getText(v).toLowerCase().includes(q)) return true;
    }
    return getEntryTags(entry).some((tag) => tag.toLowerCase().includes(q));
  });
}

export type EntrySortField = 'title' | 'username' | 'modified';
export type EntrySortDirection = 'asc' | 'desc';

function entrySortKey(entry: XmlElement, field: EntrySortField): string {
  switch (field) {
    case 'title':
      return entryTitle(entry).toLowerCase();
    case 'username':
      return entryField(entry, 'UserName').toLowerCase();
    case 'modified':
      return getEntryTimes(entry).modified;
  }
}

// Sort by title, username, or modified time; ties keep original order (stable sort).
export function sortEntries(
  entries: EntryWithGroup[],
  field: EntrySortField,
  direction: EntrySortDirection,
): EntryWithGroup[] {
  const sign = direction === 'asc' ? 1 : -1;
  return entries
    .slice()
    .sort(
      (a, b) => entrySortKey(a.entry, field).localeCompare(entrySortKey(b.entry, field)) * sign,
    );
}

// Optional table-view columns; Title is always shown and isn't one of these.
export type EntryColumnKey =
  | 'username'
  | 'password'
  | 'url'
  | 'notes'
  | 'attachments'
  | 'modified'
  | 'created';

// Unformatted/unmasked — page.ts formats for display but copies this raw value.
export function entryColumnValue(entry: XmlElement, column: EntryColumnKey): string {
  switch (column) {
    case 'username':
      return entryField(entry, 'UserName');
    case 'password':
      return entryField(entry, 'Password');
    case 'url':
      return entryField(entry, 'URL');
    case 'notes':
      return entryField(entry, 'Notes');
    case 'attachments': {
      const count = getEntryAttachments(entry).length;
      return count > 0 ? String(count) : '';
    }
    case 'modified':
      return getEntryTimes(entry).modified;
    case 'created':
      return getEntryTimes(entry).created;
  }
}

// Quote a CSV field only when needed (RFC 4180), doubling internal quotes.
function csvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** Every entry as plaintext CSV, see the caller for the required "unencrypted"
warning. Values are exactly as stored, so another client imports them unchanged,
and Group is the path from the root joined by "/", as KeePassXC writes it (#137). */
export function toCsv(rootGroup: XmlElement): string {
  const lines = ['Group,Title,UserName,Password,URL,Notes,Tags'];
  const walk = (group: XmlElement, path: string): void => {
    for (const entry of getChildren(group, 'Entry')) {
      const fields = ['Title', 'UserName', 'Password', 'URL', 'Notes'].map((key) =>
        entryField(entry, key),
      );
      lines.push([path, ...fields, getEntryTags(entry).join(';')].map(csvField).join(','));
    }
    for (const sub of getChildren(group, 'Group')) walk(sub, `${path}/${groupName(sub)}`);
  };
  walk(rootGroup, groupName(rootGroup));
  return lines.join('\r\n');
}

/** A single row from the entry-edit form, already read out of the DOM. */
export interface EditedField {
  key: string;
  value: string;
  protect: boolean;
}

/**
 * Replace an entry's String fields with the given key/value pairs, in order,
 * skipping any with a blank key.
 */
export function applyEntryEdits(entry: XmlElement, fields: EditedField[]): void {
  entry.children = entry.children.filter((c) => !(c.type === 'element' && c.name === 'String'));

  for (const { key, value, protect } of fields) {
    if (!key) continue;
    const stringEl = createElement('String');
    appendChild(stringEl, createElement('Key', key));
    const valueEl = createElement('Value', value);
    if (protect) setAttribute(valueEl, 'Protected', 'True');
    appendChild(stringEl, valueEl);
    appendChild(entry, stringEl);
  }
}

/** The first name shared by two of the fields, or null. KeePassXC refuses to
open a file holding an entry with two fields of one name (#125). */
export function duplicateFieldName(fields: EditedField[]): string | null {
  const seen = new Set<string>();
  for (const { key } of fields) {
    if (!key) continue; // a blank-named row is dropped on save, so it clashes with nothing
    if (seen.has(key)) return key;
    seen.add(key);
  }
  return null;
}

/** The standard entry fields every entry gets; anything else is a custom field. */
export const STANDARD_FIELD_NAMES = ['Title', 'UserName', 'Password', 'URL', 'Notes'];

export function isCustomField(key: string): boolean {
  return !STANDARD_FIELD_NAMES.includes(key);
}

/** The credentials to try, in order, for what the unlock form holds. An empty
password box beside a key file can mean the key file alone or an empty password
with it, so both are tried, the key file alone first, as KeePassXC does (#127). */
export function unlockAttempts(password: string, keyFile: Uint8Array | null): CredentialsInput[] {
  if (!keyFile) return [{ password }];
  if (password) return [{ password, keyFile }];
  return [{ keyFile }, { password: '', keyFile }];
}

/** The web address a URL field can open in a new tab, or null (#86). Only http
and https, so a database can never make the app run a javascript: URL or hand
a value to another scheme's handler; a bare host is read as https, the way it
was most likely typed. */
export function openableUrl(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  try {
    const url = new URL(/^[a-z][a-z\d+.-]*:/i.test(value) ? value : `https://${value}`);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
  } catch {
    return null;
  }
}

/** The settings dialog's minimum accepted clipboard-clear timeout, in seconds. */
export function isValidClipboardTimeout(seconds: number): boolean {
  return !Number.isNaN(seconds) && seconds >= 5;
}

/* The longest idle delay the settings accept, in seconds. An unlock is when a
returning tab checks for a version saved elsewhere, so the lock must always come (#74). */
const MAX_IDLE_DELAY = 3600;

/** The settings dialog's accepted curtain delay, in seconds (#84). */
export function isValidCurtainTimeout(seconds: number): boolean {
  return !Number.isNaN(seconds) && seconds >= 15 && seconds <= MAX_IDLE_DELAY;
}

/** The settings dialog's accepted auto-lock delay, in seconds (#84). */
export function isValidAutoLockTimeout(seconds: number): boolean {
  return !Number.isNaN(seconds) && seconds >= 30 && seconds <= MAX_IDLE_DELAY;
}

/** Character classes offered by the password generator. */
const GENERATOR_CHARSETS = {
  upper: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  lower: 'abcdefghijklmnopqrstuvwxyz',
  digits: '0123456789',
  symbols: '!@#$%^&*()-_=+[]{};:,.<>?',
} as const;

export interface PasswordGeneratorOptions {
  length: number;
  upper?: boolean;
  lower?: boolean;
  digits?: boolean;
  symbols?: boolean;
}

/**
 * Generate a random password from the selected character classes, using
 * crypto.getRandomValues (never Math.random). Rejection sampling — redrawing
 * a byte that falls above the largest multiple of the charset size a byte can
 * hold — avoids the modulo-bias a plain `byte % charset.length` would
 * introduce toward the low end of the charset.
 */
export function generatePassword(options: PasswordGeneratorOptions): string {
  const charset = (['upper', 'lower', 'digits', 'symbols'] as const)
    .filter((name) => options[name])
    .map((name) => GENERATOR_CHARSETS[name])
    .join('');
  if (!charset) {
    throw new Error('Select at least one character type.');
  }
  if (!Number.isInteger(options.length) || options.length < 1) {
    throw new Error('Length must be a positive whole number.');
  }

  const max = 256 - (256 % charset.length);
  const byte = new Uint8Array(1);
  let result = '';
  while (result.length < options.length) {
    crypto.getRandomValues(byte);
    // byte has a fixed length of 1, so index 0 is always populated; the cast
    // only satisfies noUncheckedIndexedAccess.
    const value = byte[0] as number;
    if (value < max) {
      // value % charset.length is always < charset.length, so this index is
      // always populated too.
      result += charset[value % charset.length] as string;
    }
  }
  return result;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** Format an ISO-UTC timestamp for an `<input type="datetime-local">` value,
 * in the browser's local time zone. */
export function isoToLocalInputValue(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** Parse an `<input type="datetime-local">` value (a timezone-less string,
 * which the Date constructor treats as local time) back to ISO-UTC. */
export function localInputValueToIso(value: string): string {
  return new Date(value).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** A sensible one-year-out default for a newly-enabled expiration, already
 * formatted for a datetime-local input. */
export function defaultExpiryLocalInputValue(): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() + 1);
  return isoToLocalInputValue(d.toISOString());
}
