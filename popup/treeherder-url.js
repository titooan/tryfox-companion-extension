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
      };
    }

    return null;
  }

  function toTryfoxDeepLink(rawUrl) {
    const tryfoxJob = parseTryfoxJobUrl(rawUrl);
    return tryfoxJob ? tryfoxJob.tryfoxDeepLink : null;
  }

  return {
    parseTryfoxJobUrl,
    toTryfoxDeepLink,
  };
});
