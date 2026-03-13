"use strict";

const [ QR_VERSION_MIN, QR_VERSION_MAX ] = [ 1, 40 ];
const DEFAULT_ERROR_CORRECTION_LEVEL = 'L'; // 'L', 'M', 'Q', 'H'
const [ DEFAULT_CELL_SIZE, DEFAULT_MARGIN_SIZE] = [ 4, 8 ];

function generateQR(text, cellSize=1, margin=0) {
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
  throw "QR code not available";
}

function renderQRCode(text, cellSize) {
  let tag = generateQR(text, cellSize, DEFAULT_MARGIN_SIZE);
  let doc = new DOMParser().parseFromString(tag, 'text/html');
  let img_el = doc.getElementsByTagName('img')[0];
  let qrcodeImg = document.getElementById('qrcode_img');
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

function showCopiedTooltip(button) {
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

browser.tabs.query({active: true, currentWindow: true}).then(tabs => {
  const originUrl = tabs[0].url;
  const deepLink = tryfoxTreeherderUrl.toTryfoxDeepLink(tabs[0].url);

  if (!deepLink) {
    return;
  }

  browser.storage.local.get('cellSize').then(result => {
    const cellSize = parseInt(result.cellSize) || DEFAULT_CELL_SIZE;
    const modeHttpsButton = document.getElementById('mode_https');
    const modeDeeplinkButton = document.getElementById('mode_deeplink');
    const activeLinkHeader = document.getElementById('active_link_header');
    const activeLinkText = document.getElementById('active_link_text');
    const copyActiveLinkButton = document.getElementById('copy_active_link');
    const copyQRCodeButton = document.getElementById('copy_qrcode');
    const saveQRCodeButton = document.getElementById('save_qrcode');
    const qrCodeFilename = getQRCodeFilename(originUrl);

    function getModeData(mode) {
      if (mode === 'https') {
        return {
          header: 'Origin Link',
          text: originUrl,
        };
      }

      return {
        header: 'TryFox Deeplink',
        text: deepLink,
      };
    }

    function setActiveMode(mode) {
      const useHttps = mode === 'https';
      const modeData = getModeData(mode);
      modeHttpsButton.classList.toggle('is-active', useHttps);
      modeDeeplinkButton.classList.toggle('is-active', !useHttps);
      activeLinkHeader.textContent = modeData.header;
      activeLinkText.textContent = modeData.text;
      copyActiveLinkButton.setAttribute('aria-label', `Copy ${modeData.header.toLowerCase()}`);
      copyActiveLinkButton.setAttribute('title', `Copy ${modeData.header.toLowerCase()}`);
      copyActiveLinkButton.dataset.copyValue = modeData.text;
      renderQRCode(modeData.text, cellSize);
    }

    copyActiveLinkButton.addEventListener('click', event => {
      copyText(event.currentTarget.dataset.copyValue)
        .catch(() => {})
        .finally(() => showCopiedTooltip());
    });
    copyQRCodeButton.addEventListener('click', event => {
      event.preventDefault();
      copyQRCodeImage()
        .catch(() => {})
        .finally(() => showCopiedTooltip());
    });
    saveQRCodeButton.addEventListener('click', event => {
      event.preventDefault();
      saveQRCodeImage(qrCodeFilename)
        .then(() => showCopiedTooltip())
        .catch(() => {});
    });
    modeHttpsButton.addEventListener('click', () => setActiveMode('https'));
    modeDeeplinkButton.addEventListener('click', () => setActiveMode('deeplink'));
    setActiveMode('deeplink');
    document.getElementById('qrcode_container').hidden = false;
  });

});
