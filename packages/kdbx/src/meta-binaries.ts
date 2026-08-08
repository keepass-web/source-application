/** KDBX 3.1 binary attachments: stored inline in `Meta/Binaries` as Base64
(optionally gzipped), referenced by ID (4.x instead uses the inner header,
referenced by pool position). Both share the same entry-side `<Binary>`
shape, so this module just remaps IDs to pool indices on load, and back on save. */

import { fromBase64, toBase64 } from './bytes.ts';
import { gunzip } from './crypto.ts';
import type { InnerBinary } from './inner-header.ts';
import {
  appendChild,
  createElement,
  getAttribute,
  getChild,
  getChildren,
  getText,
  setAttribute,
  walkAllEntries,
} from './model.ts';
import type { XmlElement } from './xml.ts';

// Result of reading `Meta/Binaries`: the pool, plus how on-disk IDs map to it.
export interface ParsedMetaBinaries {
  binaries: InnerBinary[];
  idToIndex: Map<number, number>;
}

// Read Meta/Binaries into the pool, gunzipping if Compressed="True"; doesn't modify root.
export async function readMetaBinaries(root: XmlElement): Promise<ParsedMetaBinaries> {
  const binaries: InnerBinary[] = [];
  const idToIndex = new Map<number, number>();

  const meta = getChild(root, 'Meta');
  const binariesEl = meta && getChild(meta, 'Binaries');
  if (!binariesEl) {
    return { binaries, idToIndex };
  }

  for (const binaryEl of getChildren(binariesEl, 'Binary')) {
    const idText = getAttribute(binaryEl, 'ID');
    if (idText === undefined) {
      continue;
    }
    let data = fromBase64(getText(binaryEl));
    if (getAttribute(binaryEl, 'Compressed') === 'True') {
      data = await gunzip(data);
    }
    idToIndex.set(Number.parseInt(idText, 10), binaries.length);
    binaries.push({ flags: 0, data });
  }

  return { binaries, idToIndex };
}

// Remove `Meta/Binaries` from the tree — its content now lives in the pool.
export function removeMetaBinariesElement(root: XmlElement): void {
  const meta = getChild(root, 'Meta');
  if (!meta) {
    return;
  }
  meta.children = meta.children.filter(
    (child) => !(child.type === 'element' && child.name === 'Binaries'),
  );
}

// Remap every Binary Ref (incl. History) from on-disk ID to pool index; leaves unmatched Refs as-is.
export function remapEntryBinaryRefs(root: XmlElement, idToIndex: Map<number, number>): void {
  const rootElement = getChild(root, 'Root');
  const rootGroup = rootElement && getChild(rootElement, 'Group');
  if (!rootGroup) {
    return;
  }

  walkAllEntries(rootGroup, (entry) => {
    for (const binaryEl of getChildren(entry, 'Binary')) {
      const valueEl = getChild(binaryEl, 'Value');
      const refText = valueEl && getAttribute(valueEl, 'Ref');
      if (!valueEl || refText === undefined) {
        continue;
      }
      const newRef = idToIndex.get(Number.parseInt(refText, 10));
      if (newRef !== undefined) {
        setAttribute(valueEl, 'Ref', String(newRef));
      }
    }
  });
}

/** Build/replace `Meta/Binaries` from the pool, always uncompressed (still
reads `Compressed="True"` from others). No-op when the pool is empty. */
export function writeMetaBinaries(root: XmlElement, binaries: InnerBinary[]): void {
  removeMetaBinariesElement(root);
  if (binaries.length === 0) {
    return;
  }

  const meta = getChild(root, 'Meta');
  if (!meta) {
    throw new Error('database is missing Meta');
  }

  const binariesEl = createElement('Binaries');
  binaries.forEach((binary, index) => {
    const binaryEl = createElement('Binary', toBase64(binary.data));
    setAttribute(binaryEl, 'ID', String(index));
    appendChild(binariesEl, binaryEl);
  });
  appendChild(meta, binariesEl);
}
