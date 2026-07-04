/**
 * Pure XML-tree helpers for the 0x67 app: field/name lookups and tree
 * traversal over a decoded KDBX document. None of these touch the DOM, so
 * unlike page.ts they can be — and are — unit tested directly under plain
 * Node (see tests/0x67-logic.test.ts).
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

import { getChild, getChildren, getText } from '../../build/packages/kdbx/src/model.js';
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
