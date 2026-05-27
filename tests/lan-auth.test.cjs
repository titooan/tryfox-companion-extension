"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

if (!globalThis.crypto) {
  globalThis.crypto = require("node:crypto").webcrypto;
}

const {
  createSigningString,
  randomBase64Url,
  signLanRequest,
} = require("../src/pairing/lanAuth.js");

const request = {
  method: "POST",
  path: "/tryfox/v1/messages",
  deviceId: "device_abcdefghijkl",
  extensionId: "extension_abcdefghi",
  timestamp: 1760000000000,
  nonce: "nonce_abcdefghijkl",
  body: JSON.stringify({ type: "try-revision", revision: "abcdef" }),
  sharedSecret: "abcdefghijklmnopqrstuvwxyzABCDEFG",
};

test("creates deterministic HMAC signatures", async () => {
  const first = await signLanRequest(request);
  const second = await signLanRequest(request);

  assert.equal(first, second);
  assert.match(first, /^[A-Za-z0-9_-]+$/);
});

test("signature changes when signed fields change", async () => {
  const original = await signLanRequest(request);
  const changedBody = await signLanRequest({
    ...request,
    body: JSON.stringify({ type: "try-revision", revision: "123456" }),
  });
  const changedNonce = await signLanRequest({
    ...request,
    nonce: "nonce_changed",
  });

  assert.notEqual(original, changedBody);
  assert.notEqual(original, changedNonce);
});

test("signing string includes stable request fields", async () => {
  const signingString = await createSigningString(request);
  const parts = signingString.split("\n");

  assert.equal(parts[0], "TRYFOX-LAN-V1");
  assert.equal(parts[1], "POST");
  assert.equal(parts[2], "/tryfox/v1/messages");
  assert.equal(parts[3], request.deviceId);
  assert.equal(parts[4], request.extensionId);
  assert.equal(parts[5], String(request.timestamp));
  assert.equal(parts[6], request.nonce);
  assert.match(parts[7], /^[A-Za-z0-9_-]+$/);
});

test("generates URL-safe random ids", () => {
  const first = randomBase64Url(16);
  const second = randomBase64Url(16);

  assert.match(first, /^[A-Za-z0-9_-]+$/);
  assert.notEqual(first, second);
});
