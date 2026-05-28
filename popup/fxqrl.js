"use strict";

const [ QR_VERSION_MIN, QR_VERSION_MAX ] = [ 1, 40 ];
const DEFAULT_ERROR_CORRECTION_LEVEL = "L"; // "L", "M", "Q", "H"
const [ DEFAULT_CELL_SIZE, DEFAULT_MARGIN_SIZE ] = [ 4, 8 ];

function generateQR(text, cellSize = 1, margin = 0) {
  for (let i = QR_VERSION_MIN; i <= QR_VERSION_MAX; ++i) {
    let qr = qrcode(i, DEFAULT_ERROR_CORRECTION_LEVEL);
    qr.addData(text);
    try {
      qr.make();
    } catch (e) {
      continue;
    }
    return qr.createImgTag(cellSize, margin);
  }
  throw new Error("QR code not available");
}

function renderQRCode(text, cellSize) {
  let tag = generateQR(text, cellSize, DEFAULT_MARGIN_SIZE);
  let doc = new DOMParser().parseFromString(tag, "text/html");
  let img_el = doc.getElementsByTagName("img")[0];
  let qrcodeImg = document.getElementById("qrcode_img");
  qrcodeImg.src = img_el.src;
}

function getQRCodeFilename(rawUrl) {
  let url;

  try {
    url = new URL(rawUrl);
  } catch (error) {
    return "tryfox-qrcode.png";
  }

  const params = url.hash && url.hash.startsWith("#/")
    ? new URL(url.hash.slice(1), `${url.origin}/`).searchParams
    : url.searchParams;
  const repo = params.get("repo") || "treeherder";
  const revision = params.get("revision");

  if (revision) {
    return `${repo}-${revision.slice(0, 8)}.png`;
  }

  const author = params.get("author");
  if (author) {
    const safeAuthor = author.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase();
    return `${repo}-${safeAuthor || "author"}.png`;
  }

  return `${repo}-qrcode.png`;
}

async function copyQRCodeImage() {
  if (!navigator.clipboard || !window.ClipboardItem || !navigator.clipboard.write) {
    throw new Error("Image clipboard API unavailable");
  }

  const blob = await createQRCodeBlob();

  await navigator.clipboard.write([
    new ClipboardItem({
      "image/png": blob,
    }),
  ]);
}

function createQRCodeBlob() {
  const image = document.getElementById("qrcode_img");
  if (!image || !image.src) {
    return Promise.reject(new Error("QR code image not available"));
  }

  return new Promise((resolve, reject) => {
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth || image.width;
    canvas.height = image.naturalHeight || image.height;

    if (!canvas.width || !canvas.height) {
      reject(new Error("QR code image has invalid dimensions"));
      return;
    }

    const context = canvas.getContext("2d");
    if (!context) {
      reject(new Error("Canvas context unavailable"));
      return;
    }

    context.drawImage(image, 0, 0);
    canvas.toBlob(result => {
      if (!result) {
        reject(new Error("Failed to encode QR code image"));
        return;
      }

      resolve(result);
    }, "image/png");
  });
}

async function saveQRCodeImage(filename) {
  const blob = await createQRCodeBlob();
  const objectUrl = URL.createObjectURL(blob);

  try {
    await browser.downloads.download({
      url: objectUrl,
      conflictAction: "uniquify",
      filename,
      saveAs: true,
    });
  } finally {
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  }
}

function copyText(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    return navigator.clipboard.writeText(text).catch(() => {
      return fallbackCopyText(text);
    });
  }

  return fallbackCopyText(text);
}

function fallbackCopyText(text) {
  const textArea = document.createElement("textarea");
  textArea.value = text;
  textArea.setAttribute("readonly", "");
  textArea.style.position = "absolute";
  textArea.style.left = "-9999px";
  document.body.appendChild(textArea);
  textArea.select();
  document.execCommand("copy");
  document.body.removeChild(textArea);
  return Promise.resolve();
}

function showCopiedTooltip() {
  const feedback = document.getElementById("copy_feedback");
  if (!feedback) {
    return;
  }

  if (showCopiedTooltip.timeoutId) {
    clearTimeout(showCopiedTooltip.timeoutId);
  }

  feedback.hidden = false;
  feedback.classList.add("is-visible");
  showCopiedTooltip.timeoutId = setTimeout(() => {
    feedback.classList.remove("is-visible");
    feedback.hidden = true;
    showCopiedTooltip.timeoutId = null;
  }, 1200);
}

function sendBackgroundMessage(type, detail = {}) {
  return browser.runtime.sendMessage({ type, ...detail });
}

async function ensureEndpointPermission(endpointPermissionPattern) {
  if (!endpointPermissionPattern) {
    return false;
  }

  return browser.permissions.request({
    origins: [endpointPermissionPattern],
  });
}

browser.tabs.query({ active: true, currentWindow: true }).then(tabs => {
  const originUrl = tabs[0] && tabs[0].url ? tabs[0].url : "";
  const tryPayload = tryfoxTreeherderUrl.parseTryfoxJobUrl(originUrl);
  const deepLink = tryPayload ? tryPayload.tryfoxDeepLink : null;

  browser.storage.local.get("cellSize").then(async result => {
    const cellSize = parseInt(result.cellSize) || DEFAULT_CELL_SIZE;
    const container = document.getElementById("qrcode_container");
    const modeHttpsButton = document.getElementById("mode_https");
    const modeDeeplinkButton = document.getElementById("mode_deeplink");
    const modeAndroidButton = document.getElementById("mode_android");
    const urlPanel = document.getElementById("url_panel");
    const androidPanel = document.getElementById("android_panel");
    const urlQrContent = document.getElementById("url_qr_content");
    const unsupportedMessage = document.getElementById("unsupported_message");
    const activeLinkHeader = document.getElementById("active_link_header");
    const activeLinkText = document.getElementById("active_link_text");
    const copyActiveLinkButton = document.getElementById("copy_active_link");
    const copyQRCodeButton = document.getElementById("copy_qrcode");
    const saveQRCodeButton = document.getElementById("save_qrcode");
    const androidStatus = document.getElementById("android_status");
    const androidDeviceDetails = document.getElementById("android_device_details");
    const androidUnsupportedMessage = document.getElementById("android_unsupported_message");
    const sendToAndroidButton = document.getElementById("send_to_android");
    const scanAndroidQrButton = document.getElementById("scan_android_qr");
    const forgetAndroidButton = document.getElementById("forget_android");
    const qrCodeFilename = getQRCodeFilename(originUrl);
    let androidState = null;

    modeDeeplinkButton.disabled = !deepLink;
    modeHttpsButton.disabled = !deepLink;

    function getModeData(mode) {
      if (mode === "https") {
        return {
          header: "Origin Link",
          text: originUrl,
        };
      }

      return {
        header: "TryFox Deeplink",
        text: deepLink,
      };
    }

    function setModeButtons(mode) {
      modeHttpsButton.classList.toggle("is-active", mode === "https");
      modeDeeplinkButton.classList.toggle("is-active", mode === "deeplink");
      modeAndroidButton.classList.toggle("is-active", mode === "android");
    }

    function renderAndroidState(state) {
      androidState = state;
      const device = state && state.device;
      const hasTryPayload = Boolean(tryPayload);

      if (device) {
        androidStatus.textContent = state.status || `Paired with ${device.deviceName}`;
        androidDeviceDetails.textContent = `${device.deviceName} (${device.endpoint})`;
        androidDeviceDetails.hidden = false;
      } else {
        androidStatus.textContent = "No Android device paired.";
        androidDeviceDetails.hidden = true;
      }

      androidUnsupportedMessage.hidden = hasTryPayload;
      sendToAndroidButton.disabled = !device || !hasTryPayload;
      sendToAndroidButton.textContent = device ? `Send to ${device.deviceName}` : "Send to Android";
      forgetAndroidButton.disabled = !device;
      return state;
    }

    function refreshAndroidState() {
      return sendBackgroundMessage("GET_ANDROID_STATE")
        .then(renderAndroidState)
        .catch(() => {
          androidStatus.textContent = "Android state unavailable.";
        });
    }

    function setActiveMode(mode) {
      if ((mode === "deeplink" || mode === "https") && !deepLink) {
        mode = "android";
      }

      setModeButtons(mode);
      urlPanel.hidden = mode === "android";
      androidPanel.hidden = mode !== "android";

      if (mode === "android") {
        refreshAndroidState();
        return;
      }

      const modeData = getModeData(mode);
      unsupportedMessage.hidden = true;
      urlQrContent.hidden = false;
      activeLinkHeader.textContent = modeData.header;
      activeLinkText.textContent = modeData.text;
      copyActiveLinkButton.setAttribute("aria-label", `Copy ${modeData.header.toLowerCase()}`);
      copyActiveLinkButton.setAttribute("title", `Copy ${modeData.header.toLowerCase()}`);
      copyActiveLinkButton.dataset.copyValue = modeData.text;
      renderQRCode(modeData.text, cellSize);
    }

    copyActiveLinkButton.addEventListener("click", event => {
      copyText(event.currentTarget.dataset.copyValue)
        .catch(() => {})
        .finally(() => showCopiedTooltip());
    });
    copyQRCodeButton.addEventListener("click", event => {
      event.preventDefault();
      copyQRCodeImage()
        .catch(() => {})
        .finally(() => showCopiedTooltip());
    });
    saveQRCodeButton.addEventListener("click", event => {
      event.preventDefault();
      saveQRCodeImage(qrCodeFilename)
        .then(() => showCopiedTooltip())
        .catch(() => {});
    });
    modeHttpsButton.addEventListener("click", () => setActiveMode("https"));
    modeDeeplinkButton.addEventListener("click", () => setActiveMode("deeplink"));
    modeAndroidButton.addEventListener("click", () => setActiveMode("android"));
    scanAndroidQrButton.addEventListener("click", () => {
      sendBackgroundMessage("OPEN_ANDROID_SCANNER", { tryPayload })
        .catch(() => {
          androidStatus.textContent = "Failed to open Android QR scanner.";
        });
    });
    sendToAndroidButton.addEventListener("click", async () => {
      if (!tryPayload || !androidState || !androidState.device) {
        return;
      }

      try {
        const allowed = await ensureEndpointPermission(androidState.device.endpointPermissionPattern);
        if (!allowed) {
          androidStatus.textContent = "Permission was not granted for the Android endpoint.";
          return;
        }

        sendToAndroidButton.disabled = true;
        androidStatus.textContent = "Sending to Android...";
        const result = await sendBackgroundMessage("SEND_TRY_TO_ANDROID", { tryPayload });
        renderAndroidState(result.state);
      } catch (error) {
        androidStatus.textContent = error.message || "Failed to send to Android. Scan Android QR again if its IP changed.";
      } finally {
        sendToAndroidButton.disabled = !androidState || !androidState.device || !tryPayload;
      }
    });
    forgetAndroidButton.addEventListener("click", () => {
      sendBackgroundMessage("FORGET_ANDROID_DEVICE")
        .then(renderAndroidState)
        .catch(() => {
          androidStatus.textContent = "Failed to forget Android device.";
        });
    });

    try {
      const initialAndroidState = await refreshAndroidState();
      if (initialAndroidState && initialAndroidState.device) {
        setActiveMode("android");
      } else if (deepLink) {
        setActiveMode("deeplink");
      } else {
        unsupportedMessage.hidden = false;
        urlQrContent.hidden = true;
        setActiveMode("android");
      }
    } catch (error) {
      if (deepLink) {
        setActiveMode("deeplink");
      } else {
        unsupportedMessage.hidden = false;
        urlQrContent.hidden = true;
        setActiveMode("android");
      }
    }

    container.hidden = false;
  });
});
