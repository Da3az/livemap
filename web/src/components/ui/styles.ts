/*
 * Class strings shared across the kit, so that things with the same job look
 * the same: every floating panel, every row inside one, every boxed field.
 * Tokens only; direction-neutral.
 */

/** Anything that floats: menu, select list, popover. Flat panel, strong rule, the one shadow. */
export const overlayPanel =
  "z-50 rounded-block border border-rule-strong bg-panel text-sm text-ink shadow-overlay outline-none transition-[opacity,translate] duration-150 ease-out-quiet data-entering:opacity-0 data-exiting:opacity-0 data-[placement=bottom]:data-entering:-translate-y-1 data-[placement=top]:data-entering:translate-y-1"

/** One row in a menu or option list. The keyboard position is a fill; selection adds weight and a tick. */
export const overlayItem =
  "relative flex min-h-field cursor-default items-center gap-2 rounded-key px-2 py-1 text-sm text-ink outline-none select-none data-focused:bg-well data-pressed:bg-rule data-disabled:pointer-events-none data-disabled:text-ink-3 data-inset:ps-7 data-[variant=destructive]:text-danger data-[variant=destructive]:data-focused:bg-danger-wash [&_svg]:pointer-events-none [&_svg]:shrink-0"

/** Adds to `overlayItem` where a row can be the chosen one. */
export const overlayItemSelectable =
  "pe-8 data-selected:bg-selected data-selected:font-semibold data-selected:data-focused:bg-selected"

/** The small heading over a group of rows. */
export const overlayLabel = "px-2 pt-1.5 pb-1 text-2xs font-semibold text-plum select-none data-inset:ps-7"

export const overlayRule = "-mx-1 my-1 h-px border-0 bg-rule"

/** The keyboard hint at the end of a row. */
export const overlayShortcut = "ms-auto ps-3 text-2xs text-ink-3 tabular-nums"

/** The box of a text field, shared by input, textarea, select trigger and input group. */
export const fieldBox =
  "rounded-field border border-rule-strong bg-panel text-sm text-ink transition-colors duration-100"

export const fieldHover = "hover:border-ink-3"

/** Disabled: a well, a dashed rule, quiet text. Not just faded. */
export const fieldDisabled =
  "disabled:pointer-events-none disabled:border-dashed disabled:bg-well disabled:text-ink-3 data-disabled:pointer-events-none data-disabled:border-dashed data-disabled:bg-well data-disabled:text-ink-3"

/** Invalid: the danger rule and a wash. The message beside it carries the words. */
export const fieldInvalid =
  "aria-invalid:border-danger aria-invalid:bg-danger-wash data-invalid:border-danger data-invalid:bg-danger-wash"

/** Focus for controls whose real input is hidden, so `:focus-visible` never reaches the visible part. */
export const focusMark =
  "data-focus-visible:outline-2 data-focus-visible:outline-offset-2 data-focus-visible:outline-focus data-focus-visible:outline-solid"
