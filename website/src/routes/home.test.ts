import * as assert from "node:assert/strict";
import { describe, it } from "vite-plus/test";
import { renderString } from "../__tests__/ssr";
import { HomePage } from "./home";

/** The landing page, rendered to its SSR HTML. */
function renderHome(): Promise<string> {
  return renderString(HomePage());
}

describe("Home landing page (SSR)", () => {
  it("AC1/AC3: renders the hero with the tagline and the getting-started + GitHub CTAs", async () => {
    const html = await renderHome();
    assert.match(html, /Reactive UI, woven from Effect\./);
    assert.match(html, /href="\/docs\/tutorial\/01-your-first-app"/);
    assert.match(html, /href="https:\/\/github.com\/stefvw93\/weft"/);
  });

  it("AC1: renders the live demo (the real reactive-counter)", async () => {
    const html = await renderHome();
    assert.match(html, /home-demo/);
    assert.match(html, /demo-counter__value/);
    assert.match(html, />0</); // initial counter value
  });

  it("AC1: renders the differentiators row", async () => {
    const html = await renderHome();
    assert.match(html, /No virtual DOM/);
    assert.match(html, /No JSX, no plugins/);
    assert.match(html, /Effect-native/);
    assert.match(html, /Flash-free SSR/);
  });

  it("AC1: renders the build-time-highlighted code teaser", async () => {
    const html = await renderHome();
    assert.match(html, /home-teaser/);
    assert.match(html, /code-block/);
    assert.match(html, /SubscriptionRef/); // snippet content
    assert.match(html, /color:#/); // Shiki token colors (highlighted at build time)
  });

  it("AC1: renders the footer with links and the early-development note", async () => {
    const html = await renderHome();
    assert.match(html, /home-footer/);
    assert.match(html, /early development/);
  });
});
