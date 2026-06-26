"use strict";

(function(root) {
  const {
    getEndpointPermissionPattern,
    parseAndroidLanPayload,
  } = root.tryfoxAndroidLanPayload;
  const { randomBase64Url } = root.tryfoxLanAuth;
  const {
    pingAndroidDevice,
    sendTryRevisionToAndroid,
  } = root.tryfoxLanClient;
  const tryfoxTreeherderUrl = root.tryfoxTreeherderUrl;

  const STORAGE_KEYS = {
    DEVICE: "tryfoxAndroidDevice",
    DEVICES: "tryfoxAndroidDevices",
    EXTENSION_ID: "tryfoxExtensionId",
  };

  const MESSAGE_TYPES = {
    GET_ANDROID_STATE: "GET_ANDROID_STATE",
    OPEN_ANDROID_SCANNER: "OPEN_ANDROID_SCANNER",
    ANDROID_QR_SCANNED: "ANDROID_QR_SCANNED",
    SEND_TRY_TO_ANDROID: "SEND_TRY_TO_ANDROID",
    SET_ANDROID_DEVICE_SELECTED: "SET_ANDROID_DEVICE_SELECTED",
    FORGET_ANDROID_DEVICE: "FORGET_ANDROID_DEVICE",
  };
  const POPUP_PATH = "popup/fxqrl.html";
  const EMPTY_POPUP = "";

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

  async function getStoredDevices() {
    const browserApi = getBrowser();
    const stored = await browserApi.storage.local.get([
      STORAGE_KEYS.DEVICE,
      STORAGE_KEYS.DEVICES,
    ]);
    let devices = Array.isArray(stored[STORAGE_KEYS.DEVICES])
      ? stored[STORAGE_KEYS.DEVICES]
      : [];

    if (!devices.length && stored[STORAGE_KEYS.DEVICE]) {
      devices = [{
        ...stored[STORAGE_KEYS.DEVICE],
        selected: true,
      }];
      await browserApi.storage.local.set({
        [STORAGE_KEYS.DEVICES]: devices,
      });
      await browserApi.storage.local.remove(STORAGE_KEYS.DEVICE);
    }

    return devices;
  }

  function publicDevice(device, status = device.lastPingStatus || "unknown") {
    if (!device) {
      return null;
    }

    return {
      deviceId: device.deviceId,
      deviceName: device.deviceName,
      endpoint: device.endpoint,
      endpointPermissionPattern: getEndpointPermissionPattern(device.endpoint),
      selected: device.selected !== false,
      status,
      lastPingedAt: device.lastPingedAt || null,
      pairedAt: device.pairedAt,
      lastSeenAt: device.lastSeenAt || null,
    };
  }

  async function setStoredDevices(devices) {
    await getBrowser().storage.local.set({
      [STORAGE_KEYS.DEVICES]: devices,
    });
  }

  async function upsertStoredDevice(device) {
    const devices = await getStoredDevices();
    const existingDeviceIndex = devices.findIndex(item => item.deviceId === device.deviceId);
    const existingDevice = existingDeviceIndex >= 0 ? devices[existingDeviceIndex] : null;
    let nextDevices;

    if (existingDevice) {
      const nextDevice = {
        ...existingDevice,
        ...device,
        selected: existingDevice.selected !== false,
      };
      nextDevices = devices.map((storedDevice, index) => (
        index === existingDeviceIndex ? nextDevice : storedDevice
      ));
    } else {
      nextDevices = [
        ...devices,
        {
          ...device,
          selected: true,
        },
      ];
    }

    await setStoredDevices(nextDevices);
    return nextDevices[existingDeviceIndex >= 0 ? existingDeviceIndex : nextDevices.length - 1];
  }

  async function forgetStoredDevice(deviceId) {
    const devices = await getStoredDevices();
    await setStoredDevices(devices.filter(device => device.deviceId !== deviceId));
  }

  async function setStoredDeviceSelected(deviceId, selected) {
    const devices = await getStoredDevices();
    const nextDevices = devices.map(device => {
      if (device.deviceId !== deviceId) {
        return device;
      }

      return {
        ...device,
        selected: Boolean(selected),
      };
    });

    await setStoredDevices(nextDevices);
  }

  async function setStoredDevicePingStatus(deviceId, status) {
    const devices = await getStoredDevices();
    const now = Date.now();
    const nextDevices = devices.map(device => {
      if (device.deviceId !== deviceId) {
        return device;
      }

      return {
        ...device,
        lastPingStatus: status,
        lastPingedAt: now,
      };
    });

    await setStoredDevices(nextDevices);
  }

  async function getAndroidState() {
    const devices = await getStoredDevices();
    const now = Date.now();
    const statusByDeviceId = new Map(await Promise.all(devices.map(async device => {
      try {
        await pingAndroidDevice({ device });
        return [device.deviceId, "connected"];
      } catch (error) {
        return [device.deviceId, "disconnected"];
      }
    })));
    const latestDevices = await getStoredDevices();
    const devicesWithStatus = latestDevices.map(device => {
      const status = statusByDeviceId.get(device.deviceId);
      if (!status) {
        return device;
      }

      return {
        ...device,
        lastPingStatus: status,
        lastPingedAt: now,
      };
    });
    await setStoredDevices(devicesWithStatus);
    const publicDevices = devicesWithStatus.map(device => publicDevice(device));

    return {
      status: lastStatus,
      devices: publicDevices,
      device: publicDevices[0] || null,
      hasDevice: publicDevices.length > 0,
      hasPendingTryPayload: Boolean(pendingTryPayload),
    };
  }

  async function detectPhabricatorTryLink(tabId) {
    const [result] = await getBrowser().tabs.executeScript(tabId, {
      code: `(() => {
        const TRY_LINK_PATTERN = /^https:\\/\\/treeherder\\.mozilla\\.org\\/(#\\/)?jobs\\?/i;

        function getRouteAndParams(url) {
          if (url.hash && url.hash.startsWith("#/")) {
            const hashUrl = new URL(url.hash.slice(1), \`\${url.origin}/\`);
            return {
              route: hashUrl.pathname,
              params: hashUrl.searchParams,
            };
          }

          return {
            route: url.pathname,
            params: url.searchParams,
          };
        }

        function parseTryLinkParams(url) {
          if (!url) {
            return { repo: null, revision: null };
          }

          const { params } = getRouteAndParams(url);
          return {
            repo: params.get("repo") || null,
            revision: params.get("revision") || null,
          };
        }

        function isReviewbotComment(eventNode) {
          if (!eventNode || typeof eventNode.querySelector !== "function") {
            return false;
          }

          const authorAnchor = eventNode.querySelector(
            ".phui-timeline-title .phui-link-person, .phui-timeline-title .phui-link-profile, .phui-timeline-title .phui-handle"
          );

          if (!authorAnchor) {
            return false;
          }

          const authorName = (authorAnchor.textContent || "").trim().toLowerCase();
          if (authorName === "reviewbot") {
            return true;
          }

          const href = typeof authorAnchor.getAttribute === "function"
            ? authorAnchor.getAttribute("href") || ""
            : authorAnchor.href || "";
          return /\\/p\\/reviewbot\\/?(?:$|[?#])/i.test(href);
        }

        function getLastTryLink(anchors) {
          const tryLinks = anchors.filter(anchor => anchor && typeof anchor.href === "string" && TRY_LINK_PATTERN.test(anchor.href));
          return tryLinks.length ? tryLinks[tryLinks.length - 1] : null;
        }

        function extractSummaryTryLinkData(doc) {
          const sections = Array.from(doc.querySelectorAll(".phui-property-list-section"));
          for (const section of sections) {
            const header = section.querySelector(".phui-property-list-section-header");
            if (!header || !/\\bsummary\\b/i.test(header.textContent || "")) {
              continue;
            }

            const tryLink = getLastTryLink(Array.from(section.querySelectorAll("a[href]")));
            if (!tryLink) {
              continue;
            }

            return { url: tryLink.href };
          }

          return null;
        }

        const timelineEvents = Array.from(document.querySelectorAll(".phui-timeline-shell"));
        let latest = null;

        timelineEvents.forEach(eventNode => {
          if (isReviewbotComment(eventNode)) {
            return;
          }

          const tryLink = getLastTryLink(Array.from(eventNode.querySelectorAll("a[href]")));
          if (!tryLink) {
            return;
          }

          let parsedUrl = null;
          try {
            parsedUrl = new URL(tryLink.href);
          } catch (error) {}

          const { repo, revision } = parseTryLinkParams(parsedUrl);
          if (!repo || !revision) {
            return;
          }

          latest = { url: tryLink.href };
        });

        return latest || extractSummaryTryLinkData(document);
      })();`,
    });

    return result && typeof result.url === "string" ? result.url : null;
  }

  async function isSupportedPopupTab(tab) {
    const url = tab && typeof tab.url === "string" ? tab.url : "";

    if (tryfoxTreeherderUrl.parseTryfoxJobUrl(url)) {
      return true;
    }

    if (!tryfoxTreeherderUrl.isPhabricatorRevisionUrl(url) || !tab || typeof tab.id !== "number") {
      return false;
    }

    try {
      const tryLinkUrl = await detectPhabricatorTryLink(tab.id);
      return Boolean(tryLinkUrl && tryfoxTreeherderUrl.parseTryfoxJobUrl(tryLinkUrl));
    } catch (error) {
      return false;
    }
  }

  async function openPopupForTab(tab) {
    const browserApi = getBrowser();
    const tabId = tab && typeof tab.id === "number" ? tab.id : null;
    if (tabId == null || !browserApi.browserAction) {
      return;
    }

    await browserApi.browserAction.setPopup({
      tabId,
      popup: POPUP_PATH,
    });

    try {
      await browserApi.browserAction.openPopup();
    } finally {
      setTimeout(() => {
        browserApi.browserAction.setPopup({
          tabId,
          popup: EMPTY_POPUP,
        }).catch(() => {});
      }, 1000);
    }
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

    const storedDevice = await upsertStoredDevice(device);
    lastStatus = `Paired with ${device.deviceName}`;
    return storedDevice;
  }

  async function sendToDevice(device, tryPayload) {
    const now = Date.now();
    const extensionId = await getExtensionId();
    const response = await sendTryRevisionToAndroid({
      device,
      extensionId,
      tryPayload: validateTryPayload(tryPayload),
    });
    const updatedDevice = {
      ...device,
      lastSeenAt: now,
      lastPingStatus: "connected",
      lastPingedAt: now,
    };

    await upsertStoredDevice(updatedDevice);
    lastStatus = `Sent to ${device.deviceName}`;

    return {
      response,
    };
  }

  async function handleAndroidQrScanned(message) {
    const device = await saveScannedAndroidDevice(message.payload);
    const tryPayload = pendingTryPayload;
    pendingTryPayload = null;

    if (!tryPayload) {
      try {
        await pingAndroidDevice({ device });
        await setStoredDevicePingStatus(device.deviceId, "connected");
      } catch (error) {
        await setStoredDevicePingStatus(device.deviceId, "disconnected");
        throw error;
      }

      return {
        sent: false,
        state: await getAndroidState(),
      };
    }

    const result = await sendToDevice(device, tryPayload);
    return {
      sent: true,
      ...result,
      state: await getAndroidState(),
    };
  }

  async function sendTryToAndroid(message) {
    const devices = await getStoredDevices();
    const selectedDeviceIds = Array.isArray(message.deviceIds) ? message.deviceIds : [];
    const selectedDevices = devices.filter(device => selectedDeviceIds.includes(device.deviceId));

    if (!selectedDevices.length) {
      throw new Error("No Android device is selected");
    }

    const settledResults = await Promise.allSettled(selectedDevices.map(device => sendToDevice(device, message.tryPayload)));
    const results = [];

    for (let index = 0; index < settledResults.length; index += 1) {
      const settledResult = settledResults[index];
      const device = selectedDevices[index];

      if (settledResult.status === "fulfilled") {
        results.push({
          deviceId: device.deviceId,
          ok: true,
          response: settledResult.value.response,
        });
      } else {
        await setStoredDevicePingStatus(device.deviceId, "disconnected");
        results.push({
          deviceId: device.deviceId,
          ok: false,
          error: settledResult.reason && settledResult.reason.message
            ? settledResult.reason.message
            : "Failed to send to Android device",
        });
      }
    }

    lastStatus = `Sent to ${selectedDevices.length} Android device${selectedDevices.length === 1 ? "" : "s"}`;

    return {
      results,
      state: await getAndroidState(),
    };
  }

  async function setAndroidDeviceSelected(message) {
    await setStoredDeviceSelected(message.deviceId, message.selected);
    return getAndroidState();
  }

  async function forgetAndroidDevice(message) {
    await forgetStoredDevice(message.deviceId);
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
      case MESSAGE_TYPES.SET_ANDROID_DEVICE_SELECTED:
        return setAndroidDeviceSelected(message);
      case MESSAGE_TYPES.FORGET_ANDROID_DEVICE:
        return forgetAndroidDevice(message);
      default:
        return undefined;
    }
  });

  if (root.browser.browserAction && root.browser.browserAction.onClicked) {
    root.browser.browserAction.onClicked.addListener(async tab => {
      if (!await isSupportedPopupTab(tab)) {
        return;
      }

      await openPopupForTab(tab);
    });
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
