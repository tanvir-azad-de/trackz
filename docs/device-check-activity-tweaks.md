# 6-month chart + Activity tweaks: real-device checklist (iPhone Safari)

Written: 2026-11-11. Covers what Playwright/Chromium cannot settle. What
WAS verified in-session is in docs/renovation_version_1.txt section 5
("6-MONTH CHART + ACTIVITY TWEAKS"). Run against production after deploy.

DEVICE-VERIFIED 2026-11-11 by the user on iPhone, against production
(d63f0ae): every item below passed.

## Activity search clear (X)

- [x] Type in Search: one X appears inside the field, not two (Safari's
      native cancel glyph is hidden by CSS).
- [x] Tap the X: the text clears and the keyboard STAYS UP, with the
      caret in the field (the handler refocuses the input; iOS may
      refuse a programmatic focus and drop the keyboard).
- [x] The X is easy to hit with a thumb and does not open the keyboard
      a second time or scroll the page.

## Activity reset filters

- [x] Apply a facet in the Filter sheet: a funnel-with-X button appears
      right of Filter, and the search field shrinks without the row
      overflowing.
- [x] Tap it: facets clear, search text stays, the button disappears.

## Home chart

- [x] Six points, Jun..Nov labels, amounts readable, nothing clipped at
      the card's left/right edges.
- [x] Month pills on Activity ("Oct  -1.234,56 €", amount red/green) scroll
      sideways with momentum and the active pill follows the list.

## Home category sheet

- [x] Tapping the chart opens "Spending by category" on this month, and
      the press state does not flash dark patches around the points.
- [x] Swiping the sheet's month strip sideways does not scroll the list
      behind it or close the sheet; tapping a month swaps the list.
- [x] A long list (8-15 categories) scrolls with momentum under the
      pinned month pills (they must not move), and the page behind stays
      locked. A vertical drag that starts ON the pills should not scroll
      the page behind either.
