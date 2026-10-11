/** KDBX 4.x stores XML DateTimes as Base64 of a little-endian Int64 count of
seconds since 0001-01-01T00:00:00Z; 3.1 stores ISO 8601 text. The model works
in ISO only, so 4.x documents convert on load and back on save (#95). */

import { ByteReader, ByteWriter, fromBase64, toBase64 } from './bytes.ts';
import { getText, setText } from './model.ts';
import type { XmlElement } from './xml.ts';

// Every DateTime element in the KDBX 4.1 XML schema, so no other Base64 value is touched (#95).
const KX_TIME_ELEMENTS = new Set([
  'CreationTime',
  'LastModificationTime',
  'LastAccessTime',
  'ExpiryTime',
  'LocationChanged',
  'DeletionTime',
  'DatabaseNameChanged',
  'DatabaseDescriptionChanged',
  'DefaultUserNameChanged',
  'MasterKeyChanged',
  'RecycleBinChanged',
  'EntryTemplatesGroupChanged',
  'SettingsChanged',
]);
const KX_SECONDS_TO_UNIX_EPOCH = 62135596800n;

function kx_convertTimes(element: XmlElement, convert: (text: string) => string | undefined): void {
  for (const child of element.children) {
    if (child.type !== 'element') continue;
    if (!KX_TIME_ELEMENTS.has(child.name)) {
      kx_convertTimes(child, convert);
      continue;
    }
    const converted = convert(getText(child));
    if (converted !== undefined) setText(child, converted);
  }
}

// Text that isn't 8-byte Base64, such as ISO from a lenient writer, stays as is (#95).
function kx_binaryToIso(text: string): string | undefined {
  if (!/^[A-Za-z0-9+/]{11}=$/.test(text)) return undefined;
  const seconds = new ByteReader(fromBase64(text)).readI64() - KX_SECONDS_TO_UNIX_EPOCH;
  const date = new Date(Number(seconds) * 1000);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

// The ISO shape check keeps Date.parse's lenient fallback from encoding non-dates (#95).
function kx_isoToBinary(text: string): string | undefined {
  const ms = /^\d{4}-\d\d-\d\dT/.test(text) ? Date.parse(text) : Number.NaN;
  if (Number.isNaN(ms)) return undefined;
  const seconds = BigInt(Math.floor(ms / 1000)) + KX_SECONDS_TO_UNIX_EPOCH;
  return toBase64(new ByteWriter(8).writeI64(seconds).toBytes());
}

export function binaryTimesToIso(root: XmlElement): void {
  kx_convertTimes(root, kx_binaryToIso);
}

export function isoTimesToBinary(root: XmlElement): void {
  kx_convertTimes(root, kx_isoToBinary);
}
