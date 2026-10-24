export type FilterPopoverPlacement = {
  side: "below" | "above";
  top: number;
  maxHeight: number;
  minHeight: number;
  left?: number;
};

export function chooseFilterPopoverPlacement(options: {
  triggerTop: number;
  triggerBottom: number;
  viewportHeight: number;
  naturalHeight: number;
  margin?: number;
  gap?: number;
  minimumHeight?: number;
  triggerLeft?: number;
  triggerRight?: number;
  viewportWidth?: number;
  popupWidth?: number;
  align?: "start" | "end";
  horizontalMargin?: number;
}): FilterPopoverPlacement {
  const margin = options.margin ?? 12;
  const gap = options.gap ?? 8;
  const minimum = Math.min(options.naturalHeight, options.minimumHeight ?? 360);
  const belowTop = options.triggerBottom + gap;
  const below = Math.max(0, options.viewportHeight - margin - belowTop);
  const above = Math.max(0, options.triggerTop - gap - margin);
  const side = below >= minimum || below >= above ? "below" : "above";
  const available = side === "below" ? below : above;
  const placement: FilterPopoverPlacement = {
    side,
    top:
      side === "below"
        ? belowTop
        : Math.max(
            margin,
            options.triggerTop -
              gap -
              Math.min(options.naturalHeight, available),
          ),
    maxHeight: available,
    minHeight: Math.min(minimum, available),
  };
  if (options.viewportWidth !== undefined && options.popupWidth !== undefined) {
    const horizontalMargin = options.horizontalMargin ?? 8;
    const width = Math.min(
      options.popupWidth,
      Math.max(0, options.viewportWidth - horizontalMargin * 2),
    );
    const anchorLeft = options.triggerLeft ?? 0;
    const anchorRight = options.triggerRight ?? anchorLeft;
    const preferred =
      options.align === "end" ? anchorRight - width : anchorLeft;
    placement.left = Math.max(
      horizontalMargin,
      Math.min(preferred, options.viewportWidth - width - horizontalMargin),
    );
  }
  return placement;
}
