/** Pure logic for 0x67: field/tree lookups, search, and edit-commit over a
decoded KDBX doc — no DOM, so unit-tested directly. A real ES module;
bundle-iife hoists its exports onto globalThis alongside kdbx.

Imports kdbx's model.ts/xml.ts directly, not the index.ts barrel, to
sidestep a latent bug: kdbx.ts's own chacha20 import resolves relative to
source, not build, and breaks when actually run from build output. */

import { fromBase64, toBase64 } from '../../build/packages/kdbx/src/bytes.js';
import type { CredentialsInput } from '../../build/packages/kdbx/src/credentials.js';
import {
  appendChild,
  createElement,
  type EntryAttachment,
  getAttribute,
  getChild,
  getChildren,
  getEntryAttachments,
  getEntryTags,
  getEntryTimes,
  getText,
  isInRecycleBin,
  setAttribute,
  setText,
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

// Furled only when the group's IsExpanded says false; KeePass reads anything else as expanded (#183).
export function isGroupFurled(group: XmlElement): boolean {
  const setting = getChild(group, 'IsExpanded');
  return setting !== undefined && getText(setting).trim().toLowerCase() === 'false';
}

/* Written to IsExpanded, as KeePass does, leaving the group's modification time alone,
so a merge never takes furling for an edit (#183). */
export function setGroupFurled(group: XmlElement, furled: boolean): void {
  const value = furled ? 'False' : 'True';
  const setting = getChild(group, 'IsExpanded');
  if (setting) {
    setText(setting, value);
  } else {
    appendChild(group, createElement('IsExpanded', value));
  }
}

/** Every entry search looks through: none in the recycle bin or in a group with
searching off, which a group without its own setting inherits, as in KeePass and KeePassXC (#131). */
export function collectSearchableEntries(
  document: XmlElement,
  group: XmlElement,
  inherited = true,
  results: EntryWithGroup[] = [],
): EntryWithGroup[] {
  if (isInRecycleBin(document, group)) return results;
  const setting = getChild(group, 'EnableSearching');
  const value = setting ? getText(setting).trim().toLowerCase() : '';
  const searchable = value === 'true' || (value !== 'false' && inherited);
  if (searchable) {
    for (const entry of getChildren(group, 'Entry')) results.push({ entry, group });
  }
  for (const sub of getChildren(group, 'Group')) {
    collectSearchableEntries(document, sub, searchable, results);
  }
  return results;
}

/** Keep only entries with a field or tag matching the query, case-insensitively;
a password or other protected value never matches, as in KeePass and KeePassXC (#131). */
export function filterEntriesByQuery(entries: EntryWithGroup[], query: string): EntryWithGroup[] {
  const q = query.toLowerCase();
  return entries.filter(({ entry }) => {
    for (const string of getChildren(entry, 'String')) {
      const k = getChild(string, 'Key');
      const v = getChild(string, 'Value');
      if (!k || !v || getText(k) === 'Password' || getAttribute(v, 'Protected') === 'True')
        continue;
      if (getText(v).toLowerCase().includes(q)) return true;
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

/** The first name given twice, or null. KeePassXC refuses to open a file holding an
entry with two fields of one name (#125), and KeePass and KeePassXC keep only one of
two attachments of one name (#120). */
export function duplicateName(names: string[]): string | null {
  const seen = new Set<string>();
  for (const name of names) {
    if (!name) continue; // a blank-named field row is dropped on save, so it clashes with nothing
    if (seen.has(name)) return name;
    seen.add(name);
  }
  return null;
}

/** The standard entry fields every entry gets; anything else is a custom field. */
export const STANDARD_FIELD_NAMES = ['Title', 'UserName', 'Password', 'URL', 'Notes'];

export function isCustomField(key: string): boolean {
  return !STANDARD_FIELD_NAMES.includes(key);
}

function childText(element: XmlElement, name: string): string {
  const child = getChild(element, name);
  return child ? getText(child) : '';
}

// An entry's UUID, or '' for one a malformed file left without.
export function entryUuid(entry: XmlElement): string {
  return childText(entry, 'UUID');
}

// The edit screen a lock closed over; form is null when nothing on it had changed (#185).
export interface LockedEdit {
  uuid: string;
  isNew: boolean;
  modified: string; // the entry's LastModificationTime as the form read it
  form: LockedForm | null;
}

export interface LockedForm {
  fields: EditedField[];
  iconId: number | null;
  tags: string;
  expires: boolean;
  expiry: string;
  attachments: Array<EntryAttachment | { name: string; data: Uint8Array }>;
}

type StoredAttachment = EntryAttachment | { name: string; data: string };
type StoredEdit = Omit<LockedEdit, 'form'> & {
  form: (Omit<LockedForm, 'attachments'> & { attachments: StoredAttachment[] }) | null;
};

/* Meta's CustomData is where KDBX keeps an app's own data. A lock puts the edit there just
before it encrypts, and unlocking takes it straight back out, so no saved file holds it (#185). */
const LOCKED_EDIT_KEY = 'KeePassWeb_LockedEdit';

export function holdLockedEdit(document: XmlElement, edit: LockedEdit): void {
  const meta = getChild(document, 'Meta');
  if (!meta) return; // nowhere to carry it, and the lock goes ahead regardless
  let customData = getChild(meta, 'CustomData');
  if (!customData) {
    customData = createElement('CustomData');
    appendChild(meta, customData);
  }
  const stored: StoredEdit = {
    ...edit,
    form: edit.form && {
      ...edit.form,
      attachments: edit.form.attachments.map((held) =>
        'data' in held ? { name: held.name, data: toBase64(held.data) } : held,
      ),
    },
  };
  const item = createElement('Item');
  appendChild(item, createElement('Key', LOCKED_EDIT_KEY));
  appendChild(item, createElement('Value', JSON.stringify(stored)));
  appendChild(customData, item);
}

// Removes every locked edit this database holds and returns the first, or null if none reads back.
export function takeLockedEdit(document: XmlElement): LockedEdit | null {
  const meta = getChild(document, 'Meta');
  const customData = meta && getChild(meta, 'CustomData');
  if (!customData) return null;
  const items = getChildren(customData, 'Item').filter(
    (item) => childText(item, 'Key') === LOCKED_EDIT_KEY,
  );
  customData.children = customData.children.filter((child) => !items.includes(child as XmlElement));
  const [item] = items;
  if (!item) return null;
  try {
    const stored = JSON.parse(childText(item, 'Value')) as StoredEdit;
    return {
      ...stored,
      form: stored.form && {
        ...stored.form,
        attachments: stored.form.attachments.map((held) =>
          'data' in held ? { name: held.name, data: fromBase64(held.data) } : held,
        ),
      },
    };
  } catch {
    return null; // a damaged one is dropped, never in the way of an unlock
  }
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

// One-time codes (#138)

/** A field's value by name: an entry's as stored, or the edit form's as typed. */
export type FieldReader = (key: string) => string;

export interface Totp {
  key: CryptoKey;
  digits: number;
  period: number; // seconds
  steam: boolean;
}

interface TotpSettings {
  secret: Uint8Array<ArrayBuffer>;
  hash: string;
  digits: number;
  period: number;
  steam: boolean;
}

type SecretDecoder = (text: string) => Uint8Array<ArrayBuffer> | null;

const OTP_LINK = /^otpauth:\/\/totp(?:[/?]|$)/i;
const OTP_LINK_HASHES: Record<string, string> = {
  SHA1: 'SHA-1',
  SHA256: 'SHA-256',
  SHA512: 'SHA-512',
};
const TIME_OTP_HASHES: Record<string, string> = {
  'HMAC-SHA-1': 'SHA-1',
  'HMAC-SHA-256': 'SHA-256',
  'HMAC-SHA-512': 'SHA-512',
};
const BASE32_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const STEAM_CHARS = '23456789BCDFGHJKMNPQRTVWXY';

/* Spacing, padding and case vary with where a secret was copied from, so all three
are ignored; two characters are the fewest that hold a byte. */
function fromBase32(text: string): Uint8Array<ArrayBuffer> | null {
  const chars = text.replace(/[\s=]+/g, '').toUpperCase();
  if (!/^[A-Z2-7]{2,}$/.test(chars)) return null;
  const out = new Uint8Array(Math.floor((chars.length * 5) / 8));
  let bits = 0;
  let value = 0;
  let index = 0;
  for (const char of chars) {
    value = (value << 5) | BASE32_CHARS.indexOf(char);
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out[index] = value >> bits;
      index += 1;
      value &= (1 << bits) - 1;
    }
  }
  return out;
}

function fromHex(text: string): Uint8Array<ArrayBuffer> | null {
  const digits = text.replace(/\s+/g, '');
  if (!/^(?:[\da-f]{2})+$/i.test(digits)) return null;
  const out = new Uint8Array(digits.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = Number.parseInt(digits.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

// Checked first, so fromBase64 never throws with part of the secret decoded where nothing can zero it.
function fromBase64Secret(text: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z\d+/]{2,}={0,2}$/.test(text.replace(/\s+/g, ''))) return null;
  return fromBase64(text) as Uint8Array<ArrayBuffer>; // a buffer of its own
}

// KeePass's secret fields, one per encoding, of which it requires exactly one.
const TIME_OTP_SECRETS: Record<string, SecretDecoder> = {
  'TimeOtp-Secret': (text) => new TextEncoder().encode(text),
  'TimeOtp-Secret-Hex': fromHex,
  'TimeOtp-Secret-Base32': fromBase32,
  'TimeOtp-Secret-Base64': fromBase64Secret,
};
const TOTP_FIELDS = [
  'otp',
  ...Object.keys(TIME_OTP_SECRETS),
  'TimeOtp-Length',
  'TimeOtp-Period',
  'TimeOtp-Algorithm',
];

function wholeNumber(text: string): number {
  return /^\d+$/.test(text) ? Number(text) : Number.NaN;
}

// Up to 10 digits, all that RFC 4226's 31-bit value holds, over any whole period of seconds.
function validSettings(hash: string | undefined, digits: number, period: number): hash is string {
  return hash !== undefined && digits >= 1 && digits <= 10 && period >= 1;
}

function readOtpLink(link: string): TotpSettings | null {
  let query: URLSearchParams;
  try {
    query = new URL(link).searchParams;
  } catch {
    return null; // a link the parser refuses is unreadable, not an error
  }
  const steam = query.get('encoder') === 'steam';
  const hash = OTP_LINK_HASHES[(query.get('algorithm') ?? 'SHA1').toUpperCase()];
  const digits = steam ? 5 : wholeNumber(query.get('digits') ?? '6'); // a Steam code is always five
  const period = wholeNumber(query.get('period') ?? '30');
  if (!validSettings(hash, digits, period)) return null;
  const secret = fromBase32(query.get('secret') ?? '');
  return secret && { secret, hash, digits, period, steam };
}

function readTimeOtp(field: FieldReader): TotpSettings | null {
  const [found, ...more] = Object.entries(TIME_OTP_SECRETS).filter(([key]) => field(key) !== '');
  const hash = TIME_OTP_HASHES[(field('TimeOtp-Algorithm') || 'HMAC-SHA-1').toUpperCase()];
  const digits = wholeNumber(field('TimeOtp-Length') || '6');
  const period = wholeNumber(field('TimeOtp-Period') || '30');
  if (!found || more.length > 0 || !validSettings(hash, digits, period)) return null;
  const [key, decode] = found;
  const secret = decode(field(key));
  return secret && { secret, hash, digits, period, steam: false };
}

/** Whether an entry carries TOTP settings: an otpauth link in "otp", as KeePassXC
keeps them, or a TimeOtp secret, as KeePass 2.47+ does. */
export function hasTotp(field: FieldReader): boolean {
  return (
    OTP_LINK.test(field('otp')) || Object.keys(TIME_OTP_SECRETS).some((key) => field(key) !== '')
  );
}

// Every value those settings are read from, so a change to any of them shows.
export function totpSettings(field: FieldReader): string {
  return JSON.stringify(TOTP_FIELDS.map((key) => field(key)));
}

/** The settings read into a key, the "otp" link first as KeePassXC reads it, or null
when they can't be read. */
export async function readTotp(field: FieldReader): Promise<Totp | null> {
  const link = field('otp');
  const settings = OTP_LINK.test(link) ? readOtpLink(link) : readTimeOtp(field);
  if (!settings) return null;
  const { secret, hash, digits, period, steam } = settings;
  const key = await crypto.subtle
    .importKey('raw', secret, { name: 'HMAC', hash }, false, ['sign'])
    .finally(() => secret.fill(0)); // the key holds its own copy
  return { key, digits, period, steam };
}

// RFC 6238's time step: whole periods of Unix seconds.
export function totpStep(totp: Totp, now: number): number {
  return Math.floor(Math.floor(now / 1000) / totp.period);
}

export function totpSecondsLeft(totp: Totp, now: number): number {
  return totp.period - (Math.floor(now / 1000) % totp.period);
}

/** A time step's code: its HMAC cut to 31 bits by RFC 4226's dynamic truncation, then
written in decimal digits, or in Steam's letters and digits. */
export async function totpCode(totp: Totp, step: number): Promise<string> {
  const counter = new Uint8Array(8);
  new DataView(counter.buffer).setBigUint64(0, BigInt(step));
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', totp.key, counter));
  const offset = (mac[mac.length - 1] as number) & 0xf;
  let value = new DataView(mac.buffer).getUint32(offset) & 0x7fffffff;
  mac.fill(0);
  if (!totp.steam) return String(value % 10 ** totp.digits).padStart(totp.digits, '0');
  let code = '';
  for (let i = 0; i < totp.digits; i += 1) {
    code += STEAM_CHARS.charAt(value % STEAM_CHARS.length);
    value = Math.floor(value / STEAM_CHARS.length);
  }
  return code;
}
