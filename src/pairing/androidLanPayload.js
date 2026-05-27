"use strict";

(function(root, factory) {
  const exports = factory(root);

  if (typeof module !== "undefined" && module.exports) {
    module.exports = exports;
  }

  root.tryfoxAndroidLanPayload = exports;
})(typeof globalThis !== "undefined" ? globalThis : this, function(root) {
  const PAYLOAD_VERSION = 1;
  const PAYLOAD_MODE = "tryfox-lan-receive";
  const EXPECTED_PATH = "/tryfox/v1/messages";

  function parseAndroidLanPayload(rawPayload, options = {}) {
    let payload = rawPayload;

    if (typeof rawPayload === "string") {
      try {
        payload = JSON.parse(rawPayload);
      } catch (error) {
        throw new Error("Android QR payload is not valid JSON");
      }
    }

    validateAndroidLanPayload(payload, options);
    return payload;
  }

  function validateAndroidLanPayload(payload, options = {}) {
    const now = options.now || Date.now();

    if (!payload || typeof payload !== "object") {
      throw new Error("Android QR payload must be an object");
    }

    if (payload.version !== PAYLOAD_VERSION) {
      throw new Error("Unsupported Android QR payload version");
    }

    if (payload.mode !== PAYLOAD_MODE) {
      throw new Error("Unsupported Android QR payload mode");
    }

    if (typeof payload.deviceId !== "string" || payload.deviceId.length < 16) {
      throw new Error("Android QR payload deviceId is invalid");
    }

    if (typeof payload.deviceName !== "string" || payload.deviceName.length === 0) {
      throw new Error("Android QR payload deviceName is invalid");
    }

    if (typeof payload.sharedSecret !== "string" || payload.sharedSecret.length < 32) {
      throw new Error("Android QR payload sharedSecret is invalid");
    }

    if (!Number.isFinite(payload.expiresAt) || payload.expiresAt <= now) {
      throw new Error("Android QR payload is expired");
    }

    const endpointUrl = parseEndpoint(payload.endpoint);

    if (endpointUrl.protocol !== "http:") {
      throw new Error("Android QR payload endpoint must use http");
    }

    if (endpointUrl.pathname !== EXPECTED_PATH) {
      throw new Error("Android QR payload endpoint path is invalid");
    }

    if (!isAllowedLanHost(endpointUrl.hostname, options)) {
      throw new Error("Android QR payload endpoint host must be private LAN");
    }

    return true;
  }

  function parseEndpoint(endpoint) {
    if (typeof endpoint !== "string") {
      throw new Error("Android QR payload endpoint is invalid");
    }

    try {
      return new URL(endpoint);
    } catch (error) {
      throw new Error("Android QR payload endpoint is invalid");
    }
  }

  function getEndpointOrigin(endpoint) {
    return parseEndpoint(endpoint).origin;
  }

  function getEndpointPermissionPattern(endpoint) {
    const endpointUrl = parseEndpoint(endpoint);
    return `${endpointUrl.protocol}//${endpointUrl.hostname}/*`;
  }

  function isAllowedLanHost(hostname, options = {}) {
    if (options.allowLocalhost && (hostname === "localhost" || hostname === "127.0.0.1")) {
      return true;
    }

    return isPrivateIpv4(hostname);
  }

  function isPrivateIpv4(hostname) {
    const parts = hostname.split(".");
    if (parts.length !== 4) {
      return false;
    }

    const octets = parts.map(part => {
      if (!/^\d+$/.test(part)) {
        return NaN;
      }

      const number = Number(part);
      return number >= 0 && number <= 255 ? number : NaN;
    });

    if (octets.some(Number.isNaN)) {
      return false;
    }

    const [first, second] = octets;
    return first === 10
      || (first === 172 && second >= 16 && second <= 31)
      || (first === 192 && second === 168);
  }

  return {
    EXPECTED_PATH,
    PAYLOAD_MODE,
    PAYLOAD_VERSION,
    getEndpointPermissionPattern,
    getEndpointOrigin,
    isPrivateIpv4,
    parseAndroidLanPayload,
    validateAndroidLanPayload,
  };
});
