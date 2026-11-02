// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { closeOverlayLayer, openOverlayLayer } from "../src/lib/overlayLayers";

afterEach(() => {
  document.body.innerHTML = "";
  document.body.removeAttribute("style");
});

function layer() {
  const element = document.createElement("div");
  element.className = "ui-overlay";
  document.body.append(element);
  return element;
}

describe("overlay layers", () => {
  it("releases the app and body scroll when a sheet closes after the dialog it opened", () => {
    const app = document.createElement("div");
    app.setAttribute("data-inventory-app", "");
    document.body.append(app);
    const sheet = layer();
    openOverlayLayer(sheet);
    const dialog = layer();
    openOverlayLayer(dialog);
    expect(app.inert).toBe(true);
    expect(sheet.inert).toBe(true);
    expect(dialog.inert).toBe(false);

    closeOverlayLayer(sheet);
    expect(app.inert).toBe(true);
    expect(dialog.inert).toBe(false);
    expect(document.body.style.overflow).toBe("hidden");

    closeOverlayLayer(dialog);
    expect(app.inert).toBe(false);
    expect(document.body.style.overflow).toBe("");
  });
});
