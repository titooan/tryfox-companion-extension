"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const androidLanPayload = require("../src/pairing/androidLanPayload.js");

function clone(value) {
  if (value === undefined) {
    return undefined;
  }

  return JSON.parse(JSON.stringify(value));
}

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });

  return { promise, resolve, reject };
}

function createStorage(initial = {}) {
  const data = clone(initial);

  return {
    data,
    async get(keys) {
      if (Array.isArray(keys)) {
        return Object.fromEntries(keys.map(key => [key, clone(data[key])]));
      }

      if (typeof keys === "string") {
        return { [keys]: clone(data[keys]) };
      }

      return clone(data);
    },
    async set(values) {
      for (const [key, value] of Object.entries(values)) {
        data[key] = clone(value);
      }
    },
    async remove(keys) {
      for (const key of Array.isArray(keys) ? keys : [keys]) {
        delete data[key];
      }
    },
  };
}

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

function validTryPayload(overrides = {}) {
  return {
    sourceUrl: "https://treeherder.mozilla.org/jobs?repo=try&revision=abcdef",
    tryfoxDeepLink: "tryfox://jobs?repo=try&revision=abcdef",
    repo: "try",
    revision: "abcdef",
    author: null,
    ...overrides,
  };
}

function loadBackground({
  initialStorage = {},
  pingAndroidDevice = async () => ({ ok: true }),
  sendTryRevisionToAndroid = async () => ({ ok: true }),
} = {}) {
  const filePath = path.join(__dirname, "..", "src", "background", "background.js");
  const source = fs.readFileSync(filePath, "utf8");
  const storage = createStorage(initialStorage);
  let listener = null;
  const createdTabs = [];
  const context = {
    console,
    URL,
    globalThis: null,
    tryfoxAndroidLanPayload: androidLanPayload,
    tryfoxLanAuth: {
      randomBase64Url: () => "extension_install_id",
    },
    tryfoxLanClient: {
      pingAndroidDevice,
      sendTryRevisionToAndroid,
    },
    browser: {
      runtime: {
        getURL: pathname => `moz-extension://tryfox/${pathname}`,
        onMessage: {
          addListener(callback) {
            listener = callback;
          },
        },
      },
      storage: {
        local: storage,
      },
      tabs: {
        async create(tab) {
          createdTabs.push(tab);
          return tab;
        },
      },
    },
  };
  context.globalThis = context;

  vm.runInNewContext(source, context, { filename: filePath });

  return {
    context,
    createdTabs,
    storage,
    sendMessage(message) {
      assert.equal(typeof listener, "function");
      return listener(message);
    },
  };
}

test("background keeps devices in original pairing order after sends", async () => {
  const background = loadBackground();
  await background.sendMessage({
    type: "ANDROID_QR_SCANNED",
    payload: validPayload({
      deviceId: "device_aaaaaaaaaaaa",
      deviceName: "Pixel A",
      endpoint: "http://192.168.1.41:8765/tryfox/v1/messages",
    }),
  });
  await background.sendMessage({
    type: "ANDROID_QR_SCANNED",
    payload: validPayload({
      deviceId: "device_bbbbbbbbbbbb",
      deviceName: "Pixel B",
      endpoint: "http://192.168.1.42:8765/tryfox/v1/messages",
    }),
  });

  await background.sendMessage({
    type: "SEND_TRY_TO_ANDROID",
    deviceIds: ["device_aaaaaaaaaaaa"],
    tryPayload: validTryPayload(),
  });

  assert.deepEqual(
    background.storage.data.tryfoxAndroidDevices.map(device => device.deviceId),
    ["device_aaaaaaaaaaaa", "device_bbbbbbbbbbbb"]
  );
});

test("background ping refresh preserves selection changes made while ping is in flight", async () => {
  const ping = createDeferred();
  const background = loadBackground({
    initialStorage: {
      tryfoxAndroidDevices: [{
        deviceId: "device_aaaaaaaaaaaa",
        deviceName: "Pixel A",
        endpoint: "http://192.168.1.41:8765/tryfox/v1/messages",
        sharedSecret: "abcdefghijklmnopqrstuvwxyzABCDEFG",
        selected: true,
        pairedAt: 1,
      }],
    },
    pingAndroidDevice: () => ping.promise,
  });

  const statePromise = background.sendMessage({ type: "GET_ANDROID_STATE" });
  background.storage.data.tryfoxAndroidDevices[0].selected = false;
  ping.resolve({ ok: true });
  await statePromise;

  assert.equal(background.storage.data.tryfoxAndroidDevices[0].selected, false);
  assert.equal(background.storage.data.tryfoxAndroidDevices[0].lastPingStatus, "connected");
});

test("background reports per-device send failures and marks failed devices disconnected", async () => {
  const background = loadBackground({
    initialStorage: {
      tryfoxAndroidDevices: [
        {
          deviceId: "device_aaaaaaaaaaaa",
          deviceName: "Pixel A",
          endpoint: "http://192.168.1.41:8765/tryfox/v1/messages",
          sharedSecret: "abcdefghijklmnopqrstuvwxyzABCDEFG",
          selected: true,
          pairedAt: 1,
        },
        {
          deviceId: "device_bbbbbbbbbbbb",
          deviceName: "Pixel B",
          endpoint: "http://192.168.1.42:8765/tryfox/v1/messages",
          sharedSecret: "abcdefghijklmnopqrstuvwxyzABCDEFG",
          selected: true,
          pairedAt: 2,
        },
      ],
    },
    pingAndroidDevice: async ({ device }) => {
      if (device.deviceId === "device_bbbbbbbbbbbb") {
        throw new Error("offline");
      }
      return { ok: true };
    },
    sendTryRevisionToAndroid: async ({ device }) => {
      if (device.deviceId === "device_bbbbbbbbbbbb") {
        throw new Error("NetworkError");
      }
      return { ok: true };
    },
  });

  const result = await background.sendMessage({
    type: "SEND_TRY_TO_ANDROID",
    deviceIds: ["device_aaaaaaaaaaaa", "device_bbbbbbbbbbbb"],
    tryPayload: validTryPayload({ title: "Bug 123456" }),
  });

  assert.deepEqual(
    clone(result.results.map(sendResult => [sendResult.deviceId, sendResult.ok])),
    [
      ["device_aaaaaaaaaaaa", true],
      ["device_bbbbbbbbbbbb", false],
    ]
  );
  assert.deepEqual(
    clone(result.state.devices.map(device => [device.deviceId, device.status])),
    [
      ["device_aaaaaaaaaaaa", "connected"],
      ["device_bbbbbbbbbbbb", "disconnected"],
    ]
  );
});

test("background rejects QR scan connection when Android endpoint cannot be reached", async () => {
  const background = loadBackground({
    pingAndroidDevice: async () => {
      throw new Error("offline");
    },
  });

  await assert.rejects(
    () => background.sendMessage({
      type: "ANDROID_QR_SCANNED",
      payload: validPayload(),
    }),
    /offline/
  );

  assert.equal(background.storage.data.tryfoxAndroidDevices[0].lastPingStatus, "disconnected");
});
