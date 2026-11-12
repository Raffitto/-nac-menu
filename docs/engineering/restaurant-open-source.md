# Restaurant service open-source reuse

Local development only. No production deploy is authorized by this note.

## Adopted

| Package | Version | License | Use | Modification |
| --- | --- | --- | --- | --- |
| `@simplewebauthn/server` | 14.1.0 | MIT | Verify passkey registration and sign-in on the local API | None. NAC stores the credential id, public key, and signature counter only. |
| `@simplewebauthn/browser` | 14.0.0 | MIT | Browser calls to `navigator.credentials` on the host desk | None. |

Passkeys are optional. The existing staff password still signs in. A revoked staff grant blocks both the password session and a later passkey sign-in. Challenges live in the API process for five minutes and are not written to the database. The relying party id is `localhost`. The library is not configured to download FIDO metadata.

Node 24 is the development runtime. The server package declares Node 22 or newer.

## Adopted for tests

| Package | Version | License | Use | Modification |
| --- | --- | --- | --- | --- |
| `playwright` | 1.56.1 | Apache-2.0 | Local Chromium journey against the development desk and database | None. Browsers stay on this computer. Guest data is not sent to Playwright's network. |

## Evaluated and not imported

Whole POS, kitchen, and reservation platforms were not imported. Mature projects in that category are either complete products with their own databases or use GPL/AGPL terms. NAC keeps its shared Postgres schema, branch grants, and phone waiter screen.

## Not stored

Biometric templates, fingerprints, face data, and authenticator PINs are not stored. WebAuthn verification stays on the device. The database receives a public key and a counter.
