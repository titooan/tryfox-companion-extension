"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

if (!globalThis.crypto) {
  globalThis.crypto = require("node:crypto").webcrypto;
}

const {
  createTryRevisionMessage,
  pingAndroidDevice,
  sendTryRevisionToAndroid,
} = require("../src/background/lanClient.js");

const device = {
  deviceId: "device_abcdefghijkl",
  deviceName: "Pixel 8",
  endpoint: "http://192.168.1.42:8765/tryfox/v1/messages",
  sharedSecret: "abcdefghijklmnopqrstuvwxyzABCDEFG",
};

const tryPayload = {
  sourceUrl: "https://treeherder.mozilla.org/jobs?repo=try&revision=abcdef",
  tryfoxDeepLink: "tryfox://jobs?repo=try&revision=abcdef",
  repo: "try",
  revision: "abcdef",
  author: null,
  title: "Bug 123456",
};

test("creates Try revision messages", () => {
  const message = createTryRevisionMessage(tryPayload, {
    messageId: "message_1",
    sentAt: 1760000000000,
  });

  assert.deepEqual(message, {
    version: 1,
    type: "try-revision",
    messageId: "message_1",
    sentAt: 1760000000000,
    sourceUrl: tryPayload.sourceUrl,
    tryfoxDeepLink: tryPayload.tryfoxDeepLink,
    repo: "try",
    revision: "abcdef",
    author: null,
    title: "Bug 123456",
  });
});

test("sends signed HTTP requests to Android", async () => {
  const calls = [];
  const response = await sendTryRevisionToAndroid({
    device,
    extensionId: "extension_abcdefghi",
    tryPayload,
    now: 1760000000000,
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return {
        ok: true,
        json: async () => ({ ok: true, messageId: JSON.parse(options.body).messageId }),
      };
    },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, device.endpoint);
  assert.equal(calls[0].options.method, "POST");
  assert.equal(calls[0].options.headers["Content-Type"], "application/json");
  assert.equal(calls[0].options.headers["X-Tryfox-Device-Id"], device.deviceId);
  assert.equal(calls[0].options.headers["X-Tryfox-Extension-Id"], "extension_abcdefghi");
  assert.equal(calls[0].options.headers["X-Tryfox-Timestamp"], "1760000000000");
  assert.match(calls[0].options.headers["X-Tryfox-Nonce"], /^[A-Za-z0-9_-]+$/);
  assert.match(calls[0].options.headers["X-Tryfox-Signature"], /^[A-Za-z0-9_-]+$/);
  assert.equal(JSON.parse(calls[0].options.body).revision, "abcdef");
  assert.equal(JSON.parse(calls[0].options.body).title, "Bug 123456");
  assert.equal(response.ok, true);
});

test("serializes absent labels as null before signing", () => {
  const message = createTryRevisionMessage({
    ...tryPayload,
    title: "   ",
  }, {
    messageId: "message_2",
    sentAt: 1760000000001,
  });

  assert.equal(message.title, null);
});

test("pings Android receiver endpoints", async () => {
  const calls = [];
  const response = await pingAndroidDevice({
    device,
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return {
        ok: false,
        status: 405,
      };
    },
  });

  assert.equal(response.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, device.endpoint);
  assert.equal(calls[0].options.method, "GET");
  assert.equal(calls[0].options.cache, "no-store");
});

test("throws useful errors for Android error responses", async () => {
  await assert.rejects(
    () => sendTryRevisionToAndroid({
      device,
      extensionId: "extension_abcdefghi",
      tryPayload,
      fetchImpl: async () => ({
        ok: false,
        status: 401,
        text: async () => "invalid signature",
      }),
    }),
    /401: invalid signature/
  );
});
