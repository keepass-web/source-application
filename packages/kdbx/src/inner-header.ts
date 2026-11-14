// Inner header (4.x only): the stream cipher ID/key, plus binaries referenced by the XML.

import { ByteReader, ByteWriter } from './bytes.ts';
import { InnerHeaderFieldId, InnerStreamCipher } from './constants.ts';

// A binary attachment stored in the inner header.
export interface InnerBinary {
  // Flags byte; 0x01 marks content that should be memory-protected.
  flags: number;
  data: Uint8Array;
}

// Decoded inner header.
export interface InnerHeader {
  innerRandomStreamId: number;
  innerRandomStreamKey: Uint8Array;
  binaries: InnerBinary[];
}

// Result of reading the inner header: the header plus the XML bytes that follow.
export interface ParsedInnerHeader {
  inner: InnerHeader;
  xml: Uint8Array;
}

/** Parse the inner header from the start of a decrypted, decompressed payload. Each field
read is a copy of decrypted content: one not kept is zeroed, and if the header turns out
malformed, so are the stream key and attachments read so far (#145). */
export function readInnerHeader(payload: Uint8Array): ParsedInnerHeader {
  const reader = new ByteReader(payload);
  const binaries: InnerBinary[] = [];
  let innerRandomStreamId: number = InnerStreamCipher.ChaCha20;
  let innerRandomStreamKey: Uint8Array = new Uint8Array(0);
  let xml: Uint8Array;

  try {
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
          value.fill(0);
          break;
        default:
          value.fill(0);
          break;
      }
    }
    xml = reader.readRest();
  } catch (err) {
    innerRandomStreamKey.fill(0);
    for (const binary of binaries) binary.data.fill(0);
    throw err;
  }

  return { inner: { innerRandomStreamId, innerRandomStreamKey, binaries }, xml };
}

// Serialize an inner header to its byte encoding; the writer's own copy is zeroed (#145).
export function writeInnerHeader(inner: InnerHeader): Uint8Array {
  const writer = new ByteWriter();
  const writeField = (id: number, value: Uint8Array): void => {
    writer.writeU8(id);
    writer.writeI32(value.length);
    writer.writeBytes(value);
  };

  try {
    writeField(
      InnerHeaderFieldId.InnerRandomStreamId,
      new ByteWriter(4).writeI32(inner.innerRandomStreamId).toBytes(),
    );
    writeField(InnerHeaderFieldId.InnerRandomStreamKey, inner.innerRandomStreamKey);
    for (const binary of inner.binaries) {
      writer.writeU8(InnerHeaderFieldId.Binary);
      writer.writeI32(binary.data.length + 1);
      writer.writeU8(binary.flags);
      writer.writeBytes(binary.data);
    }
    writeField(InnerHeaderFieldId.EndOfHeader, new Uint8Array(0));
    return writer.toBytes();
  } finally {
    writer.wipe();
  }
}
