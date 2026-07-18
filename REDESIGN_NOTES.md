# Redesign Notes - Quant-Fund Positioning

Branch: `redesign/quant-fund-positioning` (off `main`).
Scope: targeted edits to the landing page (`index.html`, `styles.css`) per the
Lians landing-page revision brief. All nine changes are committed individually
with `Change N:` prefixes; the first commit is a baseline (see below).

## Flags / follow-ups for E

1. **Hero "Book a demo" CTA is a `mailto:` placeholder (Change 1).**
   There is no Calendly link or `/contact` route in the codebase, so the
   primary CTA points to `mailto:ethan.g.beirne@gmail.com?subject=Lians demo
   request`. A personal Gmail in the hero is not ideal for a regulated-finance
   buyer. **Replace with a Calendly link, a `demo@lians.ai` address, or a
   `/contact` route before launch.** Marked with a `<!-- TODO -->` in the hero.

2. **Baseline commit contains pre-existing in-progress work, not mine.**
   `main` had a dirty working tree when this started: `index.html`,
   `styles.css`, and `script.js` were already mid-redesign (section reorg,
   niche cards, SDK section), alongside unrelated backend changes (`app.js`,
   `server.js`, `clerk-loader.js`, etc.). To keep the per-change diffs clean and
   reviewable, the in-progress landing-page edits were captured in a single
   `Baseline:` commit first. The unrelated backend changes were left
   **uncommitted and untouched** on the branch - they are not part of this
   redesign and are yours to commit separately.

3. **Screenshots were not captured.** The brief asked for
   `/redesign-screenshots/change-N.png`. No headless-browser tooling
   (Puppeteer/Playwright) is installed, and the project has no build/lint step
   (only `npm start` -> `node server.js`). To review visually: run
   `node server.js` and open the site, or ask me to add Puppeteer and generate
   the screenshots.

4. **Trust strip uses only honestly-supported claims (Change 8).** No "SOC 2
   Type I in progress" - the site never states it, and fabricating a cert was
   out of bounds. No founder-credibility line either (couldn't state a
   background accurately). Both, plus design-partner logos, are left as
   `<!-- TODO -->` comments in the trust strip for when real signals exist.

## Notable design decisions (where the brief allowed latitude)

- **Change 2 ("Two stores"):** Took the option-2 path rather than splitting the
  connected flow diagram (agent -> engine -> stores) into the header, which
  would have been invasive. Collapsed the header's orphaned empty grid column
  to a single column and tightened the gap so the headline pairs with the
  diagram directly below it.
- **Change 6 (palette):** `architecture-section` went mint -> **dark** (not
  cream) because its inner store cards (`#f7f5ef`) would have blended into a
  cream background, and dark gives the page a cleaner cream/dark rhythm. The
  `closing` section went full-coral -> **cream** with a coral accent dot and a
  lime CTA, so coral is now accent-only per the brief; its button changed
  `button-light` -> `button-primary` to stay visible. The `feature-wide` card
  (`#dce5db`) is a component card and was intentionally left as an accent.
- **Change 9 (serif motif):** The existing `h1 em, h2 em` rule already rendered
  both "changed." (hero) and "defend." (closing) in Georgia serif italic, so
  the motif partly existed. Added a `.serif-em` class on "valid" (section 01)
  and "when" (verticals) to extend it into body copy intentionally.

## What was deliberately not changed
L-mark/nav, lime CTA color, the 01/02 markers, the `memory.py` code block, the
SDK install tabs, the Apache 2.0 / open-source line, Memory Governor copy, and
the verticals card copy (reordered/relabeled only). `script.js` logic untouched.
