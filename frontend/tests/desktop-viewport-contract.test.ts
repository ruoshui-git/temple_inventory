import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineComponent } from "vue";
import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import ApplicationShellDesktopView from "../src/features/shell/ApplicationShellDesktopView.vue";

const shellSource = readFileSync(
  resolve(process.cwd(), "src/components/ApplicationShell.vue"),
  "utf8",
).replace(/\s+/g, " ");
const desktopSource = readFileSync(
  resolve(process.cwd(), "src/features/shell/ApplicationShellDesktopView.vue"),
  "utf8",
).replace(/\s+/g, " ");
const globalStyleSource = readFileSync(
  resolve(process.cwd(), "src/style.css"),
  "utf8",
).replace(/\s+/g, " ");

const RouterLink = defineComponent({
  props: ["to", "ariaCurrent"],
  template:
    '<a :href="typeof to === \'string\' ? to : to.path" :aria-current="ariaCurrent"><slot /></a>',
});

const destinations = [
  { key: "inventory", label: "库存", path: "/" },
  { key: "movements", label: "货物流动", path: "/movements" },
  { key: "loans", label: "借用", path: "/loans" },
  { key: "warehouses", label: "仓库", path: "/warehouses" },
  { key: "more", label: "更多", path: "/more" },
] as const;

describe("desktop shell presentation contract", () => {
  it("keeps shell viewport ownership and sidebar cascade protection in their owning views", () => {
    expect(shellSource).toContain("<style scoped>");
    expect(shellSource).toMatch(
      /\.application-shell \{[^}]*display: grid;[^}]*grid-template-columns: 156px minmax\(0, 1fr\);[^}]*height: 100dvh;[^}]*overflow: hidden;/,
    );
    expect(desktopSource).toContain("<style scoped>");
    expect(desktopSource).toMatch(
      /\.desktop-nav \{[^}]*align-items: stretch;[^}]*height: 100%;[^}]*min-height: 0;/,
    );
    expect(desktopSource).toMatch(
      /\.desktop-module-navigation \{[^}]*display: grid;[^}]*flex: 1;[^}]*min-height: 0;[^}]*overflow-x: hidden;[^}]*overflow-y: auto;/,
    );
  });

  it("keeps desktop filters inside the viewport-owned rail and mobile drawers inside the viewport", () => {
    expect(globalStyleSource).toMatch(
      /\.viewport-list-root\s*\{[^}]*height:\s*calc\(100dvh[^}]*min-height:\s*0;[^}]*overflow:\s*hidden;?/,
    );
    expect(globalStyleSource).toMatch(
      /\.desktop-list-layout>\.filter-sidebar\s*\{[^}]*height:\s*100%;[^}]*max-height:\s*100%;[^}]*min-height:\s*0;[^}]*overflow-x:\s*hidden;[^}]*overflow-y:\s*auto;/,
    );
    expect(globalStyleSource).toMatch(
      /\.filter-drawer\s*\{[^}]*position:\s*fixed;[^}]*height:\s*100dvh;[^}]*max-height:\s*100dvh;[^}]*overflow-x:\s*hidden;[^}]*overflow-y:\s*auto;/,
    );
    expect(globalStyleSource).toMatch(
      /\.shell-content:has\(> \.inventory-desktop-page\)[\s\S]*?padding-bottom:0;[\s\S]*?overflow:hidden;/,
    );
    expect(globalStyleSource).toMatch(
      /@media\(min-width:1024px\)[\s\S]*?html:has\(\.application-shell\),[\s\S]*?body:has\(\.application-shell\),[\s\S]*?#app:has\(\.application-shell\)\{[\s\S]*?height:100%;[\s\S]*?overflow:hidden;/,
    );
  });

  it("mounts an independently scrollable navigation surface with context links", () => {
    const wrapper = mount(ApplicationShellDesktopView, {
      props: {
        destinations: [...destinations],
        activeDestination: "/",
        inventoryExpanded: true,
        inventoryContextItems: [
          { key: "current", label: "当前库存", path: "/", query: {} },
          { key: "expiry", label: "效期批次", path: "/expiry", query: {} },
        ],
        contextItems: [],
        contextKey: "current",
        pending: 2,
        expiryCount: 3,
        user: "tester",
      },
      global: { stubs: { RouterLink } },
    });

    expect(wrapper.find(".desktop-nav").exists()).toBe(true);
    expect(wrapper.find(".desktop-module-navigation").exists()).toBe(true);
    expect(
      wrapper
        .find(".desktop-module-navigation")
        .findAll(":scope > a, :scope > button"),
    ).toHaveLength(destinations.length);
    expect(wrapper.findAll(".desktop-inventory-context a")).toHaveLength(2);
    expect(wrapper.find(".shell-actions").text()).toContain("tester");
  });
});
