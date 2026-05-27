"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  getEndpointPermissionPattern,
  getEndpointOrigin,
  isPrivateIpv4,
  parseAndroidLanPayload,
  validateAndroidLanPayload,
} = require("../src/pairing/androidLanPayload.js");

function validPayload(overrides = {}) {
  return {
    version: 1,
    mode: "tryfox-lan-receive",
    deviceId: "device_abcdefghijkl",
    deviceName: "Pixel 8",
    endpoint: "http://192.168.1.42:8765/tryfox/v1/messages",
    sharedSecret: "abcdefghijklmnopqrstuvwxyzABCDEFG",
    expiresAt: 4102444800000,
    ...overrides,
  };
}

test("accepts valid private LAN Android QR payloads", () => {
  const payload = validPayload();

  assert.equal(validateAndroidLanPayload(payload), true);
  assert.deepEqual(parseAndroidLanPayload(JSON.stringify(payload)), payload);
  assert.equal(getEndpointOrigin(payload.endpoint), "http://192.168.1.42:8765");
  assert.equal(getEndpointPermissionPattern(payload.endpoint), "http://192.168.1.42/*");
});

test("recognizes private IPv4 ranges", () => {
  assert.equal(isPrivateIpv4("10.0.0.2"), true);
  assert.equal(isPrivateIpv4("172.16.0.2"), true);
  assert.equal(isPrivateIpv4("172.31.255.250"), true);
  assert.equal(isPrivateIpv4("192.168.1.2"), true);
  assert.equal(isPrivateIpv4("172.32.0.2"), false);
  assert.equal(isPrivateIpv4("8.8.8.8"), false);
  assert.equal(isPrivateIpv4("localhost"), false);
});

test("rejects public, non-http, expired, and wrong-path endpoints", () => {
  assert.throws(
    () => validateAndroidLanPayload(validPayload({ endpoint: "http://8.8.8.8:8765/tryfox/v1/messages" })),
    /private LAN/
  );
  assert.throws(
    () => validateAndroidLanPayload(validPayload({ endpoint: "https://192.168.1.42:8765/tryfox/v1/messages" })),
    /must use http/
  );
  assert.throws(
    () => validateAndroidLanPayload(validPayload({ endpoint: "http://192.168.1.42:8765/wrong" })),
    /path/
  );
  assert.throws(
    () => validateAndroidLanPayload(validPayload({ expiresAt: 1 })),
    /expired/
  );
});

test("allows localhost only when explicitly enabled", () => {
  const payload = validPayload({
    endpoint: "http://127.0.0.1:8765/tryfox/v1/messages",
  });

  assert.throws(() => validateAndroidLanPayload(payload), /private LAN/);
  assert.equal(validateAndroidLanPayload(payload, { allowLocalhost: true }), true);
});
