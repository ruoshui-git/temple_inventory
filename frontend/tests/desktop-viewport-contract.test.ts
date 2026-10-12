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
const mobileShellSource = readFileSync(
  resolve(process.cwd(), "src/features/shell/ApplicationShellMobileView.vue"),
  "utf8",
).replace(/\s+/g, " ");
const dashboardSource = readFileSync(
  resolve(process.cwd(), "src/features/dashboard/DashboardView.vue"),
  "utf8",
).replace(/\s+/g, " ");
const tableRendererSource = readFileSync(
  resolve(process.cwd(), "src/components/SortableDataTableDesktopRenderer.vue"),
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
  it("uses a high-contrast selected state for the mobile bottom navigation", () => {
    expect(mobileShellSource).toContain(
      ":aria-current=\"activeDestination === item.path ? 'page' : undefined\"",
    );
    expect(globalStyleSource).toContain(
      '.mobile-nav a[aria-current="page"] { background: var(--ti-accent-strong); color: var(--ti-surface); font-weight: 800; }',
    );
    expect(globalStyleSource).toContain(
      '.mobile-nav a[aria-current="page"]:focus-visible { outline: 3px solid var(--ti-accent); outline-offset: 2px; }',
    );
  });

  it("keeps shell viewport ownership and sidebar cascade protection in their owning views", () => {
    expect(shellSource).not.toContain("expiry-count");
    expect(desktopSource).not.toContain("expiryCount");
    expect(shellSource).toContain("<style scoped>");
    expect(shellSource).toMatch(
      /\.application-shell \{[^}]*display: grid;[^}]*grid-template-columns: 156px minmax\(0, 1fr\);[^}]*height: 100dvh;[^}]*overflow: hidden;/,
    );
    expect(shellSource).toMatch(
      /\.shell-content \{[^}]*overflow-x: hidden;[^}]*overflow-y: auto;/,
    );
    expect(shellSource).toMatch(
      /\.shell-content:has\(> \.viewport-list-root\)[\s\S]*?overflow: hidden;/,
    );
    expect(shellSource).toMatch(
      /\.shell-content:has\(> \.dashboard-page\)[\s\S]*?overflow: hidden;/,
    );
    expect(dashboardSource).toContain("new ResizeObserver(");
    expect(dashboardSource).toMatch(/contentWidth\.value\s*>=\s*760/);
    expect(dashboardSource).toMatch(
      /\.distribution-row\s*\{[^}]*grid-template-columns: minmax\(0, 1fr\) auto;[^}]*grid-template-rows: auto 18px;/,
    );
    expect(dashboardSource).toMatch(
      /\.distribution-row > div\s*\{[^}]*grid-column: 1 \/ -1;[^}]*grid-row: 2;/,
    );
    expect(dashboardSource).toMatch(
      /\.dashboard-content \{[^}]*overflow: auto;/,
    );
    expect(dashboardSource).toContain(
      'content.closest<HTMLElement>(".shell-content")',
    );
    expect(globalStyleSource).toMatch(
      /\.shell-content:has\(> \.dashboard-page\)\s*\{[^}]*height:\s*100dvh;[^}]*overflow-y:\s*auto;[^}]*padding-bottom:\s*calc\(var\(--mobile-nav-height\) \+ 82px\)/,
    );
    expect(dashboardSource).toMatch(
      /dashboard-content \{[^}]*padding: var\(--ti-density-page\) var\(--ti-density-page\) 82px;/,
    );
    expect(tableRendererSource).toMatch(
      /\.sortable-data-table-desktop th,[\s\S]*?position: sticky;[\s\S]*?background: var\(--ti-surface\);/,
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
      /\.desktop-list-layout\s*>\s*\.filter-sidebar\s*\{[^}]*height:\s*100%;[^}]*max-height:\s*100%;[^}]*min-height:\s*0;[^}]*overflow-x:\s*hidden;[^}]*overflow-y:\s*auto;/,
    );
    expect(globalStyleSource).toMatch(
      /\.filter-drawer\s*\{[^}]*position:\s*fixed;[^}]*height:\s*100dvh;[^}]*max-height:\s*100dvh;[^}]*overflow-x:\s*hidden;[^}]*overflow-y:\s*auto;/,
    );
    expect(globalStyleSource).toMatch(
      /\.shell-content:has\(> \.inventory-desktop-page\)[\s\S]*?padding-bottom:\s*0;[\s\S]*?overflow:\s*hidden;/,
    );
    expect(globalStyleSource).toMatch(
      /@media\s*\(min-width:\s*1024px\)[\s\S]*?html:has\(\.application-shell\),[\s\S]*?body:has\(\.application-shell\),[\s\S]*?#app:has\(\.application-shell\)\s*\{[\s\S]*?height:\s*100%;[\s\S]*?overflow:\s*hidden;/,
    );
  });

  it("mounts an independently scrollable navigation surface with context links", async () => {
    const wrapper = mount(ApplicationShellDesktopView, {
      props: {
        destinations: [...destinations],
        activeDestination: "/",
        expandedSection: "inventory",
        inventoryContextItems: [
          { key: "current", label: "当前库存", path: "/", query: {} },
          { key: "expiry", label: "效期批次", path: "/expiry", query: {} },
        ],
        contextItems: [],
        contextKey: "current",
        pending: 2,
        user: "tester",
      },
      global: { stubs: { RouterLink } },
    });

    expect(wrapper.find(".desktop-nav").exists()).toBe(true);
    expect(wrapper.find(".desktop-module-navigation").exists()).toBe(true);
    const expiryLink = wrapper
      .findAll(".desktop-inventory-context a")
      .find((link) => link.text() === "效期批次");
    expect(expiryLink).toBeDefined();
    expect(expiryLink!.find(".nav-badge").exists()).toBe(false);
    expect(
      wrapper
        .find(".desktop-module-navigation")
        .findAll(":scope > a, :scope > button"),
    ).toHaveLength(destinations.length);
    expect(wrapper.findAll(".desktop-inventory-context a")).toHaveLength(2);
    expect(wrapper.find(".shell-actions").text()).toContain("tester");
    await wrapper.setProps({ expandedSection: "more" });
    const moreButton = wrapper
      .findAll("button.module-parent")
      .find((button) => button.text().includes("更多"));
    expect(moreButton!.find(".nav-badge").text()).toBe("2");
  });
});
