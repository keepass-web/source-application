/**
 * VariantDictionary — the name/value container used by KDBX 4.x for KDF
 * parameters (header field 11) and public custom data (header field 12).
 *
 * Layout (all integers little-endian):
 *   UInt16 version (current 0x0100; the high byte is the critical major version)
 *   zero or more items, each: type byte ‖ Int32 name size ‖ name ‖ Int32 value size ‖ value
 *   a terminating null byte (0x00)
 */

import { ByteReader, ByteWriter, utf8Decode, utf8Encode } from './bytes.ts';

/** VariantDictionary value type tags. */
export const VdType = {
  UInt32: 0x04,
  UInt64: 0x05,
  Bool: 0x08,
  Int32: 0x0c,
  Int64: 0x0d,
  String: 0x18,
  Bytes: 0x42,
} as const;

/** A tagged VariantDictionary value. */
export type VdValue =
  | { readonly type: 'uint32'; readonly value: number }
  | { readonly type: 'uint64'; readonly value: bigint }
  | { readonly type: 'bool'; readonly value: boolean }
  | { readonly type: 'int32'; readonly value: number }
  | { readonly type: 'int64'; readonly value: bigint }
  | { readonly type: 'string'; readonly value: string }
  | { readonly type: 'bytes'; readonly value: Uint8Array };

/** A VariantDictionary, preserving insertion order. */
export type VariantDictionary = Map<string, VdValue>;

const KX_CURRENT_MAJOR = 1;
const KX_CURRENT_VERSION = 0x0100;

/** Parse a VariantDictionary from its byte encoding. */
export function readVariantDictionary(bytes: Uint8Array): VariantDictionary {
  const reader = new ByteReader(bytes);
  const version = reader.readU16();
  const major = (version >> 8) & 0xff;
  if (major > KX_CURRENT_MAJOR) {
    throw new Error(`unsupported VariantDictionary version 0x${version.toString(16)}`);
  }

  const dict: VariantDictionary = new Map();
  for (;;) {
    const type = reader.readU8();
    if (type === 0x00) {
      break;
    }
    const nameSize = reader.readI32();
    const name = utf8Decode(reader.readBytes(nameSize));
    const valueSize = reader.readI32();
    const valueBytes = reader.readBytes(valueSize);
    dict.set(name, kx_decodeValue(type, valueBytes));
  }
  return dict;
}

function kx_decodeValue(type: number, bytes: Uint8Array): VdValue {
  const reader = new ByteReader(bytes);
  switch (type) {
    case VdType.UInt32:
      return { type: 'uint32', value: reader.readU32() };
    case VdType.UInt64:
      return { type: 'uint64', value: reader.readU64() };
    case VdType.Bool:
      return { type: 'bool', value: reader.readU8() !== 0 };
    case VdType.Int32:
      return { type: 'int32', value: reader.readI32() };
    case VdType.Int64:
      return { type: 'int64', value: reader.readI64() };
    case VdType.String:
      return { type: 'string', value: utf8Decode(bytes) };
    case VdType.Bytes:
      return { type: 'bytes', value: bytes };
    default:
      throw new Error(`unsupported VariantDictionary value type 0x${type.toString(16)}`);
  }
}

/** Serialize a VariantDictionary to its byte encoding. */
export function writeVariantDictionary(dict: VariantDictionary): Uint8Array {
  const writer = new ByteWriter();
  writer.writeU16(KX_CURRENT_VERSION);
  for (const [name, value] of dict) {
    const nameBytes = utf8Encode(name);
    writer.writeU8(kx_typeTag(value));
    writer.writeI32(nameBytes.length);
    writer.writeBytes(nameBytes);
    const valueBytes = kx_encodeValue(value);
    writer.writeI32(valueBytes.length);
    writer.writeBytes(valueBytes);
  }
  writer.writeU8(0x00);
  return writer.toBytes();
}

function kx_typeTag(value: VdValue): number {
  switch (value.type) {
    case 'uint32':
      return VdType.UInt32;
    case 'uint64':
      return VdType.UInt64;
    case 'bool':
      return VdType.Bool;
    case 'int32':
      return VdType.Int32;
    case 'int64':
      return VdType.Int64;
    case 'string':
      return VdType.String;
    case 'bytes':
      return VdType.Bytes;
  }
}

function kx_encodeValue(value: VdValue): Uint8Array {
  switch (value.type) {
    case 'uint32':
      return new ByteWriter(4).writeU32(value.value).toBytes();
    case 'uint64':
      return new ByteWriter(8).writeU64(value.value).toBytes();
    case 'bool':
      return new ByteWriter(1).writeU8(value.value ? 1 : 0).toBytes();
    case 'int32':
      return new ByteWriter(4).writeI32(value.value).toBytes();
    case 'int64':
      return new ByteWriter(8).writeI64(value.value).toBytes();
    case 'string':
      return utf8Encode(value.value);
    case 'bytes':
      return value.value;
  }
}

/** Read a `bytes` item, or throw if it is missing or of the wrong type. */
export function vdRequireBytes(dict: VariantDictionary, name: string): Uint8Array {
  const value = dict.get(name);
  if (value?.type !== 'bytes') {
    throw new Error(`VariantDictionary item "${name}" is missing or not a byte array`);
  }
  return value.value;
}

/** Read an integer item (`uint32`/`uint64`/`int32`/`int64`) as a bigint, or throw. */
export function vdRequireInt(dict: VariantDictionary, name: string): bigint {
  const value = dict.get(name);
  switch (value?.type) {
    case 'uint32':
    case 'int32':
      return BigInt(value.value);
    case 'uint64':
    case 'int64':
      return value.value;
    default:
      throw new Error(`VariantDictionary item "${name}" is missing or not an integer`);
  }
}
