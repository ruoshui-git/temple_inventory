export type CropBounds = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};
export type CropSelection = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export function largestCenteredSquare(bounds: CropBounds): CropSelection {
  const size = Math.max(
    0,
    Math.min(bounds.right - bounds.left, bounds.bottom - bounds.top),
  );
  return {
    x: bounds.left + (bounds.right - bounds.left - size) / 2,
    y: bounds.top + (bounds.bottom - bounds.top - size) / 2,
    width: size,
    height: size,
  };
}

export function imageBoundsInCanvas(
  image: Pick<DOMRect, "left" | "top" | "right" | "bottom">,
  canvas: Pick<DOMRect, "left" | "top">,
): CropBounds {
  return {
    left: image.left - canvas.left,
    top: image.top - canvas.top,
    right: image.right - canvas.left,
    bottom: image.bottom - canvas.top,
  };
}

export function clampSquareSelection(
  selection: CropSelection,
  bounds: CropBounds,
): CropSelection {
  const width = Math.max(0, bounds.right - bounds.left);
  const height = Math.max(0, bounds.bottom - bounds.top);
  const size = Math.min(
    Math.max(0, selection.width, selection.height),
    width,
    height,
  );
  return {
    x: Math.min(Math.max(selection.x, bounds.left), bounds.right - size),
    y: Math.min(Math.max(selection.y, bounds.top), bounds.bottom - size),
    width: size,
    height: size,
  };
}

export function cropBoundsInset(
  bounds: CropBounds,
  canvasWidth: number,
  canvasHeight: number,
) {
  return `${Math.max(0, bounds.top)}px ${Math.max(0, canvasWidth - bounds.right)}px ${Math.max(0, canvasHeight - bounds.bottom)}px ${Math.max(0, bounds.left)}px`;
}
