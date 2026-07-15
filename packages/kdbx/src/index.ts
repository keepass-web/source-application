/**
 * `kdbx` — a KDBX 3.1 and 4.x parser and serializer.
 *
 * The entry points are {@link Kdbx} (load/save/create) and {@link Credentials}
 * (composite key). Lower-level building blocks (headers, block streams, the XML
 * tree, VariantDictionary, crypto helpers) are also exported for callers that
 * need to work below the database abstraction.
 */

export {
  ByteReader,
  ByteWriter,
  bytesEqual,
  concatBytes,
  fromBase64,
  fromHex,
  toBase64,
  toHex,
  utf8Decode,
  utf8Encode,
} from './bytes.ts';
export {
  Argon2Version,
  CipherId,
  Compression,
  InnerStreamCipher,
  KdfId,
} from './constants.ts';
export { Credentials, type CredentialsInput, keyFileComponent } from './credentials.ts';
export {
  aesCbcDecrypt,
  aesCbcEncrypt,
  aesKdfTransform,
  getRandomBytes,
  gunzip,
  gzip,
  hmacSha256,
  sha256,
  sha512,
} from './crypto.ts';
export {
  type KdbxVersion,
  type OuterHeader,
  type ParsedOuterHeader,
  readOuterHeader,
  writeOuterHeader,
} from './header.ts';
export {
  type InnerBinary,
  type InnerHeader,
  readInnerHeader,
  writeInnerHeader,
} from './inner-header.ts';
export {
  Kdbx,
  type KdbxCipher,
  type KdbxCreateOptions,
  type KdbxKdf,
} from './kdbx.ts';
export {
  addEntryAttachment,
  appendChild,
  cloneElement,
  createDatabaseDocument,
  createElement,
  createEntry,
  createGroup,
  type EntryAttachment,
  type EntryField,
  type EntryInput,
  type EntryTimes,
  findOrCreateRecycleBin,
  getAttribute,
  getChild,
  getChildren,
  getEntryAttachments,
  getEntryTags,
  getEntryTimes,
  getText,
  isInRecycleBin,
  ProtectedValue,
  removeEntryAttachment,
  renameEntryAttachment,
  setAttribute,
  setEntryExpiry,
  setEntryTags,
  setText,
  touchLastModified,
} from './model.ts';
export {
  readVariantDictionary,
  type VariantDictionary,
  VdType,
  type VdValue,
  writeVariantDictionary,
} from './variant-dictionary.ts';
export {
  parseXml,
  serializeXml,
  type XmlElement,
  type XmlNode,
  type XmlText,
} from './xml.ts';
