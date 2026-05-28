"use strict";

const video = document.getElementById("camera_preview");
const canvas = document.getElementById("scan_canvas");
const statusText = document.getElementById("scanner_status");
const scannerResult = document.querySelector(".scanner_result");
const deviceDetails = document.getElementById("device_details");
const connectButton = document.getElementById("connect_button");
const rescanButton = document.getElementById("rescan_button");

let stream = null;
let animationFrameId = null;
let decodedPayload = null;
let invalidQrMessageTimeoutId = null;
let hasInvalidQrWarning = false;

const {
  getEndpointPermissionPattern,
  parseAndroidLanPayload,
} = globalThis.tryfoxAndroidLanPayload;

function setStatus(message) {
  statusText.textContent = message;
}

function setResultState(state) {
  for (const stateName of ["is-ready", "is-success", "is-error"]) {
    scannerResult.classList.remove(stateName);
    statusText.classList.remove(stateName);
  }

  if (state) {
    scannerResult.classList.add(state);
    statusText.classList.add(state);
  }
}

function clearInvalidQrWarningTimer() {
  if (invalidQrMessageTimeoutId) {
    clearTimeout(invalidQrMessageTimeoutId);
    invalidQrMessageTimeoutId = null;
  }
}

function showInvalidQrWarning(message) {
  clearInvalidQrWarningTimer();
  hasInvalidQrWarning = true;
  setResultState("is-error");
  setStatus(message);
}

function scheduleInvalidQrWarningClear() {
  if (!hasInvalidQrWarning || invalidQrMessageTimeoutId) {
    return;
  }

  invalidQrMessageTimeoutId = setTimeout(() => {
    hasInvalidQrWarning = false;
    invalidQrMessageTimeoutId = null;
    setResultState(null);
    setStatus("Point the camera at the Android QR code.");
  }, 3000);
}

function clearInvalidQrWarning() {
  clearInvalidQrWarningTimer();
  hasInvalidQrWarning = false;
}

function setConnectedStatus(message) {
  clearInvalidQrWarning();
  setResultState("is-success");
  setStatus(message);
  connectButton.textContent = "Connected";
  connectButton.classList.add("is-connected");
  connectButton.disabled = true;
}

function resetConnectedStatus() {
  setResultState(null);
  connectButton.textContent = "Connect";
  connectButton.classList.remove("is-connected");
}

function stopCamera() {
  if (animationFrameId) {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
  }

  if (stream) {
    for (const track of stream.getTracks()) {
      track.stop();
    }
    stream = null;
  }
}

async function startCamera() {
  decodedPayload = null;
  clearInvalidQrWarning();
  resetConnectedStatus();
  connectButton.disabled = true;
  rescanButton.hidden = true;
  deviceDetails.hidden = true;
  deviceDetails.textContent = "";
  setStatus("Starting camera...");

  stopCamera();

  stream = await navigator.mediaDevices.getUserMedia({
    video: {
      facingMode: "environment",
    },
    audio: false,
  });
  video.srcObject = stream;
  await video.play();
  setStatus("Point the camera at the Android QR code.");
  scanFrame();
}

function scanFrame() {
  if (!video.videoWidth || !video.videoHeight) {
    animationFrameId = requestAnimationFrame(scanFrame);
    return;
  }

  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.drawImage(video, 0, 0, canvas.width, canvas.height);

  const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
  const code = jsQR(imageData.data, imageData.width, imageData.height);

  if (code) {
    clearInvalidQrWarningTimer();
    handleDecodedQr(code.data);
    return;
  }

  scheduleInvalidQrWarningClear();
  animationFrameId = requestAnimationFrame(scanFrame);
}

function handleDecodedQr(rawText) {
  let payload;

  try {
    payload = parseAndroidLanPayload(rawText);
  } catch (error) {
    showInvalidQrWarning(error.message || "QR code is not a Tryfox Android receiver.");
    animationFrameId = requestAnimationFrame(scanFrame);
    return;
  }

  clearInvalidQrWarning();
  decodedPayload = payload;
  stopCamera();
  setResultState("is-ready");
  setStatus(`Ready to connect to ${payload.deviceName}.`);
  deviceDetails.textContent = payload.endpoint;
  deviceDetails.hidden = false;
  connectButton.disabled = false;
  rescanButton.hidden = false;
}

async function ensureEndpointPermission(endpoint) {
  const originPattern = getEndpointPermissionPattern(endpoint);
  return browser.permissions.request({
    origins: [originPattern],
  });
}

connectButton.addEventListener("click", async () => {
  if (!decodedPayload) {
    return;
  }

  try {
    const allowed = await ensureEndpointPermission(decodedPayload.endpoint);
    if (!allowed) {
      setStatus("Permission was not granted for the Android endpoint.");
      return;
    }

    connectButton.disabled = true;
    setStatus("Sending to Android...");
    const result = await browser.runtime.sendMessage({
      type: "ANDROID_QR_SCANNED",
      payload: decodedPayload,
    });

    if (result && result.sent) {
      setConnectedStatus("Connected. The Tryfox revision was sent to Android.");
    } else {
      setConnectedStatus("Connected. Android is ready to receive Tryfox revisions.");
    }
  } catch (error) {
    setStatus(error.message || "Failed to send to Android.");
    connectButton.disabled = false;
  }
});

rescanButton.addEventListener("click", () => {
  startCamera().catch(error => {
    setStatus(error.message || "Failed to start camera.");
  });
});

window.addEventListener("pagehide", stopCamera);

startCamera().catch(error => {
  setStatus(error.message || "Failed to start camera.");
});
