/**
 * HMAC-protected block stream (KDBX 4.x).
 *
 * The (encrypted) payload is split into blocks; each stored block is
 *   HMAC-SHA-256(index_u64le ‖ size_i32le ‖ data) ‖ size_i32le ‖ data
 * where the per-block HMAC key depends on the block index. The stream ends with
 * a block whose size is 0. Verification uses an Encrypt-then-MAC scheme, so the
 * integrity/authenticity check happens before decryption.
 */

import { ByteReader, ByteWriter, bytesEqualConstantTime, concatBytes } from './bytes.ts';
import { hmacSha256 } from './crypto.ts';
import { deriveBlockHmacKey } from './key.ts';

/** Block size used when writing (KeePass uses 1 MiB for all but the last block). */
const KX_HMS_BLOCK_SIZE = 1024 * 1024;

async function kx_blockMac(
  hmacBaseKey: Uint8Array,
  index: bigint,
  data: Uint8Array,
): Promise<Uint8Array> {
  const blockKey = await deriveBlockHmacKey(hmacBaseKey, index);
  const indexBytes = new ByteWriter(8).writeU64(index).toBytes();
  const sizeBytes = new ByteWriter(4).writeI32(data.length).toBytes();
  return hmacSha256(blockKey, concatBytes(indexBytes, sizeBytes, data));
}

/** Verify and concatenate an HMAC-protected block stream into its payload. */
export async function readHmacBlockStream(
  data: Uint8Array,
  hmacBaseKey: Uint8Array,
): Promise<Uint8Array> {
  const reader = new ByteReader(data);
  const chunks: Uint8Array[] = [];
  let index = 0n;
  for (;;) {
    const storedMac = reader.readBytes(32);
    const size = reader.readI32();
    if (size < 0) {
      throw new Error('invalid HMAC block size');
    }
    const blockData = reader.readBytes(size);
    const expectedMac = await kx_blockMac(hmacBaseKey, index, blockData);
    if (!bytesEqualConstantTime(expectedMac, storedMac)) {
      throw new Error('HMAC verification failed (wrong credentials or corrupt file)');
    }
    if (size === 0) {
      break;
    }
    chunks.push(blockData);
    index += 1n;
  }
  return concatBytes(...chunks);
}

/** Frame a payload as an HMAC-protected block stream. */
export async function writeHmacBlockStream(
  payload: Uint8Array,
  hmacBaseKey: Uint8Array,
  blockSize: number = KX_HMS_BLOCK_SIZE,
): Promise<Uint8Array> {
  const writer = new ByteWriter(payload.length + 64);
  let index = 0n;
  let offset = 0;

  const writeBlock = async (block: Uint8Array): Promise<void> => {
    writer.writeBytes(await kx_blockMac(hmacBaseKey, index, block));
    writer.writeI32(block.length);
    writer.writeBytes(block);
    index += 1n;
  };

  while (offset < payload.length) {
    const end = Math.min(offset + blockSize, payload.length);
    await writeBlock(payload.subarray(offset, end));
    offset = end;
  }
  await writeBlock(new Uint8Array(0));
  return writer.toBytes();
}
