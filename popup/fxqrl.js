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

async function resolveTryPayloadForTab(tab) {
  async function resolveLandoTryPayload(tryPayload) {
    if (!tryPayload || tryPayload.tryfoxDeepLink || !tryPayload.landoCommitId) {
      return tryPayload;
    }

    try {
      const resolved = await browser.runtime.sendMessage({
        type: "RESOLVE_TRY_PAYLOAD",
        tryPayload,
      });
      return resolved || tryPayload;
    } catch (error) {
      return tryPayload;
    }
  }

  const tabUrl = tab && tab.url ? tab.url : "";
  const directTryPayload = tryfoxTreeherderUrl.parseTryfoxJobUrl(tabUrl);

  if (directTryPayload) {
    const resolvedTryPayload = await resolveLandoTryPayload(directTryPayload);
    return {
      pageType: "treeherder",
      resolvedUrl: tabUrl,
      tryPayload: resolvedTryPayload,
    };
  }

  if (!tryfoxTreeherderUrl.isPhabricatorRevisionUrl(tabUrl) || !tab || typeof tab.id !== "number") {
    return {
      pageType: "unsupported",
      resolvedUrl: tabUrl,
      tryPayload: null,
    };
  }

  try {
    const [tryLinkData] = await browser.tabs.executeScript(tab.id, {
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
            return { repo: null, revision: null, landoCommitId: null, landoInstance: null };
          }

          const { params } = getRouteAndParams(url);
          return {
            repo: params.get("repo") || null,
            revision: params.get("revision") || null,
            landoCommitId: params.get("landoCommitID") || params.get("lando_commit_id") || null,
            landoInstance: params.get("landoInstance") || params.get("lando_instance") || null,
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

        function getAnchorId(anchor) {
          if (!anchor) {
            return null;
          }

          if (anchor.id) {
            return anchor.id;
          }

          if (typeof anchor.getAttribute === "function") {
            return anchor.getAttribute("name");
          }

          return null;
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

            let parsedUrl = null;
            try {
              parsedUrl = new URL(tryLink.href);
            } catch (error) {}

            const { repo, revision, landoCommitId, landoInstance } = parseTryLinkParams(parsedUrl);
            return {
              url: tryLink.href,
              commentUrl: null,
              commentId: null,
              repo,
              revision,
              landoCommitId,
              landoInstance,
            };
          }

          return null;
        }

        const timelineEvents = Array.from(document.querySelectorAll(".phui-timeline-shell"));
        const baseUrl = \`\${window.location.origin}\${window.location.pathname}\${window.location.search}\`;
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

          const { repo, revision, landoCommitId, landoInstance } = parseTryLinkParams(parsedUrl);
          const anchor = eventNode.querySelector(".phabricator-anchor-view[id], .phabricator-anchor-view[name]");
          const anchorId = getAnchorId(anchor);

          latest = {
            url: tryLink.href,
            commentUrl: anchorId ? \`\${baseUrl}#\${anchorId}\` : null,
            commentId: anchorId || null,
            repo,
            revision,
            landoCommitId,
            landoInstance,
          };
        });

        return latest || extractSummaryTryLinkData(document);
      })();`,
    });
    const resolvedUrl = tryLinkData && typeof tryLinkData.url === "string" ? tryLinkData.url : "";
    const tryPayload = resolvedUrl ? tryfoxTreeherderUrl.parseTryfoxJobUrl(resolvedUrl) : null;
    const resolvedTryPayload = await resolveLandoTryPayload(tryPayload);

    return {
      pageType: resolvedTryPayload ? "phabricator" : "unsupported",
      resolvedUrl: resolvedUrl || tabUrl,
      tryPayload: resolvedTryPayload,
    };
  } catch (error) {
    return {
      pageType: "unsupported",
      resolvedUrl: tabUrl,
      tryPayload: null,
    };
  }
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

function getEndpointPermissionPattern(endpoint) {
  const endpointUrl = new URL(endpoint);
  return `${endpointUrl.protocol}//${endpointUrl.hostname}/*`;
}

function publicCachedAndroidDevice(device) {
  return {
    deviceId: device.deviceId,
    deviceName: device.deviceName,
    endpoint: device.endpoint,
    endpointPermissionPattern: getEndpointPermissionPattern(device.endpoint),
    selected: device.selected !== false,
    status: device.lastPingStatus || "unknown",
    lastPingedAt: device.lastPingedAt || null,
    pairedAt: device.pairedAt,
    lastSeenAt: device.lastSeenAt || null,
  };
}

async function getCachedAndroidState() {
  const stored = await browser.storage.local.get([
    "tryfoxAndroidDevice",
    "tryfoxAndroidDevices",
  ]);
  const storedDevices = Array.isArray(stored.tryfoxAndroidDevices)
    ? stored.tryfoxAndroidDevices
    : stored.tryfoxAndroidDevice
      ? [{ ...stored.tryfoxAndroidDevice, selected: true }]
      : [];

  return {
    status: storedDevices.length ? "Checking Android devices..." : "No Android device paired.",
    devices: storedDevices.map(publicCachedAndroidDevice),
    device: storedDevices[0] ? publicCachedAndroidDevice(storedDevices[0]) : null,
    hasDevice: storedDevices.length > 0,
  };
}

async function ensureEndpointPermission(endpointPermissionPattern) {
  if (!endpointPermissionPattern || Array.isArray(endpointPermissionPattern) && !endpointPermissionPattern.length) {
    return false;
  }

  return browser.permissions.contains({
    origins: Array.isArray(endpointPermissionPattern) ? endpointPermissionPattern : [endpointPermissionPattern],
  });
}

browser.tabs.query({ active: true, currentWindow: true }).then(async tabs => {
  const activeTab = tabs[0] || null;
  const resolvedTryPage = await resolveTryPayloadForTab(activeTab);
  const originUrl = resolvedTryPage.resolvedUrl;
  const tryPayload = resolvedTryPage.tryPayload;
  const deepLink = tryPayload ? tryPayload.tryfoxDeepLink : null;
  const supportsHttpsQr = Boolean(originUrl && resolvedTryPage.pageType !== "unsupported");

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
    const androidUnsupportedMessage = document.getElementById("android_unsupported_message");
    const androidDeviceList = document.getElementById("android_device_list");
    const androidSendTitleInput = document.getElementById("android_send_title");
    const androidActions = document.getElementById("android_actions");
    const sendToAndroidButton = document.getElementById("send_to_android");
    const scanAndroidQrButton = document.getElementById("scan_android_qr");
    const qrCodeFilename = getQRCodeFilename(originUrl);
    let androidState = null;
    const sendHighlights = new Map();
    let androidRefreshIntervalId = null;
    let isSendingToAndroid = false;

    modeDeeplinkButton.disabled = !deepLink;
    modeHttpsButton.disabled = !supportsHttpsQr;

    function getModeData(mode) {
      if (mode === "https") {
        return {
          header: resolvedTryPage.pageType === "phabricator" ? "Treeherder Link" : "Origin Link",
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
      const devices = state && Array.isArray(state.devices) ? state.devices : [];
      const connectedDevices = devices.filter(device => device.status === "connected");
      const selectedConnectedDevices = connectedDevices.filter(device => device.selected !== false);
      const hasTryPayload = Boolean(tryPayload);

      androidDeviceList.textContent = "";

      if (devices.length) {
        androidStatus.textContent = `${devices.length} Android device${devices.length === 1 ? "" : "s"} paired.`;
        for (const device of devices) {
          androidDeviceList.appendChild(createAndroidDeviceCard(device));
        }
      } else {
        androidStatus.textContent = "No Android device paired.";
      }

      androidActions.hidden = !devices.length;
      androidUnsupportedMessage.hidden = hasTryPayload;
      sendToAndroidButton.disabled = isSendingToAndroid || !hasTryPayload || !selectedConnectedDevices.length;
      return state;
    }

    function createAndroidDeviceCard(device) {
      const isConnected = device.status === "connected";
      const isChecking = device.status === "checking";
      const sendHighlight = sendHighlights.get(device.deviceId);
      const card = document.createElement("div");
      card.className = [
        "android_device_card",
        isConnected ? "" : "is-disabled",
        sendHighlight === "success" ? "is-send-success" : "",
        sendHighlight === "failure" ? "is-send-failure" : "",
        sendHighlight === "sending" ? "is-sending" : "",
      ].filter(Boolean).join(" ");

      const label = document.createElement("label");
      label.className = "android_device_option";

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.className = "android_device_checkbox";
      checkbox.checked = isConnected && device.selected !== false;
      checkbox.disabled = !isConnected;
      checkbox.addEventListener("change", () => {
        sendBackgroundMessage("SET_ANDROID_DEVICE_SELECTED", {
          deviceId: device.deviceId,
          selected: checkbox.checked,
        })
          .then(renderAndroidState)
          .catch(() => {
            androidStatus.textContent = "Failed to update Android device selection.";
            checkbox.checked = !checkbox.checked;
          });
      });

      const text = document.createElement("span");
      const name = document.createElement("span");
      name.className = "android_device_name";
      name.textContent = device.deviceName;

      const state = document.createElement("span");
      state.className = "android_device_state";
      state.textContent = isConnected ? "Connected" : isChecking ? "Checking..." : "Disconnected";

      text.appendChild(name);
      text.appendChild(state);
      label.appendChild(checkbox);
      label.appendChild(text);

      const deleteButton = document.createElement("button");
      deleteButton.className = "android_device_delete";
      deleteButton.type = "button";
      deleteButton.setAttribute("aria-label", `Forget ${device.deviceName}`);
      deleteButton.setAttribute("title", `Forget ${device.deviceName}`);
      deleteButton.innerHTML = `<svg class="android_device_delete_icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M6.5 2a1 1 0 0 0-1 1v.5H3a.5.5 0 0 0 0 1h.5v8A1.5 1.5 0 0 0 5 14h6a1.5 1.5 0 0 0 1.5-1.5v-8h.5a.5.5 0 0 0 0-1h-2.5V3a1 1 0 0 0-1-1h-3Zm3 1v.5h-3V3h3Zm-5 1.5h7v8a.5.5 0 0 1-.5.5H5a.5.5 0 0 1-.5-.5v-8Zm2 1.5a.5.5 0 0 1 .5.5v4a.5.5 0 0 1-1 0v-4a.5.5 0 0 1 .5-.5Zm3 0a.5.5 0 0 1 .5.5v4a.5.5 0 0 1-1 0v-4a.5.5 0 0 1 .5-.5Z"/></svg>`;
      deleteButton.addEventListener("click", () => {
        sendBackgroundMessage("FORGET_ANDROID_DEVICE", { deviceId: device.deviceId })
          .then(renderAndroidState)
          .catch(() => {
            androidStatus.textContent = "Failed to forget Android device.";
          });
      });

      card.appendChild(label);
      card.appendChild(deleteButton);
      return card;
    }

    function refreshAndroidState() {
      return sendBackgroundMessage("GET_ANDROID_STATE")
        .then(renderAndroidState)
        .catch(() => {
          renderAndroidState(androidState || {
            status: "Android state unavailable.",
            devices: [],
          });
        });
    }

    function startAndroidRefreshLoop() {
      if (androidRefreshIntervalId) {
        return;
      }

      androidRefreshIntervalId = setInterval(() => {
        if (!androidPanel.hidden) {
          refreshAndroidState();
        }
      }, 2000);
    }

    function withDeviceStatuses(state, statusByDeviceId) {
      if (!state || !Array.isArray(state.devices)) {
        return state;
      }

      return {
        ...state,
        devices: state.devices.map(device => {
          const nextStatus = statusByDeviceId.get(device.deviceId);
          if (!nextStatus) {
            return device;
          }

          return {
            ...device,
            status: nextStatus,
          };
        }),
      };
    }

    function setSendHighlights(results, stateToRender = androidState) {
      for (const result of results) {
        sendHighlights.set(result.deviceId, result.ok ? "success" : "failure");
        setTimeout(() => {
          sendHighlights.delete(result.deviceId);
          if (androidState) {
            renderAndroidState(androidState);
          }
        }, 5000);
      }

      if (stateToRender) {
        renderAndroidState(stateToRender);
      }
    }

    function setSendingHighlights(devices) {
      for (const device of devices) {
        sendHighlights.set(device.deviceId, "sending");
      }

      if (androidState) {
        renderAndroidState(androidState);
      }
    }

    function setActiveMode(mode) {
      if (mode === "deeplink" && !deepLink) {
        mode = supportsHttpsQr ? "https" : "android";
      }

      if (mode === "https" && !supportsHttpsQr) {
        mode = "android";
      }

      setModeButtons(mode);
      urlPanel.hidden = mode === "android";
      androidPanel.hidden = mode !== "android";

      if (mode === "android") {
        if (androidState) {
          renderAndroidState(androidState);
        }
        refreshAndroidState();
        startAndroidRefreshLoop();
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
    androidSendTitleInput.addEventListener("keydown", event => {
      if (event.key !== "Enter" || sendToAndroidButton.disabled) {
        return;
      }

      event.preventDefault();
      sendToAndroidButton.click();
    });
    sendToAndroidButton.addEventListener("click", async () => {
      const devices = androidState && Array.isArray(androidState.devices) ? androidState.devices : [];
      const selectedDevices = devices.filter(device => device.status === "connected" && device.selected !== false);
      const sendTitle = androidSendTitleInput.value.trim();

      if (!tryPayload || !selectedDevices.length) {
        return;
      }

      try {
        const origins = [...new Set(selectedDevices.map(device => device.endpointPermissionPattern))];
        const allowed = await ensureEndpointPermission(origins);
        if (!allowed) {
          androidStatus.textContent = "Permission was not granted for the Android endpoint.";
          return;
        }

        isSendingToAndroid = true;
        sendToAndroidButton.disabled = true;
        setSendingHighlights(selectedDevices);
        const result = await sendBackgroundMessage("SEND_TRY_TO_ANDROID", {
          tryPayload: {
            ...tryPayload,
            title: sendTitle || null,
          },
          deviceIds: selectedDevices.map(device => device.deviceId),
        });
        setSendHighlights(result.results || [], result.state);
      } catch (error) {
        const failedResults = selectedDevices.map(device => ({
          deviceId: device.deviceId,
          ok: false,
        }));
        const disconnectedDeviceIds = new Map(
          selectedDevices.map(device => [device.deviceId, "disconnected"])
        );
        setSendHighlights(failedResults, withDeviceStatuses(androidState, disconnectedDeviceIds));
        refreshAndroidState();
      } finally {
        isSendingToAndroid = false;
        const devices = androidState && Array.isArray(androidState.devices) ? androidState.devices : [];
        const selectedDevices = devices.filter(device => device.status === "connected" && device.selected !== false);
        sendToAndroidButton.disabled = !tryPayload || !selectedDevices.length;
      }
    });

    try {
      const initialAndroidState = await getCachedAndroidState();
      renderAndroidState(initialAndroidState);

      if (initialAndroidState.devices && initialAndroidState.devices.length) {
        setActiveMode("android");
      } else if (deepLink) {
        setActiveMode("deeplink");
      } else if (supportsHttpsQr) {
        setActiveMode("https");
      } else {
        unsupportedMessage.hidden = false;
        urlQrContent.hidden = true;
        setActiveMode("android");
      }
    } catch (error) {
      if (deepLink) {
        setActiveMode("deeplink");
      } else if (supportsHttpsQr) {
        setActiveMode("https");
      } else {
        unsupportedMessage.hidden = false;
        urlQrContent.hidden = true;
        setActiveMode("android");
      }
    }

    container.hidden = false;
    window.addEventListener("pagehide", () => {
      if (androidRefreshIntervalId) {
        clearInterval(androidRefreshIntervalId);
      }
    });
  });
});
