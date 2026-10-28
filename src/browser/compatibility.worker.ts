import { verifySqliteCompatibility } from './compatibility';
void verifySqliteCompatibility().then(
  result => postMessage({ ok: true, result }),
  error => postMessage({ ok: false, error: String(error), stack: error?.stack }),
);
