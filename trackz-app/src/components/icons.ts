/**
 * The app's whole icon vocabulary. Every lucide icon used anywhere is
 * re-exported here and imported from here — never from "lucide-preact"
 * directly — so the set is one file to read rather than a grep. Re-exports
 * still tree-shake per icon (lucide-preact is sideEffects:false, one ESM
 * module per icon).
 *
 * Call sites pass size="1em" and nothing else: icons inherit font-size and
 * color (stroke="currentColor") exactly like the unicode glyphs they
 * replaced, so the existing .tab-bar__icon / .insight__icon CSS drives them.
 * Lucide sets aria-hidden="true" unless an a11y prop is passed; labels live
 * on the wrapping <button>.
 */
export {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  Delete,
  House,
  List,
  Plus,
  Settings,
  SlidersHorizontal,
  Wallet,
  X,
} from "lucide-preact";
