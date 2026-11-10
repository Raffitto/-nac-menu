import { createHash } from "node:crypto";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";

const rpID = "localhost";
const origins = ["http://localhost:4192", "http://localhost:3025", "http://127.0.0.1:4192", "http://127.0.0.1:3025"];
const challenges = new Map();

function remember(email, kind, challenge) {
  challenges.set(`${kind}:${email}`, { challenge, expires: Date.now() + 5 * 60 * 1000 });
}

function take(email, kind) {
  const key = `${kind}:${email}`;
  const row = challenges.get(key);
  challenges.delete(key);
  if (!row || row.expires < Date.now()) return null;
  return row.challenge;
}

export function passkeyUserId(email) {
  return new Uint8Array(createHash("sha256").update(String(email).toLowerCase()).digest());
}

export async function registrationOptions(email, credentialIds) {
  const options = await generateRegistrationOptions({
    rpName: "NAC local development",
    rpID,
    userName: email,
    userID: passkeyUserId(email),
    attestationType: "none",
    excludeCredentials: credentialIds.map((id) => ({ id })),
    authenticatorSelection: { residentKey: "preferred", userVerification: "preferred" },
  });
  remember(email, "register", options.challenge);
  return options;
}

export async function verifyRegistration(email, response) {
  const expectedChallenge = take(email, "register");
  if (!expectedChallenge) throw new Error("passkey_challenge_expired");
  const verified = await verifyRegistrationResponse({
    response,
    expectedChallenge,
    expectedOrigin: origins,
    expectedRPID: rpID,
  });
  if (!verified.verified) throw new Error("passkey_not_verified");
  return verified.registrationInfo.credential;
}

export async function authenticationOptions(email, credentialIds) {
  const options = await generateAuthenticationOptions({
    rpID,
    allowCredentials: credentialIds.map((id) => ({ id })),
    userVerification: "preferred",
  });
  remember(email, "login", options.challenge);
  return options;
}

export async function verifyAuthentication(email, response, credential) {
  const expectedChallenge = take(email, "login");
  if (!expectedChallenge) throw new Error("passkey_challenge_expired");
  const verified = await verifyAuthenticationResponse({
    response,
    expectedChallenge,
    expectedOrigin: origins,
    expectedRPID: rpID,
    credential: {
      id: credential.credential_id,
      publicKey: credential.public_key,
      counter: Number(credential.counter),
    },
  });
  if (!verified.verified) throw new Error("passkey_not_verified");
  return verified.authenticationInfo.newCounter;
}
