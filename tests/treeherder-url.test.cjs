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

const { toTryfoxDeepLink } = loadTranslator();

test("translates a Treeherder revision URL", () => {
  assert.equal(
    toTryfoxDeepLink("https://treeherder.mozilla.org/jobs?repo=try&revision=673673d375640a9229404d6f7efc30943bad8b9d"),
    "tryfox://jobs?repo=try&revision=673673d375640a9229404d6f7efc30943bad8b9d"
  );
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
