"use strict";

(function(root) {
  const {
    getEndpointPermissionPattern,
    parseAndroidLanPayload,
  } = root.tryfoxAndroidLanPayload;
  const { randomBase64Url } = root.tryfoxLanAuth;
  const { sendTryRevisionToAndroid } = root.tryfoxLanClient;

  const STORAGE_KEYS = {
    DEVICE: "tryfoxAndroidDevice",
    EXTENSION_ID: "tryfoxExtensionId",
  };

  const MESSAGE_TYPES = {
    GET_ANDROID_STATE: "GET_ANDROID_STATE",
    OPEN_ANDROID_SCANNER: "OPEN_ANDROID_SCANNER",
    ANDROID_QR_SCANNED: "ANDROID_QR_SCANNED",
    SEND_TRY_TO_ANDROID: "SEND_TRY_TO_ANDROID",
    FORGET_ANDROID_DEVICE: "FORGET_ANDROID_DEVICE",
  };

  let pendingTryPayload = null;
  let lastStatus = "Idle";

  function getBrowser() {
    if (!root.browser) {
      throw new Error("browser API is unavailable");
    }

    return root.browser;
  }

  async function getExtensionId() {
    const browserApi = getBrowser();
    const stored = await browserApi.storage.local.get(STORAGE_KEYS.EXTENSION_ID);

    if (stored[STORAGE_KEYS.EXTENSION_ID]) {
      return stored[STORAGE_KEYS.EXTENSION_ID];
    }

    const extensionId = randomBase64Url(16);
    await browserApi.storage.local.set({
      [STORAGE_KEYS.EXTENSION_ID]: extensionId,
    });
    return extensionId;
  }

  async function getStoredDevice() {
    const browserApi = getBrowser();
    const stored = await browserApi.storage.local.get(STORAGE_KEYS.DEVICE);
    return stored[STORAGE_KEYS.DEVICE] || null;
  }

  function publicDevice(device) {
    if (!device) {
      return null;
    }

    return {
      deviceId: device.deviceId,
      deviceName: device.deviceName,
      endpoint: device.endpoint,
      endpointPermissionPattern: getEndpointPermissionPattern(device.endpoint),
      pairedAt: device.pairedAt,
      lastSeenAt: device.lastSeenAt || null,
    };
  }

  async function setStoredDevice(device) {
    await getBrowser().storage.local.set({
      [STORAGE_KEYS.DEVICE]: device,
    });
  }

  async function clearStoredDevice() {
    await getBrowser().storage.local.remove(STORAGE_KEYS.DEVICE);
  }

  async function getAndroidState() {
    const device = await getStoredDevice();

    return {
      status: lastStatus,
      device: publicDevice(device),
      hasDevice: Boolean(device),
      hasPendingTryPayload: Boolean(pendingTryPayload),
    };
  }

  function validateTryPayload(tryPayload) {
    if (!tryPayload || typeof tryPayload !== "object") {
      throw new Error("Try payload is missing");
    }

    if (typeof tryPayload.sourceUrl !== "string" || typeof tryPayload.tryfoxDeepLink !== "string") {
      throw new Error("Try payload is invalid");
    }

    if (!tryPayload.revision && !tryPayload.author) {
      throw new Error("Try payload must include a revision or author");
    }

    return tryPayload;
  }

  async function openAndroidScanner(message) {
    pendingTryPayload = message.tryPayload ? validateTryPayload(message.tryPayload) : null;
    lastStatus = "Scan the QR code shown by Android";

    await getBrowser().tabs.create({
      url: getBrowser().runtime.getURL("scanner/scanner.html"),
      active: true,
    });

    return getAndroidState();
  }

  async function saveScannedAndroidDevice(payload) {
    const parsedPayload = parseAndroidLanPayload(payload);
    const now = Date.now();
    const device = {
      deviceId: parsedPayload.deviceId,
      deviceName: parsedPayload.deviceName,
      endpoint: parsedPayload.endpoint,
      sharedSecret: parsedPayload.sharedSecret,
      pairedAt: now,
      lastSeenAt: null,
    };

    await setStoredDevice(device);
    lastStatus = `Paired with ${device.deviceName}`;
    return device;
  }

  async function sendToDevice(device, tryPayload) {
    const extensionId = await getExtensionId();
    const response = await sendTryRevisionToAndroid({
      device,
      extensionId,
      tryPayload: validateTryPayload(tryPayload),
    });
    const updatedDevice = {
      ...device,
      lastSeenAt: Date.now(),
    };

    await setStoredDevice(updatedDevice);
    lastStatus = `Sent to ${device.deviceName}`;

    return {
      response,
      state: await getAndroidState(),
    };
  }

  async function handleAndroidQrScanned(message) {
    const device = await saveScannedAndroidDevice(message.payload);
    const tryPayload = pendingTryPayload;
    pendingTryPayload = null;

    if (!tryPayload) {
      return {
        sent: false,
        state: await getAndroidState(),
      };
    }

    const result = await sendToDevice(device, tryPayload);
    return {
      sent: true,
      ...result,
    };
  }

  async function sendTryToAndroid(message) {
    const device = await getStoredDevice();

    if (!device) {
      throw new Error("No Android device is paired");
    }

    return sendToDevice(device, message.tryPayload);
  }

  async function forgetAndroidDevice() {
    await clearStoredDevice();
    lastStatus = "Android device forgotten";
    return getAndroidState();
  }

  root.browser.runtime.onMessage.addListener(message => {
    if (!message || typeof message.type !== "string") {
      return undefined;
    }

    switch (message.type) {
      case MESSAGE_TYPES.GET_ANDROID_STATE:
        return getAndroidState();
      case MESSAGE_TYPES.OPEN_ANDROID_SCANNER:
        return openAndroidScanner(message);
      case MESSAGE_TYPES.ANDROID_QR_SCANNED:
        return handleAndroidQrScanned(message);
      case MESSAGE_TYPES.SEND_TRY_TO_ANDROID:
        return sendTryToAndroid(message);
      case MESSAGE_TYPES.FORGET_ANDROID_DEVICE:
        return forgetAndroidDevice();
      default:
        return undefined;
    }
  });
})(typeof globalThis !== "undefined" ? globalThis : this);
