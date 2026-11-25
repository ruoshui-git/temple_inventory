import type { TooltipValue } from "../../src/lib/tooltip";
import { tooltipValueFor } from "../../src/lib/tooltip";

export function tooltipBinding(element: Element): TooltipValue {
  return tooltipValueFor(element as HTMLElement);
}
