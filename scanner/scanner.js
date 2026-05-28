"use strict";

const video = document.getElementById("camera_preview");
const canvas = document.getElementById("scan_canvas");
const statusText = document.getElementById("scanner_status");
const scannerResult = document.querySelector(".scanner_result");
const deviceDetails = document.getElementById("device_details");
const connectionStatusButton = document.getElementById("connection_status_button");
const rescanButton = document.getElementById("rescan_button");
const closeTabButton = document.getElementById("close_tab_button");
const closeCountdown = document.getElementById("close_countdown");

const INVALID_QR_CONFIRMATION_FRAMES = 3;

let stream = null;
let animationFrameId = null;
let decodedPayload = null;
let invalidQrMessageTimeoutId = null;
let hasInvalidQrWarning = false;
let closeCountdownIntervalId = null;
let invalidQrCandidateText = null;
let invalidQrCandidateCount = 0;

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

function trackInvalidQrCandidate(rawText) {
  if (rawText === invalidQrCandidateText) {
    invalidQrCandidateCount += 1;
  } else {
    invalidQrCandidateText = rawText;
    invalidQrCandidateCount = 1;
  }

  return invalidQrCandidateCount >= INVALID_QR_CONFIRMATION_FRAMES;
}

function clearInvalidQrCandidate() {
  invalidQrCandidateText = null;
  invalidQrCandidateCount = 0;
}

function scheduleInvalidQrWarningClear() {
  clearInvalidQrCandidate();

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
  clearInvalidQrCandidate();
  hasInvalidQrWarning = false;
}

function updateCloseCountdown(secondsLeft) {
  closeCountdown.textContent = `Tab will be closed in ${secondsLeft} second${secondsLeft === 1 ? "" : "s"}.`;
}

async function closeCurrentTab() {
  try {
    const currentTab = await browser.tabs.getCurrent();
    if (currentTab && typeof currentTab.id === "number") {
      await browser.tabs.remove(currentTab.id);
      return;
    }
  } catch (error) {
    // Fall back to window.close below.
  }

  window.close();
}

function clearCloseCountdown() {
  if (closeCountdownIntervalId) {
    clearInterval(closeCountdownIntervalId);
    closeCountdownIntervalId = null;
  }

  closeCountdown.hidden = true;
  closeCountdown.textContent = "";
}

function startCloseCountdown() {
  let secondsLeft = 5;

  clearCloseCountdown();
  closeCountdown.hidden = false;
  updateCloseCountdown(secondsLeft);

  closeCountdownIntervalId = setInterval(() => {
    secondsLeft -= 1;
    updateCloseCountdown(secondsLeft);

    if (secondsLeft <= 0) {
      clearCloseCountdown();
      closeCurrentTab();
    }
  }, 1000);
}

function setConnectedStatus(message) {
  clearInvalidQrWarning();
  setResultState("is-success");
  setStatus(message);
  connectionStatusButton.textContent = "Connected";
  connectionStatusButton.classList.remove("is-connecting");
  connectionStatusButton.classList.add("is-connected");
  connectionStatusButton.hidden = false;
  rescanButton.hidden = true;
  closeTabButton.hidden = false;
  startCloseCountdown();
}

function setConnectingStatus() {
  setResultState("is-ready");
  setStatus("Connecting to Android...");
  connectionStatusButton.textContent = "Connecting";
  connectionStatusButton.classList.add("is-connecting");
  connectionStatusButton.classList.remove("is-connected");
  connectionStatusButton.hidden = false;
  rescanButton.hidden = true;
}

function resetConnectedStatus() {
  clearCloseCountdown();
  setResultState(null);
  connectionStatusButton.textContent = "Connecting";
  connectionStatusButton.classList.remove("is-connected", "is-connecting");
  connectionStatusButton.hidden = true;
  closeTabButton.hidden = true;
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
    if (trackInvalidQrCandidate(rawText)) {
      showInvalidQrWarning(error.message || "QR code is not a Tryfox Android receiver.");
    }
    animationFrameId = requestAnimationFrame(scanFrame);
    return;
  }

  clearInvalidQrWarning();
  decodedPayload = payload;
  stopCamera();
  deviceDetails.textContent = payload.endpoint;
  deviceDetails.hidden = false;
  connectToAndroid();
}

async function ensureEndpointPermission(endpoint) {
  const originPattern = getEndpointPermissionPattern(endpoint);
  return browser.permissions.contains({
    origins: [originPattern],
  });
}

async function connectToAndroid() {
  if (!decodedPayload) {
    return;
  }

  setConnectingStatus();

  try {
    const allowed = await ensureEndpointPermission(decodedPayload.endpoint);
    if (!allowed) {
      setStatus("Permission was not granted for the Android endpoint.");
      return;
    }

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
    setResultState("is-error");
    setStatus("Couldn't connect to the Android device.");
    connectionStatusButton.hidden = true;
    rescanButton.hidden = false;
  }
}

rescanButton.addEventListener("click", () => {
  startCamera().catch(error => {
    setStatus(error.message || "Failed to start camera.");
  });
});

closeTabButton.addEventListener("click", () => {
  closeCurrentTab();
});

window.addEventListener("pagehide", () => {
  clearCloseCountdown();
  stopCamera();
});

startCamera().catch(error => {
  setStatus(error.message || "Failed to start camera.");
});
