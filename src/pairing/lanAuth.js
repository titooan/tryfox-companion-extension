"use strict";

(function(root, factory) {
  const exports = factory(root);

  if (typeof module !== "undefined" && module.exports) {
    module.exports = exports;
  }

  root.tryfoxLanAuth = exports;
})(typeof globalThis !== "undefined" ? globalThis : this, function(root) {
  const SIGNING_PREFIX = "TRYFOX-LAN-V1";

  function getCrypto() {
    const cryptoObject = root.crypto;

    if (!cryptoObject || !cryptoObject.subtle || typeof cryptoObject.getRandomValues !== "function") {
      throw new Error("Web Crypto API is unavailable");
    }

    return cryptoObject;
  }

  function getTextEncoder() {
    if (typeof TextEncoder !== "undefined") {
      return new TextEncoder();
    }

    throw new Error("TextEncoder is unavailable");
  }

  function bytesToBase64Url(bytes) {
    if (typeof Buffer !== "undefined") {
      return Buffer.from(bytes)
        .toString("base64")
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/g, "");
    }

    let binary = "";
    for (const byte of bytes) {
      binary += String.fromCharCode(byte);
    }

    return btoa(binary)
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/g, "");
  }

  function base64UrlToBytes(value) {
    const normalized = value
      .replace(/-/g, "+")
      .replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");

    if (typeof Buffer !== "undefined") {
      return new Uint8Array(Buffer.from(padded, "base64"));
    }

    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }

  function randomBase64Url(byteLength = 16) {
    const bytes = new Uint8Array(byteLength);
    getCrypto().getRandomValues(bytes);
    return bytesToBase64Url(bytes);
  }

  async function sha256Base64Url(value) {
    const data = getTextEncoder().encode(value);
    const digest = await getCrypto().subtle.digest("SHA-256", data);
    return bytesToBase64Url(new Uint8Array(digest));
  }

  async function hmacSha256Base64Url(secret, value) {
    const cryptoObject = getCrypto();
    const key = await cryptoObject.subtle.importKey(
      "raw",
      base64UrlToBytes(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
    const signature = await cryptoObject.subtle.sign(
      "HMAC",
      key,
      getTextEncoder().encode(value)
    );

    return bytesToBase64Url(new Uint8Array(signature));
  }

  async function createSigningString({ method, path, deviceId, extensionId, timestamp, nonce, body }) {
    const bodyHash = await sha256Base64Url(body);

    return [
      SIGNING_PREFIX,
      method.toUpperCase(),
      path,
      deviceId,
      extensionId,
      String(timestamp),
      nonce,
      bodyHash,
    ].join("\n");
  }

  async function signLanRequest({ method, path, deviceId, extensionId, timestamp, nonce, body, sharedSecret }) {
    const signingString = await createSigningString({
      method,
      path,
      deviceId,
      extensionId,
      timestamp,
      nonce,
      body,
    });

    return hmacSha256Base64Url(sharedSecret, signingString);
  }

  return {
    SIGNING_PREFIX,
    bytesToBase64Url,
    createSigningString,
    randomBase64Url,
    sha256Base64Url,
    signLanRequest,
  };
});
