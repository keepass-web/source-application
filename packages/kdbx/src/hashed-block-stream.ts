/** KDBX 3.1 hashed block stream: after the stream-start bytes, blocks of
`index‖SHA-256(data)‖size‖data`, ending with a size-0 block. */

import { ByteReader, ByteWriter, bytesEqual, concatBytes } from './bytes.ts';
import { sha256 } from './crypto.ts';

// Block size used when writing (KeePass uses 1 MiB).
const KX_HBS_BLOCK_SIZE = 1024 * 1024;
const KX_ZERO_HASH = new Uint8Array(32);

/** Verify and concatenate a hashed block stream into its payload. The blocks are
decrypted database content, so each copy is zeroed once joined (#145). */
export async function readHashedBlockStream(data: Uint8Array): Promise<Uint8Array> {
  const reader = new ByteReader(data);
  const chunks: Uint8Array[] = [];
  try {
    let expectedIndex = 0;
    for (;;) {
      const index = reader.readU32();
      const storedHash = reader.readBytes(32);
      const size = reader.readU32();
      if (index !== expectedIndex) {
        throw new Error('hashed block stream is out of order');
      }
      if (size === 0) {
        break;
      }
      const blockData = reader.readBytes(size);
      chunks.push(blockData);
      const hash = await sha256(blockData);
      if (!bytesEqual(hash, storedHash)) {
        throw new Error('hashed block stream integrity check failed');
      }
      expectedIndex += 1;
    }
    return concatBytes(...chunks);
  } finally {
    for (const chunk of chunks) chunk.fill(0);
  }
}

// Frame a payload as a hashed block stream; the writer's own copy of it is zeroed (#145).
export async function writeHashedBlockStream(
  payload: Uint8Array,
  blockSize: number = KX_HBS_BLOCK_SIZE,
): Promise<Uint8Array> {
  const writer = new ByteWriter(payload.length + 64);
  try {
    let index = 0;
    let offset = 0;
    while (offset < payload.length) {
      const end = Math.min(offset + blockSize, payload.length);
      const block = payload.subarray(offset, end);
      writer.writeU32(index);
      writer.writeBytes(await sha256(block));
      writer.writeU32(block.length);
      writer.writeBytes(block);
      index += 1;
      offset = end;
    }
    // Terminating block: size 0 with a zero hash.
    writer.writeU32(index);
    writer.writeBytes(KX_ZERO_HASH);
    writer.writeU32(0);
    return writer.toBytes();
  } finally {
    writer.wipe();
  }
}
