/**
 * The inner (encrypted) header — KDBX 4.x only.
 *
 * It precedes the XML document inside the decrypted, decompressed payload and
 * carries the inner random stream cipher ID and key (used to protect sensitive
 * fields) plus any binary attachments referenced by the XML.
 */

import { ByteReader, ByteWriter, concatBytes } from './bytes.ts';
import { InnerHeaderFieldId, InnerStreamCipher } from './constants.ts';

/** A binary attachment stored in the inner header. */
export interface InnerBinary {
  /** Flags byte; 0x01 marks content that should be memory-protected. */
  flags: number;
  data: Uint8Array;
}

/** Decoded inner header. */
export interface InnerHeader {
  innerRandomStreamId: number;
  innerRandomStreamKey: Uint8Array;
  binaries: InnerBinary[];
}

/** Result of reading the inner header: the header plus the XML bytes that follow. */
export interface ParsedInnerHeader {
  inner: InnerHeader;
  xml: Uint8Array;
}

/** Parse the inner header from the start of a decrypted, decompressed payload. */
export function readInnerHeader(payload: Uint8Array): ParsedInnerHeader {
  const reader = new ByteReader(payload);
  const binaries: InnerBinary[] = [];
  let innerRandomStreamId: number = InnerStreamCipher.ChaCha20;
  let innerRandomStreamKey: Uint8Array = new Uint8Array(0);

  for (;;) {
    const id = reader.readU8();
    const size = reader.readI32();
    const value = reader.readBytes(size);
    if (id === InnerHeaderFieldId.EndOfHeader) {
      break;
    }
    switch (id) {
      case InnerHeaderFieldId.InnerRandomStreamId:
        innerRandomStreamId = new ByteReader(value).readI32();
        break;
      case InnerHeaderFieldId.InnerRandomStreamKey:
        innerRandomStreamKey = value;
        break;
      case InnerHeaderFieldId.Binary:
        binaries.push({ flags: value[0] ?? 0, data: value.slice(1) });
        break;
      default:
        break;
    }
  }

  return {
    inner: { innerRandomStreamId, innerRandomStreamKey, binaries },
    xml: reader.readRest(),
  };
}

/** Serialize an inner header to its byte encoding. */
export function writeInnerHeader(inner: InnerHeader): Uint8Array {
  const writer = new ByteWriter();
  const writeField = (id: number, value: Uint8Array): void => {
    writer.writeU8(id);
    writer.writeI32(value.length);
    writer.writeBytes(value);
  };

  writeField(
    InnerHeaderFieldId.InnerRandomStreamId,
    new ByteWriter(4).writeI32(inner.innerRandomStreamId).toBytes(),
  );
  writeField(InnerHeaderFieldId.InnerRandomStreamKey, inner.innerRandomStreamKey);
  for (const binary of inner.binaries) {
    writeField(InnerHeaderFieldId.Binary, concatBytes(new Uint8Array([binary.flags]), binary.data));
  }
  writeField(InnerHeaderFieldId.EndOfHeader, new Uint8Array(0));
  return writer.toBytes();
}
