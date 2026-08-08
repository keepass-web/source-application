/** Fills in the verify command shown in the trust disclosure: a file already
on disk (opened locally, or a local build) skips the download step a hosted
visit needs. */

const code = must(document.getElementById('verify-command'));
code.textContent = verifyCommand(window.location.protocol, window.location.origin);
