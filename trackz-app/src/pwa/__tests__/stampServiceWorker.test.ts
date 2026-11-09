import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath, URL } from "node:url";
import {
  BUILD_ID_PLACEHOLDER,
  deriveBuildId,
  stampServiceWorker,
  type EmittedFile,
} from "@/pwa/stampServiceWorker";

/**
 * Tests for the sw.js build-id stamp.
 *
 * This exists because of a shipped bug: CACHE_VERSION in sw.js was a frozen
 * literal, so every deploy emitted a byte-identical service worker, so the
 * browser never installed one, so the "new version available" toast — fully
 * built, correctly wired — had never fired in production even once.
 *
 * The two properties below are both load-bearing and they pull in OPPOSITE
 * directions, which is the whole reason this is tested rather than inlined:
 *   - changed code MUST change the output, or no user is ever prompted;
 *   - unchanged code MUST NOT change the output, or every user is prompted
 *     to reload on every deploy, which trains them to ignore the toast.
 * A naive implementation (a timestamp, say) satisfies the first and fails
 * the second, and manual testing would never catch it.
 */

const appRoot = fileURLToPath(new URL("../../..", import.meta.url));

function readRealServiceWorker(): string {
  return readFileSync(resolve(appRoot, "public/sw.js"), "utf8");
}

/**
 * Run sw.js and report the CACHE_VERSION it actually computes.
 *
 * Evaluating it, rather than searching the text for the build id, is the
 * difference between this file testing something and testing nothing. sw.js
 * mentions __BUILD_ID__ in its own comments, so a substring assertion
 * passes on a stamped COMMENT while CACHE_VERSION sits frozen at
 * "trackz-v1" — which is precisely the shipped bug. Caught by mutation
 * testing: reverting sw.js to the literal left the substring version of
 * this test green.
 *
 * The stub self absorbs sw.js's top-level addEventListener calls; nothing
 * else runs at import time.
 */
function evaluateCacheVersion(swSource: string): string {
  const stubSelf = { addEventListener: () => {}, location: { origin: "https://example.test" } };
  return new Function("self", `${swSource}\nreturn CACHE_VERSION;`)(stubSelf) as string;
}

const bundle: EmittedFile[] = [
  { fileName: "index.html", content: "<!doctype html><title>trackz</title>" },
  { fileName: "assets/index-AAAAAAAA.js", content: "console.log(1)" },
  { fileName: "assets/index-BBBBBBBB.css", content: ".a{color:red}" },
];

describe("deriveBuildId", () => {
  it("changes when a chunk's content changes", () => {
    const changed = bundle.map((f) =>
      f.fileName.endsWith(".js") ? { ...f, content: "console.log(2)" } : f,
    );

    expect(deriveBuildId(changed)).not.toBe(deriveBuildId(bundle));
  });

  it("changes when ONLY index.html changes", () => {
    // The reason this hashes content instead of reading Vite's filename
    // hashes. index.html is not content-hashed, so a filename-derived id
    // is constant across any html-only edit — measured, not theorised:
    // adding a <meta> tag left the id byte-identical, meaning a
    // manifest-link or theme-color change would ship with no prompt.
    const changed = bundle.map((f) =>
      f.fileName === "index.html" ? { ...f, content: '<!doctype html><meta name="x">' } : f,
    );

    expect(deriveBuildId(changed)).not.toBe(deriveBuildId(bundle));
  });

  it("changes when a file is renamed but its content is not", () => {
    // A ONE-file bundle on purpose. Renaming inside a multi-file bundle
    // usually also changes its sort position, so the id moves even if
    // filenames are not hashed at all — this test passed against exactly
    // that mutation until the bundle was reduced to a single entry.
    const before = deriveBuildId([{ fileName: "assets/a.js", content: "same" }]);
    const after = deriveBuildId([{ fileName: "assets/b.js", content: "same" }]);

    expect(after).not.toBe(before);
  });

  it("changes when a file is added", () => {
    const changed = [...bundle, { fileName: "assets/extra.js", content: "" }];

    expect(deriveBuildId(changed)).not.toBe(deriveBuildId(bundle));
  });

  it("is byte-identical for the same bundle", () => {
    // Idempotence. A rebuild of unchanged source must produce the same
    // worker bytes, or the browser sees an update on every single deploy
    // and prompts a reload that accomplishes nothing.
    expect(deriveBuildId(bundle)).toBe(deriveBuildId(bundle));
  });

  it("ignores the order files are reported in", () => {
    // Rollup's bundle key order is not a contract. Without the sort this
    // passes locally and then flips on some other machine, producing a
    // spurious update prompt that is near-impossible to reproduce.
    expect(deriveBuildId([...bundle].reverse())).toBe(deriveBuildId(bundle));
  });

  it("does not confuse a name/content boundary shift for the same build", () => {
    // Without a separator that cannot occur in a filename, ("ab", "c") and
    // ("a", "bc") would hash the same material.
    const left = deriveBuildId([{ fileName: "ab", content: "c" }]);
    const right = deriveBuildId([{ fileName: "a", content: "bc" }]);

    expect(left).not.toBe(right);
  });

  it("is a fixed-length hex string", () => {
    // Pinned because the value lands in a Cache Storage key; an unbounded
    // id (e.g. concatenated filenames) would grow with the bundle.
    expect(deriveBuildId(bundle)).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe("stampServiceWorker", () => {
  it("replaces every occurrence of the placeholder", () => {
    const source = `const A = "${BUILD_ID_PLACEHOLDER}"; const B = "${BUILD_ID_PLACEHOLDER}";`;

    const stamped = stampServiceWorker(source, bundle);

    // sw.js uses the token twice (value + fallback guard), so a
    // replace-first-only would leave a live placeholder in shipped code.
    expect(stamped).not.toContain(BUILD_ID_PLACEHOLDER);
  });

  it("throws when the placeholder is missing", () => {
    // Returning the source unchanged would recreate the original bug AND
    // hide it: a frozen CACHE_VERSION with a green build. Only a thrown
    // error cannot be overlooked.
    expect(() => stampServiceWorker('const CACHE_VERSION = "trackz-v1";', bundle)).toThrow(
      /__BUILD_ID__ not found/,
    );
  });

  it("makes the real sw.js compute a CACHE_VERSION carrying the build id", () => {
    // Guards the seam between this module and the actual file, and asserts
    // the EVALUATED constant rather than the file text — see
    // evaluateCacheVersion for why a substring check here proved vacuous.
    const stamped = stampServiceWorker(readRealServiceWorker(), bundle);

    expect(evaluateCacheVersion(stamped)).toBe(`trackz-${deriveBuildId(bundle)}`);
  });

  it("gives the real sw.js a different CACHE_VERSION for a different build", () => {
    // The end-to-end property the update prompt depends on: new code must
    // move the worker's cache name, which is what changes its bytes.
    const swSource = readRealServiceWorker();
    const other = [...bundle, { fileName: "assets/new.js", content: "x" }];

    expect(evaluateCacheVersion(stampServiceWorker(swSource, other))).not.toBe(
      evaluateCacheVersion(stampServiceWorker(swSource, bundle)),
    );
  });

  it("leaves the unstamped sw.js valid, falling back to a dev cache name", () => {
    // The fallback matters because the plugin runs only on `vite build`. A
    // bare token (CACHE_VERSION = __BUILD_ID__) would be a ReferenceError
    // that kills the worker at install and takes offline support with it.
    expect(evaluateCacheVersion(readRealServiceWorker())).toBe("trackz-dev");
  });
});
