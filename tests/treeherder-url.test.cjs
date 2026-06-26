"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function loadTranslator() {
  const filePath = path.join(__dirname, "..", "popup", "treeherder-url.js");
  const source = fs.readFileSync(filePath, "utf8");
  const context = {
    URL,
    URLSearchParams,
    globalThis: {},
  };

  vm.runInNewContext(source, context, { filename: filePath });
  return context.globalThis.tryfoxTreeherderUrl;
}

const {
  extractLatestPhabricatorTryLinkData,
  isPhabricatorRevisionUrl,
  parseTryfoxJobUrl,
  toTryfoxDeepLink,
} = loadTranslator();

function plainObject(value) {
  return JSON.parse(JSON.stringify(value));
}

function createAnchor({ href = "", textContent = "", id = "", name = "", attributes = {} } = {}) {
  return {
    href,
    textContent,
    id,
    getAttribute(attributeName) {
      if (attributeName === "href") {
        return attributes.href || href || null;
      }
      if (attributeName === "name") {
        return name || null;
      }
      return Object.prototype.hasOwnProperty.call(attributes, attributeName) ? attributes[attributeName] : null;
    },
  };
}

function createTimelineEvent({ author, tryLinks = [], anchorId = null } = {}) {
  const authorAnchor = author
    ? createAnchor({
        href: author.href,
        textContent: author.textContent,
        attributes: { href: author.href },
      })
    : null;
  const commentAnchor = anchorId ? createAnchor({ id: anchorId }) : null;
  const links = tryLinks.map(href => createAnchor({ href, attributes: { href } }));

  return {
    querySelector(selector) {
      if (selector === ".phui-timeline-title .phui-link-person, .phui-timeline-title .phui-link-profile, .phui-timeline-title .phui-handle") {
        return authorAnchor;
      }
      if (selector === ".phabricator-anchor-view[id], .phabricator-anchor-view[name]") {
        return commentAnchor;
      }
      return null;
    },
    querySelectorAll(selector) {
      if (selector === "a[href]") {
        return links;
      }
      return [];
    },
  };
}

function createSummarySection({ title, tryLinks = [] } = {}) {
  const header = { textContent: title };
  const links = tryLinks.map(href => createAnchor({ href, attributes: { href } }));

  return {
    querySelector(selector) {
      if (selector === ".phui-property-list-section-header") {
        return header;
      }
      return null;
    },
    querySelectorAll(selector) {
      if (selector === "a[href]") {
        return links;
      }
      return [];
    },
  };
}

function createDocument({ timelineEvents = [], summarySections = [] } = {}) {
  return {
    querySelectorAll(selector) {
      if (selector === ".phui-timeline-shell") {
        return timelineEvents;
      }
      if (selector === ".phui-property-list-section") {
        return summarySections;
      }
      return [];
    },
  };
}

test("translates a Treeherder revision URL", () => {
  assert.equal(
    toTryfoxDeepLink("https://treeherder.mozilla.org/jobs?repo=try&revision=673673d375640a9229404d6f7efc30943bad8b9d"),
    "tryfox://jobs?repo=try&revision=673673d375640a9229404d6f7efc30943bad8b9d"
  );
});

test("parses a Treeherder revision URL into a Try payload", () => {
  const sourceUrl = "https://treeherder.mozilla.org/jobs?repo=try&revision=673673d375640a9229404d6f7efc30943bad8b9d";

  assert.deepEqual(plainObject(parseTryfoxJobUrl(sourceUrl)), {
    sourceUrl,
    tryfoxDeepLink: "tryfox://jobs?repo=try&revision=673673d375640a9229404d6f7efc30943bad8b9d",
    repo: "try",
    revision: "673673d375640a9229404d6f7efc30943bad8b9d",
    author: null,
  });
});

test("translates a hash-routed Treeherder revision URL", () => {
  assert.equal(
    toTryfoxDeepLink("https://treeherder.mozilla.org/#/jobs?repo=try&revision=673673d375640a9229404d6f7efc30943bad8b9d"),
    "tryfox://jobs?repo=try&revision=673673d375640a9229404d6f7efc30943bad8b9d"
  );
});

test("translates revision URLs consistently", () => {
  const samples = [
    "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    "cccccccccccccccccccccccccccccccccccccccc",
    "1234567890abcdef1234567890abcdef12345678",
    "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
  ];

  for (const revision of samples) {
    assert.equal(
      toTryfoxDeepLink(`https://treeherder.mozilla.org/jobs?repo=try&revision=${revision}`),
      `tryfox://jobs?repo=try&revision=${revision}`
    );
  }
});

test("translates author URLs and drops repo", () => {
  const authors = [
    "tthibaud%40mozilla.com",
    "nobody%40mozilla.com",
    "release.bot%40mozilla.com",
  ];

  for (const author of authors) {
    assert.equal(
      toTryfoxDeepLink(`https://treeherder.mozilla.org/jobs?repo=try&author=${author}`),
      `tryfox://jobs?author=${author}`
    );
  }
});

test("parses author URLs into a Try payload", () => {
  const sourceUrl = "https://treeherder.mozilla.org/jobs?repo=try&author=tthibaud%40mozilla.com";

  assert.deepEqual(plainObject(parseTryfoxJobUrl(sourceUrl)), {
    sourceUrl,
    tryfoxDeepLink: "tryfox://jobs?author=tthibaud%40mozilla.com",
    repo: null,
    revision: null,
    author: "tthibaud@mozilla.com",
  });
});

test("returns null for non-treeherder URLs", () => {
  assert.equal(
    toTryfoxDeepLink("https://example.com/jobs?repo=try&revision=673673d375640a9229404d6f7efc30943bad8b9d"),
    null
  );
});

test("returns null for non-https treeherder URLs", () => {
  assert.equal(
    toTryfoxDeepLink("http://treeherder.mozilla.org/jobs?repo=try&revision=673673d375640a9229404d6f7efc30943bad8b9d"),
    null
  );
});

test("returns null for unsupported treeherder routes", () => {
  assert.equal(
    toTryfoxDeepLink("https://treeherder.mozilla.org/intermittent-failures?repo=try"),
    null
  );
});

test("returns null when no supported deeplink parameters are present", () => {
  assert.equal(
    toTryfoxDeepLink("https://treeherder.mozilla.org/jobs?repo=try"),
    null
  );
});

test("detects Phabricator revision pages", () => {
  assert.equal(
    isPhabricatorRevisionUrl("https://phabricator.services.mozilla.com/D308996"),
    true
  );
  assert.equal(
    isPhabricatorRevisionUrl("https://phabricator.services.mozilla.com/T123"),
    false
  );
});

test("extracts the latest non-reviewbot try link from a Phabricator timeline", () => {
  const reviewerLink = "https://treeherder.mozilla.org/#/jobs?repo=try&revision=def456";
  const reviewbotLink = "https://treeherder.mozilla.org/#/jobs?repo=try&revision=zzz999";
  const doc = createDocument({
    timelineEvents: [
      createTimelineEvent({
        author: { href: "/p/alice/", textContent: "Alice" },
        tryLinks: [reviewerLink],
        anchorId: "comment-user",
      }),
      createTimelineEvent({
        author: { href: "/p/reviewbot/", textContent: "Automation" },
        tryLinks: [reviewbotLink],
        anchorId: "comment-reviewbot",
      }),
    ],
  });
  const locationLike = {
    origin: "https://phabricator.services.mozilla.com",
    pathname: "/D123",
    search: "",
  };

  assert.deepEqual(plainObject(extractLatestPhabricatorTryLinkData(doc, locationLike)), {
    url: reviewerLink,
    commentUrl: "https://phabricator.services.mozilla.com/D123#comment-user",
    commentId: "comment-user",
    repo: "try",
    revision: "def456",
  });
});

test("extracts a direct Treeherder link from a regular user comment on Phabricator", () => {
  const latestLink =
    "https://treeherder.mozilla.org/jobs?repo=try&revision=a084d7e94ff66eab2b53289411fbdbb6e9514ab9";
  const doc = createDocument({
    timelineEvents: [
      createTimelineEvent({
        author: { href: "/p/007/", textContent: "007" },
        tryLinks: [latestLink],
        anchorId: "10718916",
      }),
    ],
  });
  const locationLike = {
    origin: "https://phabricator.services.mozilla.com",
    pathname: "/D308677",
    search: "",
  };

  assert.deepEqual(plainObject(extractLatestPhabricatorTryLinkData(doc, locationLike)), {
    url: latestLink,
    commentUrl: "https://phabricator.services.mozilla.com/D308677#10718916",
    commentId: "10718916",
    repo: "try",
    revision: "a084d7e94ff66eab2b53289411fbdbb6e9514ab9",
  });
});

test("falls back to the Phabricator summary section when there is no timeline try link", () => {
  const summaryLink =
    "https://treeherder.mozilla.org/jobs?repo=try&revision=a75c53bce615ca85114213272d49929d4aba745b";
  const doc = createDocument({
    summarySections: [
      createSummarySection({
        title: "Summary",
        tryLinks: [summaryLink],
      }),
    ],
  });
  const locationLike = {
    origin: "https://phabricator.services.mozilla.com",
    pathname: "/D123",
    search: "",
  };

  assert.deepEqual(plainObject(extractLatestPhabricatorTryLinkData(doc, locationLike)), {
    url: summaryLink,
    commentUrl: null,
    commentId: null,
    repo: "try",
    revision: "a75c53bce615ca85114213272d49929d4aba745b",
  });
});
