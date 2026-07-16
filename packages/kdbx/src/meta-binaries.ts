/**
 * Binary attachments for KDBX 3.1.
 *
 * 3.1 stores attachment content inline in `Meta/Binaries` as Base64 (each
 * entry optionally individually gzip-compressed, marked `Compressed="True"`),
 * referenced from entries by a `Meta/Binaries/Binary`'s `ID` attribute. KDBX
 * 4.x instead stores content in the encrypted inner header, referenced by
 * pool position (see inner-header.ts). Both versions use the same entry-side
 * shape — `<Binary><Key>name</Key><Value Ref="N"/></Binary>` — so the only
 * difference this module needs to bridge is where the content lives and how
 * it's addressed: on load, on-disk IDs are remapped to pool indices so the
 * rest of this library (Kdbx#binaries, the attachment helpers in model.ts)
 * can treat both versions identically; on save, indices are written back out
 * as IDs.
 */

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

/** Result of reading `Meta/Binaries`: the pool, plus how on-disk IDs map to it. */
export interface ParsedMetaBinaries {
  binaries: InnerBinary[];
  idToIndex: Map<number, number>;
}

/**
 * Read `Meta/Binaries`, decoding each `<Binary>` (Base64, gunzipped if
 * marked `Compressed="True"`) into the pool in document order. Does not
 * modify `root` — see {@link removeMetaBinariesElement}.
 */
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

/** Remove `Meta/Binaries` from the tree — its content now lives in the pool. */
export function removeMetaBinariesElement(root: XmlElement): void {
  const meta = getChild(root, 'Meta');
  if (!meta) {
    return;
  }
  meta.children = meta.children.filter(
    (child) => !(child.type === 'element' && child.name === 'Binaries'),
  );
}

/**
 * Rewrite every entry's (including History revisions') `<Binary><Value
 * Ref="…">` from the on-disk ID in `idToIndex` to the pool index it maps to.
 * A `Ref` with no matching ID (a stale/malformed reference) is left as-is.
 */
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

/**
 * Build (or replace) `Meta/Binaries` from the pool, keyed by array index.
 * Always writes uncompressed — one encoding on write keeps this simple;
 * {@link readMetaBinaries} still accepts `Compressed="True"` content written
 * by other implementations. A no-op — beyond removing any existing element —
 * when the pool is empty, matching how a database with no attachments has no
 * Binaries element at all.
 */
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
