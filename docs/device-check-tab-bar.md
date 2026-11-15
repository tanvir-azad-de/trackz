# Device check: floating tab bar (2026-11-15)

**PASSED 2026-11-15:** the user confirmed all 7 on the iPhone.

Run on the iPhone, using the production PWA after the push.

1. The bar floats clear of the home indicator. It doesn't touch it and doesn't sit noticeably high.
2. The capsule's blur reads cleanly over scrolling Activity rows, with no smearing or flicker.
3. Each of the 4 icons switches tab on the first tap, including taps near the capsule's ends.
4. Add opens the entry screen. Its circle lines up with the capsule (same height, centered).
5. Tapping in the gap between the capsule and Add hits the content behind it, not nothing.
6. The last row on each screen can scroll fully above the bar.
7. The Undo/saved toast appears above the bar, not behind it.
