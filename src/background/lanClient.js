"use strict";

(function(root, factory) {
  const exports = factory(root);

  if (typeof module !== "undefined" && module.exports) {
    module.exports = exports;
  }

  root.tryfoxLanClient = exports;
})(typeof globalThis !== "undefined" ? globalThis : this, function(root) {
  const {
    randomBase64Url,
    signLanRequest,
  } = root.tryfoxLanAuth || require("../pairing/lanAuth.js");

  function createTryRevisionMessage(tryPayload, options = {}) {
    return {
      version: 1,
      type: "try-revision",
      messageId: options.messageId || randomBase64Url(16),
      sentAt: options.sentAt || Date.now(),
      sourceUrl: tryPayload.sourceUrl,
      tryfoxDeepLink: tryPayload.tryfoxDeepLink,
      repo: tryPayload.repo || null,
      revision: tryPayload.revision || null,
      author: tryPayload.author || null,
    };
  }

  async function sendTryRevisionToAndroid({ device, extensionId, tryPayload, fetchImpl, now }) {
    if (!device || !device.endpoint || !device.sharedSecret || !device.deviceId) {
      throw new Error("Android device record is incomplete");
    }

    if (!extensionId) {
      throw new Error("Extension install id is missing");
    }

    const endpointUrl = new URL(device.endpoint);
    const bodyObject = createTryRevisionMessage(tryPayload, {
      sentAt: now || Date.now(),
    });
    const body = JSON.stringify(bodyObject);
    const timestamp = bodyObject.sentAt;
    const nonce = randomBase64Url(16);
    const signature = await signLanRequest({
      method: "POST",
      path: endpointUrl.pathname,
      deviceId: device.deviceId,
      extensionId,
      timestamp,
      nonce,
      body,
      sharedSecret: device.sharedSecret,
    });
    const requestFetch = fetchImpl || root.fetch;

    if (typeof requestFetch !== "function") {
      throw new Error("fetch is unavailable");
    }

    const response = await requestFetch(device.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Tryfox-Device-Id": device.deviceId,
        "X-Tryfox-Extension-Id": extensionId,
        "X-Tryfox-Timestamp": String(timestamp),
        "X-Tryfox-Nonce": nonce,
        "X-Tryfox-Signature": signature,
      },
      body,
    });

    if (!response.ok) {
      let detail = "";
      try {
        detail = await response.text();
      } catch (error) {
        detail = "";
      }
      throw new Error(`Android receiver returned ${response.status}${detail ? `: ${detail}` : ""}`);
    }

    if (typeof response.json === "function") {
      return response.json();
    }

    return { ok: true };
  }

  return {
    createTryRevisionMessage,
    sendTryRevisionToAndroid,
  };
});
