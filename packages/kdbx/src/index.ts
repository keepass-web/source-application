/** `kdbx` — a KDBX 3.1/4.x parser and serializer. Entry points: `Kdbx`
and `Credentials`; lower-level pieces are exported too for callers that need them. */

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
  deleteHistoryEntry,
  type EntryAttachment,
  type EntryField,
  type EntryInput,
  type EntryTimes,
  findOrCreateRecycleBin,
  getAttribute,
  getChild,
  getChildren,
  getEntryAttachments,
  getEntryHistory,
  getEntryTags,
  getEntryTimes,
  getText,
  isInRecycleBin,
  ProtectedValue,
  pushHistorySnapshot,
  removeEntryAttachment,
  renameEntryAttachment,
  restoreHistoryEntry,
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
