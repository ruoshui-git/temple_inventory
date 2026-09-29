import type { Meta, StoryObj } from "@storybook/vue3-vite";
import { expect, userEvent } from "storybook/test";
import InventoryRedesign from "./InventoryRedesign.vue";

const meta = {
  title: "Explorations/Inventory Redesign",
  component: InventoryRedesign,
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "Storybook-only exploration. Static fixtures dated 2026-09-29; no Frappe calls. View preferences are isolated per canvas. Navigation and stock actions open labeled previews; scanning accepts fixture codes without activating a camera. Scroll the results to collapse the header and load more fixtures.",
      },
    },
  },
  args: {
    mobile: false,
    initiallyScrolled: false,
    initialPage: "list",
    initialSearch: "",
    initialView: undefined,
  },
} satisfies Meta<typeof InventoryRedesign>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Desktop: Story = {
  globals: { viewport: { value: "desktop", isRotated: false } },
  play: async ({ canvas, step }) => {
    await step(
      "Search and clear restore the complete fixture result",
      async () => {
        const search = canvas.getByRole("searchbox", {
          name: "搜索物品或条码",
        });
        await userEvent.type(search, "ITM-000161");
        await expect(
          canvas.getByText("鼻吸棒 SIGNAL", { exact: true }),
        ).toBeVisible();
        await expect(
          canvas.queryByText("柯达相机", { exact: true }),
        ).not.toBeInTheDocument();
        await expect(
          canvas.queryByLabelText(/跨单位合计/),
        ).not.toBeInTheDocument();
        await userEvent.clear(search);
        await expect(
          canvas.getByText("柯达相机", { exact: true }),
        ).toBeVisible();
      },
    );
    await step("Both inventory views work", async () => {
      await userEvent.click(canvas.getByRole("button", { name: "卡片" }));
      await expect(
        canvas.getByRole("button", { name: "卡片" }),
      ).toHaveAttribute("aria-pressed", "true");
      await expect(canvas.queryByRole("table")).not.toBeInTheDocument();
      await userEvent.click(canvas.getByRole("button", { name: "表格" }));
      await expect(canvas.getByRole("table")).toBeVisible();
    });
    await step("Desktop filters use one left sidebar", async () => {
      await userEvent.click(canvas.getByRole("button", { name: /筛选，/ }));
      await expect(
        canvas.getByRole("complementary", { name: "筛选库存" }),
      ).toBeVisible();
      await userEvent.click(canvas.getByRole("button", { name: "关闭筛选" }));
      await expect(
        canvas.queryByRole("complementary", { name: "筛选库存" }),
      ).not.toBeInTheDocument();
    });
    await step(
      "The hierarchy contains pages, never filter values",
      async () => {
        const navigation = canvas.getByRole("navigation", { name: "主导航" });
        await expect(navigation).toHaveTextContent("库存列表");
        await expect(navigation).toHaveTextContent("效期批次");
        await expect(navigation).not.toHaveTextContent("有库存");
        await expect(navigation).not.toHaveTextContent("已过期及未来30天");
        const inventoryParent = canvas.getByRole("button", { name: "库存" });
        await userEvent.click(inventoryParent);
        await expect(inventoryParent).toHaveAttribute("aria-expanded", "false");
        await expect(
          canvas.queryByRole("button", { name: "库存列表" }),
        ).not.toBeInTheDocument();
        await userEvent.click(inventoryParent);
        await expect(inventoryParent).toHaveAttribute("aria-expanded", "true");
        await expect(
          canvas.getByRole("button", { name: "库存列表" }),
        ).toBeVisible();
      },
    );
    await step("Summary cards show overall and per-unit totals", async () => {
      await expect(canvas.getByText("42,288", { exact: true })).toBeVisible();
      await expect(canvas.getByText("36,567", { exact: true })).toBeVisible();
      await expect(canvas.getByText("4,791", { exact: true })).toBeVisible();
      await expect(canvas.getByText("930", { exact: true })).toBeVisible();
    });
    await step("Quick export is available from the header", async () => {
      await userEvent.click(canvas.getByRole("button", { name: "导出" }));
      await expect(
        canvas.getByRole("heading", { name: "快捷导出" }),
      ).toBeVisible();
      await userEvent.click(canvas.getByRole("button", { name: "关闭预览" }));
    });
    await step("Table headers control sorting", async () => {
      const codeSort = canvas.getByRole("button", {
        name: "按物品编码排序",
      });
      await userEvent.click(codeSort);
      await expect(codeSort.closest("th")).toHaveAttribute(
        "aria-sort",
        "ascending",
      );
      await userEvent.click(codeSort);
      await expect(codeSort.closest("th")).toHaveAttribute(
        "aria-sort",
        "descending",
      );
      const availableSort = canvas.getByRole("button", {
        name: "按可用数量排序",
      });
      await userEvent.click(availableSort);
      await expect(availableSort.closest("th")).toHaveAttribute(
        "aria-sort",
        "descending",
      );
    });
  },
};
export const DesktopCards: Story = {
  name: "Desktop Cards · Responsive Default",
  args: { initialView: "card" },
  globals: { viewport: { value: "wideDesktop", isRotated: false } },
  play: async ({ canvas }) => {
    const grid = canvas.getByRole("list", { name: "库存卡片" });
    await expect(
      getComputedStyle(grid).gridTemplateColumns.split(" "),
    ).toHaveLength(6);
    const productImage = canvas.getByRole("img", { name: "鼻吸棒 SIGNAL" });
    await expect(productImage).toHaveAttribute("loading", "lazy");
    await expect(productImage).toHaveAttribute("decoding", "async");
    await expect(canvas.getAllByText("暂无图片").length).toBeGreaterThan(0);
  },
};
export const DesktopCardsLaptop: Story = {
  name: "Desktop Cards · Responsive Laptop",
  args: { initialView: "card" },
  globals: { viewport: { value: "desktop", isRotated: false } },
};
export const DesktopCardsMissingImage: Story = {
  name: "Desktop Cards · Missing Image and Long Name",
  args: {
    initialView: "card",
    initialSearch: "ITM-000176",
  },
  globals: { viewport: { value: "desktop", isRotated: false } },
  play: async ({ canvas }) => {
    await expect(canvas.getByText("暂无图片", { exact: true })).toBeVisible();
    await expect(
      canvas.getByRole("button", {
        name: "大型法会志愿者工作围裙 Volunteer waterproof kitchen apron",
      }),
    ).toBeVisible();
  },
};
export const DesktopExpiry: Story = {
  name: "Desktop · Expiry Batches",
  args: { initialPage: "expiry" },
  globals: { viewport: { value: "desktop", isRotated: false } },
  play: async ({ canvas, step }) => {
    await step("Attention is the default batch-level filter", async () => {
      await expect(
        canvas.getByRole("heading", { name: "效期批次" }),
      ).toBeVisible();
      await expect(canvas.getByText("需关注", { exact: true })).toBeVisible();
      await expect(
        canvas.getByText("12 个批次", { exact: true }),
      ).toBeVisible();
    });
    await step("Batch search and header sorting work", async () => {
      const search = canvas.getByRole("searchbox", {
        name: "搜索物品、批次或条码",
      });
      await userEvent.type(search, "BAT-");
      await expect(canvas.getByRole("table")).toBeVisible();
      await userEvent.clear(search);
      const expirySort = canvas.getByRole("button", { name: /按效期/ });
      await userEvent.click(expirySort);
      await expect(expirySort.closest("th")).toHaveAttribute(
        "aria-sort",
        "descending",
      );
    });
    await step(
      "Expiry windows are cumulative and exclude expired batches",
      async () => {
        await userEvent.click(canvas.getByRole("button", { name: /筛选，/ }));
        await userEvent.click(canvas.getByRole("radio", { name: "已过期" }));
        await expect(
          canvas.getByText("3 个批次", { exact: true }),
        ).toBeVisible();
        await userEvent.click(canvas.getByRole("radio", { name: "30 天内" }));
        await expect(
          canvas.getByText("9 个批次", { exact: true }),
        ).toBeVisible();
        await userEvent.click(canvas.getByRole("radio", { name: "180 天内" }));
        await expect(
          canvas.getByText("21 个批次", { exact: true }),
        ).toBeVisible();
        await userEvent.click(canvas.getByRole("radio", { name: "无效期" }));
        await expect(
          canvas.getByText("3 个批次", { exact: true }),
        ).toBeVisible();
        await userEvent.click(canvas.getByRole("radio", { name: "需关注" }));
        await userEvent.click(canvas.getByRole("button", { name: "关闭筛选" }));
      },
    );
    await step(
      "Switching pages preserves the inventory hierarchy",
      async () => {
        await userEvent.click(canvas.getByRole("button", { name: "库存列表" }));
        await expect(
          canvas.getByRole("heading", { name: "库存列表" }),
        ).toBeVisible();
        await userEvent.click(
          canvas.getByRole("button", { name: /效期批次 12/ }),
        );
        await expect(
          canvas.getByRole("heading", { name: "效期批次" }),
        ).toBeVisible();
      },
    );
  },
};
export const DesktopExpiryCards: Story = {
  name: "Desktop Expiry · Responsive Cards",
  args: { initialPage: "expiry", initialView: "card" },
  globals: { viewport: { value: "wideDesktop", isRotated: false } },
  play: async ({ canvas }) => {
    const grid = canvas.getByRole("list", { name: "效期批次卡片" });
    await expect(
      getComputedStyle(grid).gridTemplateColumns.split(" "),
    ).toHaveLength(6);
    const productImage = canvas.getAllByRole("img", {
      name: "鼻吸棒 SIGNAL",
    })[0];
    await expect(productImage).toHaveAttribute("loading", "lazy");
    await expect(productImage).toHaveAttribute("decoding", "async");
    await expect(canvas.getByText(/批次 ITM-000161-A/)).toBeVisible();
  },
};
export const DesktopExpiryEmpty: Story = {
  name: "Desktop · Expiry Empty State",
  args: { initialPage: "expiry", initialSearch: "不存在的批次" },
  globals: { viewport: { value: "desktop", isRotated: false } },
};
export const DesktopScrolled: Story = {
  name: "Desktop Scrolled",
  args: { initiallyScrolled: true },
  globals: { viewport: { value: "desktop", isRotated: false } },
};
