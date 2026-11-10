import type { SelectHTMLAttributes } from "preact";
import { ChevronDown } from "@/components/icons";

/**
 * A form <select> with a ChevronDown drawn over its right edge.
 * globals.css sets appearance:none on every select (iOS otherwise paints its
 * own light-chrome arrow over this dark input), so the arrow has to be ours.
 * It used to be a CSS background-image data-URI, which can't follow
 * currentColor and so hardcoded #9aa0ad; an icon component can, but a
 * <select> can't hold children other than options — hence the wrapper with
 * the icon absolutely placed and pointer-events:none so taps reach the
 * select underneath.
 */
export function SelectInput(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <span class="entry-form__select">
      <select {...props} class="entry-form__input" />
      <ChevronDown size="1em" class="entry-form__select-chevron" />
    </span>
  );
}
