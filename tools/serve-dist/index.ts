/** Serves dist/ on a fixed port — 57932 by default ("KPWEB" on a T9 keypad) —
 * matching the authorized JavaScript origin the Google Drive connector signs in
 * from when served locally (see cloud-google-drive/page.ts's CLIENT_ID). It is
 * also the address the FAQ has people serve a downloaded copy on, since Google
 * refuses sign-in from a page opened from disk (#113). GIS requires the
 * signing-in origin to exactly match one of the client's configured origins, so
 * unlike e2e's own dist server this can't just bind whatever free port the OS
 * hands out.
 *
 * Reuses e2e's own static server rather than duplicating it. */
import { fileURLToPath } from 'node:url';
import { startDistServer } from '../../e2e/support/dist-server.ts';

const port = Number(process.env.PORT) || 57932;
const distDir = fileURLToPath(new URL('../../dist', import.meta.url));

const server = await startDistServer(distDir, port);
console.log(`Serving dist/ at ${server.origin}/`);
