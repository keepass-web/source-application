/**
 * Pure logic for the 0x67 app: field/name lookups, tree traversal, entry
 * search, and entry-edit commit, all over a decoded KDBX document. None of
 * these touch the DOM, so unlike page.ts they can be — and are — unit
 * tested directly under plain Node (see tests/0x67-logic.test.ts).
 *
 * This is a real ES module (imports kdbx's build output, same convention
 * used between argon2/chacha20/kdbx themselves — see e.g. kdbx/src/kdf.ts)
 * so it can be exercised with ordinary imports in tests. For the browser
 * build, bundle-iife strips the import below and hoists this file's exports
 * onto globalThis, right alongside the kdbx library itself — this file is
 * one of the concatenated "files" in 0x67/bundle-iife.json. page.ts consumes
 * these functions as globals, not via import — see globals.d.ts.
 *
 * Imports go directly to kdbx's model.ts/xml.ts build output, not its
 * index.ts barrel, on purpose: the barrel re-exports the whole library,
 * including kdbx.ts, whose own cross-package import of chacha20's build
 * output is written relative to *its source* location and breaks (resolves
 * one directory too shallow) when actually resolved from *its build*
 * location — a real, latent bug, undiscovered until now because nothing
 * previously resolved kdbx's build output as a genuine, executed import
 * chain (kdbx's own tests run its source; bundle-iife only text-strips
 * import lines, never resolves them). model.ts/xml.ts have no such
 * dependency, so importing them directly sidesteps the bug rather than
 * fixing it here, which would mean touching already-shipped crypto wiring
 * for an unrelated change — noted, not routed around silently.
 */

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

/** An entry or group's IconID, as text — direct children, not String fields. */
export function elementIconId(element: XmlElement): string {
  const iconEl = getChild(element, 'IconID');
  return iconEl ? getText(iconEl) : '0';
}

/**
 * A small curated set of icons for entries and groups — an internal palette,
 * not KeePass's own bitmap icon spritesheet, which this text-only app has no
 * reason to vendor. IDs 0 and 49 match createEntry/createGroup's defaults.
 * A file whose IconID isn't in this palette (e.g. one edited by real
 * KeePass) still round-trips fine — it just falls back to a generic icon.
 */
export const ICON_PALETTE: ReadonlyArray<{ id: number; emoji: string; label: string }> = [
  { id: 0, emoji: '🔑', label: 'Key' },
  { id: 1, emoji: '🌐', label: 'Web' },
  { id: 2, emoji: '📧', label: 'Email' },
  { id: 3, emoji: '💻', label: 'Computer' },
  { id: 4, emoji: '🏦', label: 'Bank' },
  { id: 5, emoji: '💳', label: 'Card' },
  { id: 6, emoji: '🛒', label: 'Shopping' },
  { id: 7, emoji: '🎮', label: 'Gaming' },
  { id: 8, emoji: '📱', label: 'Phone' },
  { id: 9, emoji: '☁️', label: 'Cloud' },
  { id: 10, emoji: '🔒', label: 'Security' },
  { id: 11, emoji: '🗂️', label: 'Documents' },
  { id: 12, emoji: '⭐', label: 'Starred' },
  { id: 13, emoji: '🏠', label: 'Home' },
  { id: 14, emoji: '💼', label: 'Work' },
  { id: 15, emoji: '🎓', label: 'Education' },
  { id: 16, emoji: '✈️', label: 'Travel' },
  { id: 17, emoji: '🎵', label: 'Media' },
  { id: 18, emoji: '🛡️', label: 'Shield' },
  { id: 19, emoji: '🧩', label: 'Other' },
  { id: 49, emoji: '📁', label: 'Folder' },
];

const ICON_FALLBACK = '❔';

/** The emoji for a given IconID text value, or a generic fallback. */
export function iconEmoji(iconId: string): string {
  const id = Number.parseInt(iconId, 10);
  return ICON_PALETTE.find((icon) => icon.id === id)?.emoji ?? ICON_FALLBACK;
}

/** Find the group that directly contains the given entry. */
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

/** Find the group that directly contains the given subgroup, or null if
 * `group` is `rootGroup` itself (which has no parent). */
export function findGroupParent(rootGroup: XmlElement, group: XmlElement): XmlElement | null {
  for (const sub of getChildren(rootGroup, 'Group')) {
    if (sub === group) return rootGroup;
    const found = findGroupParent(sub, group);
    if (found) return found;
  }
  return null;
}

/** True if `candidate` is `ancestor` itself, or nested anywhere inside it —
 * used to block moving a group into its own subtree. */
export function isDescendantGroup(ancestor: XmlElement, candidate: XmlElement): boolean {
  if (ancestor === candidate) return true;
  return getChildren(ancestor, 'Group').some((sub) => isDescendantGroup(sub, candidate));
}

export interface EntryWithGroup {
  entry: XmlElement;
  group: XmlElement;
}

/** Collect every entry in the tree, paired with its containing group. */
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

/** Return the group path from rootGroup to target as an array of names. */
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

/**
 * Keep only entries with a String field or tag whose value contains the
 * query, case-insensitively.
 */
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

/** Sort entries by title, username, or last-modified time. Ties keep their
 * original relative order (Array#sort is stable). */
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

/** The entry-list table view's optional columns — Title is always shown and
 * isn't part of this set. */
export type EntryColumnKey =
  | 'username'
  | 'password'
  | 'url'
  | 'notes'
  | 'attachments'
  | 'modified'
  | 'created';

/** The raw (unformatted, unmasked) value of one table column. page.ts's table
 * renderer formats dates and masks the password for display, but copies this
 * value as-is on double-click — see its buildEntryTable. */
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

function exportFields(entry: XmlElement, group: XmlElement): [string, string][] {
  return [
    ['Group', groupName(group)],
    ['Title', entryTitle(entry)],
    ['UserName', entryField(entry, 'UserName')],
    ['Password', entryField(entry, 'Password')],
    ['URL', entryField(entry, 'URL')],
    ['Notes', entryField(entry, 'Notes')],
    ['Tags', getEntryTags(entry).join(';')],
  ];
}

/** Quote a CSV field only when it needs it (contains a comma, quote, or
 * newline), doubling any internal quotes — RFC 4180. */
function csvField(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/** Serialize entries (Group, Title, UserName, Password, URL, Notes, Tags) as
 * plaintext CSV — see the caller for the "this is unencrypted" warning this
 * always needs. */
export function toCsv(entries: EntryWithGroup[]): string {
  const header = ['Group', 'Title', 'UserName', 'Password', 'URL', 'Notes', 'Tags'];
  const lines = [header.join(',')];
  for (const { entry, group } of entries) {
    lines.push(
      exportFields(entry, group)
        .map(([, value]) => csvField(value))
        .join(','),
    );
  }
  return lines.join('\r\n');
}

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Serialize entries as plaintext XML — same fields and the same "this is
 * unencrypted" caveat as {@link toCsv}. Not a KDBX document. */
export function toXml(entries: EntryWithGroup[]): string {
  const rows = entries.map(({ entry, group }) => {
    const body = exportFields(entry, group)
      .map(([tag, value]) => `    <${tag}>${xmlEscape(value)}</${tag}>`)
      .join('\n');
    return `  <Entry>\n${body}\n  </Entry>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>\n<Entries>\n${rows.join('\n')}\n</Entries>\n`;
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

/** The standard entry fields every entry gets; anything else is a custom field. */
export const STANDARD_FIELD_NAMES = ['Title', 'UserName', 'Password', 'URL', 'Notes'];

export function isCustomField(key: string): boolean {
  return !STANDARD_FIELD_NAMES.includes(key);
}

/** The settings dialog's minimum accepted clipboard-clear timeout, in seconds. */
export function isValidClipboardTimeout(seconds: number): boolean {
  return !Number.isNaN(seconds) && seconds >= 5;
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
