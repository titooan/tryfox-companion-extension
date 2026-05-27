"use strict";

const video = document.getElementById("camera_preview");
const canvas = document.getElementById("scan_canvas");
const statusText = document.getElementById("scanner_status");
const deviceDetails = document.getElementById("device_details");
const connectButton = document.getElementById("connect_button");
const rescanButton = document.getElementById("rescan_button");

let stream = null;
let animationFrameId = null;
let decodedPayload = null;

const {
  getEndpointPermissionPattern,
  parseAndroidLanPayload,
} = globalThis.tryfoxAndroidLanPayload;

function setStatus(message) {
  statusText.textContent = message;
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
    handleDecodedQr(code.data);
    return;
  }

  animationFrameId = requestAnimationFrame(scanFrame);
}

function handleDecodedQr(rawText) {
  let payload;

  try {
    payload = parseAndroidLanPayload(rawText);
  } catch (error) {
    setStatus(error.message || "QR code is not a Tryfox Android receiver.");
    animationFrameId = requestAnimationFrame(scanFrame);
    return;
  }

  decodedPayload = payload;
  stopCamera();
  setStatus(`Ready to connect to ${payload.deviceName}.`);
  deviceDetails.textContent = payload.endpoint;
  deviceDetails.hidden = false;
  connectButton.disabled = false;
  rescanButton.hidden = false;
}

async function ensureEndpointPermission(endpoint) {
  const originPattern = getEndpointPermissionPattern(endpoint);
  const permission = {
    origins: [originPattern],
  };

  const hasPermission = await browser.permissions.contains(permission);
  if (hasPermission) {
    return true;
  }

  return browser.permissions.request(permission);
}

connectButton.addEventListener("click", async () => {
  if (!decodedPayload) {
    return;
  }

  connectButton.disabled = true;
  setStatus("Requesting permission for the Android endpoint...");

  try {
    const allowed = await ensureEndpointPermission(decodedPayload.endpoint);
    if (!allowed) {
      setStatus("Permission was not granted for the Android endpoint.");
      connectButton.disabled = false;
      return;
    }

    setStatus("Sending to Android...");
    const result = await browser.runtime.sendMessage({
      type: "ANDROID_QR_SCANNED",
      payload: decodedPayload,
    });

    if (result && result.sent) {
      setStatus("Sent to Android.");
    } else {
      setStatus("Android device saved.");
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
