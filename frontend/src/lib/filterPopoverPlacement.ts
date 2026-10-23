export type FilterPopoverPlacement = {
  side: "below" | "above";
  top: number;
  maxHeight: number;
  minHeight: number;
};

export function chooseFilterPopoverPlacement(options: {
  triggerTop: number;
  triggerBottom: number;
  viewportHeight: number;
  naturalHeight: number;
  margin?: number;
  gap?: number;
  minimumHeight?: number;
}): FilterPopoverPlacement {
  const margin = options.margin ?? 12;
  const gap = options.gap ?? 8;
  const minimum = Math.min(options.naturalHeight, options.minimumHeight ?? 360);
  const belowTop = options.triggerBottom + gap;
  const below = Math.max(0, options.viewportHeight - margin - belowTop);
  const above = Math.max(0, options.triggerTop - gap - margin);
  const side = below >= minimum || below >= above ? "below" : "above";
  const available = side === "below" ? below : above;
  return {
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
}
