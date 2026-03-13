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

  function toTryfoxDeepLink(rawUrl) {
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
      return `tryfox://jobs?${deepLinkParams.toString()}`;
    }

    const author = params.get("author");
    if (author) {
      return `tryfox://jobs?${new URLSearchParams({ author }).toString()}`;
    }

    return null;
  }

  return {
    toTryfoxDeepLink,
  };
});
