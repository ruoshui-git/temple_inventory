// Modal overlay layers in open order. Layers may close out of order (a phone menu
// sheet closes after the dialog it opened), so app inertness and the body scroll
// lock follow the layers still open instead of values each overlay saved.
const layers: HTMLElement[] = [];
let savedBody: { overflow: string; paddingRight: string } | undefined;

function sync() {
  const app = document.querySelector<HTMLElement>("[data-inventory-app]");
  if (app) app.inert = layers.length > 0;
  layers.forEach((layer, index) => {
    layer.inert = index < layers.length - 1;
  });
}

export function openOverlayLayer(layer: HTMLElement) {
  if (!layers.length) {
    savedBody = {
      overflow: document.body.style.overflow,
      paddingRight: document.body.style.paddingRight,
    };
    const scrollbar = window.innerWidth - document.documentElement.clientWidth;
    if (scrollbar > 0)
      document.body.style.paddingRight = `${parseFloat(getComputedStyle(document.body).paddingRight) + scrollbar}px`;
    document.body.style.overflow = "hidden";
  }
  if (!layers.includes(layer)) layers.push(layer);
  sync();
}

export function closeOverlayLayer(layer: HTMLElement) {
  const index = layers.indexOf(layer);
  if (index < 0) return;
  layers.splice(index, 1);
  layer.inert = false;
  if (!layers.length && savedBody) {
    document.body.style.overflow = savedBody.overflow;
    document.body.style.paddingRight = savedBody.paddingRight;
    savedBody = undefined;
  }
  sync();
}
