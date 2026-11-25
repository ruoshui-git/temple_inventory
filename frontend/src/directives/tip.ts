import { h, withDirectives, type ObjectDirective, type VNode } from "vue";
import { removeTooltip, setTooltip, type TooltipValue } from "../lib/tooltip";

export const vTip: ObjectDirective<HTMLElement, TooltipValue, "overflow"> = {
  mounted(element, { value, modifiers }) {
    setTooltip(element, value, Boolean(modifiers.overflow));
  },
  updated(element, { value, oldValue, modifiers }) {
    if (value !== oldValue)
      setTooltip(element, value, Boolean(modifiers.overflow));
  },
  beforeUnmount: removeTooltip,
};

/** The span receives pointer/focus events engines suppress on a disabled button. */
export function buttonWithTip(
  button: VNode,
  value: string | undefined,
  disabled: boolean,
) {
  if (!value || !disabled) return withDirectives(button, [[vTip, value]]);
  return withDirectives(
    h(
      "span",
      {
        class: "disabled-button-tip",
        tabindex: 0,
        "aria-disabled": "true",
        "aria-label": button.props?.["aria-label"],
        "aria-labelledby": button.props?.["aria-labelledby"],
        "aria-describedby": button.props?.["aria-describedby"],
      },
      [button],
    ),
    [[vTip, value]],
  );
}
