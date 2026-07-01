"use strict";

(function(root, factory) {
  const exports = factory();

  if (typeof module !== "undefined" && module.exports) {
    module.exports = exports;
  }

  root.tryfoxTreeherderUrl = exports;
})(typeof globalThis !== "undefined" ? globalThis : this, function() {
  const TREEHERDER_HOST = "treeherder.mozilla.org";
  const TREEHERDER_PROTOCOL = "https:";
  const SUPPORTED_ROUTE = "/jobs";
  const PHABRICATOR_HOST = "phabricator.services.mozilla.com";
  const PHABRICATOR_REVISION_PATH = /^\/D\d+(?:\/|$)/i;
  const PHABRICATOR_TRY_LINK_PATTERN = /^https:\/\/treeherder\.mozilla\.org\/(#\/)?jobs\?/i;

  function getRouteAndParams(url) {
    if (url.hash && url.hash.startsWith("#/")) {
      const hashUrl = new URL(url.hash.slice(1), `${url.origin}/`);
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

  function parseTryfoxJobUrl(rawUrl) {
    let url;

    try {
      url = new URL(rawUrl);
    } catch (error) {
      return null;
    }

    if (url.protocol !== TREEHERDER_PROTOCOL || url.hostname !== TREEHERDER_HOST) {
      return null;
    }

    const { route, params } = getRouteAndParams(url);

    if (route !== SUPPORTED_ROUTE) {
      return null;
    }

    const revision = params.get("revision");
    const landoCommitId = params.get("landoCommitID") || params.get("lando_commit_id");
    const landoInstance = params.get("landoInstance") || params.get("lando_instance");
    if (revision) {
      const deepLinkParams = new URLSearchParams();
      const repo = params.get("repo");

      if (repo) {
        deepLinkParams.set("repo", repo);
      }

      deepLinkParams.set("revision", revision);
      return {
        sourceUrl: rawUrl,
        tryfoxDeepLink: `tryfox://jobs?${deepLinkParams.toString()}`,
        repo: repo || null,
        revision,
        author: null,
        landoCommitId: landoCommitId || null,
        landoInstance: landoInstance || null,
      };
    }

    const author = params.get("author");
    if (author) {
      return {
        sourceUrl: rawUrl,
        tryfoxDeepLink: `tryfox://jobs?${new URLSearchParams({ author }).toString()}`,
        repo: null,
        revision: null,
        author,
        landoCommitId: landoCommitId || null,
        landoInstance: landoInstance || null,
      };
    }

    if (landoCommitId) {
      return {
        sourceUrl: rawUrl,
        tryfoxDeepLink: null,
        repo: params.get("repo") || null,
        revision: null,
        author: null,
        landoCommitId,
        landoInstance: landoInstance || null,
      };
    }

    return null;
  }

  function isPhabricatorRevisionUrl(rawUrl) {
    let url;

    try {
      url = new URL(rawUrl);
    } catch (error) {
      return false;
    }

    return (
      url.protocol === TREEHERDER_PROTOCOL &&
      url.hostname === PHABRICATOR_HOST &&
      PHABRICATOR_REVISION_PATH.test(url.pathname)
    );
  }

  function parsePhabricatorTryLinkParams(url) {
    if (!url) {
      return {
        repo: null,
        revision: null,
      };
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
    return /\/p\/reviewbot\/?(?:$|[?#])/i.test(href);
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

  function buildBaseRevisionUrl(locationLike) {
    if (!locationLike) {
      return "";
    }

    const origin = locationLike.origin || "";
    const pathname = locationLike.pathname || "";
    const search = locationLike.search || "";
    return `${origin}${pathname}${search}`;
  }

  function getLastTryLink(anchors) {
    const tryLinks = anchors.filter(anchor => anchor && typeof anchor.href === "string" && PHABRICATOR_TRY_LINK_PATTERN.test(anchor.href));
    return tryLinks.length ? tryLinks[tryLinks.length - 1] : null;
  }

  function extractSummaryTryLinkData(doc) {
    if (!doc || typeof doc.querySelectorAll !== "function") {
      return null;
    }

    const sections = Array.from(doc.querySelectorAll(".phui-property-list-section"));
    for (const section of sections) {
      const header = typeof section.querySelector === "function"
        ? section.querySelector(".phui-property-list-section-header")
        : null;
      if (!header || !/\bsummary\b/i.test(header.textContent || "")) {
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

      const { repo, revision } = parsePhabricatorTryLinkParams(parsedUrl);
      return {
        url: tryLink.href,
        commentUrl: null,
        commentId: null,
        repo,
        revision,
      };
    }

    return null;
  }

  function extractLatestPhabricatorTryLinkData(doc, locationLike) {
    if (!doc || typeof doc.querySelectorAll !== "function") {
      return null;
    }

    const timelineEvents = Array.from(doc.querySelectorAll(".phui-timeline-shell"));
    const baseUrl = buildBaseRevisionUrl(locationLike);
    let latest = null;

    timelineEvents.forEach(eventNode => {
      if (isReviewbotComment(eventNode) || typeof eventNode.querySelectorAll !== "function") {
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

      const { repo, revision } = parsePhabricatorTryLinkParams(parsedUrl);
      const anchor = typeof eventNode.querySelector === "function"
        ? eventNode.querySelector(".phabricator-anchor-view[id], .phabricator-anchor-view[name]")
        : null;
      const anchorId = getAnchorId(anchor);

      latest = {
        url: tryLink.href,
        commentUrl: anchorId ? `${baseUrl}#${anchorId}` : null,
        commentId: anchorId || null,
        repo,
        revision,
      };
    });

    return latest || extractSummaryTryLinkData(doc);
  }

  function toTryfoxDeepLink(rawUrl) {
    const tryfoxJob = parseTryfoxJobUrl(rawUrl);
    return tryfoxJob ? tryfoxJob.tryfoxDeepLink : null;
  }

  return {
    extractLatestPhabricatorTryLinkData,
    isPhabricatorRevisionUrl,
    parseTryfoxJobUrl,
    toTryfoxDeepLink,
  };
});
