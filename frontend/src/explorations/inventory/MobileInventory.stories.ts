import type { Meta, StoryObj } from "@storybook/vue3-vite";
import { expect, userEvent } from "storybook/test";
import MobileInventoryRedesign from "./MobileInventoryRedesign.vue";

const meta = {
  title: "Explorations/Inventory Redesign/Mobile Inventory",
  component: MobileInventoryRedesign,
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "Storybook-only mobile Inventory exploration. Static fixtures, no Frappe calls, routed pages, production preference writes, or camera access.",
      },
    },
  },
  args: {
    initialPage: "inventory",
    initialView: "card",
    initialSummaryKey: "",
    initialExpiryCategory: "all",
    initialActiveFilters: false,
    initiallyScrolled: false,
  },
  globals: { viewport: { value: "mobile", isRotated: false } },
} satisfies Meta<typeof MobileInventoryRedesign>;

export default meta;
type Story = StoryObj<typeof meta>;

export const DefaultCardView: Story = {
  play: async ({ canvas, step }) => {
    await step("Mobile browsing controls remain on one row", async () => {
      const tools = canvas.getByLabelText("浏览工具");
      await expect(tools).toContainElement(
        canvas.getByRole("searchbox", { name: "搜索物品或条码" }),
      );
      await expect(tools).toContainElement(
        canvas.getByRole("button", { name: "扫码" }),
      );
      await expect(tools).toContainElement(
        canvas.getByRole("button", { name: /筛选，/ }),
      );
    });
    await step(
      "Card View is two columns and navigation is complete",
      async () => {
        const grid = canvas.getByRole("list", { name: "库存卡片" });
        await expect(grid).toHaveClass("compact-mobile");
        await expect(
          getComputedStyle(grid).gridTemplateColumns.split(" "),
        ).toHaveLength(2);
        await expect(
          canvas.getByRole("navigation", { name: "移动主导航" }),
        ).toHaveTextContent("库存货物流动盘点调整借用仓库更多");
      },
    );
  },
};

export const SummaryExpanded: Story = {
  args: { initialSummaryKey: "available" },
  play: async ({ canvas }) => {
    await expect(canvas.getByText("可用数量明细")).toBeVisible();
    await expect(canvas.getByText("4,791")).toBeVisible();
    await expect(canvas.getByText("36,567")).toBeVisible();
    await expect(canvas.getByText("930")).toBeVisible();
  },
};

export const ActiveFilters: Story = {
  args: { initialActiveFilters: true },
  play: async ({ canvas }) => {
    await expect(canvas.getByLabelText("已选筛选条件")).toBeVisible();
    await expect(canvas.getByText("大殿", { exact: true })).toBeVisible();
    await expect(canvas.getByText("医疗防护", { exact: true })).toBeVisible();
    await expect(
      canvas.getByRole("button", { name: "筛选，3 项已启用" }),
    ).toBeVisible();
    await expect(
      canvas.queryByRole("button", { name: "清除全部" }),
    ).not.toBeInTheDocument();
  },
};

export const ScrolledCardView: Story = {
  args: { initiallyScrolled: true },
  play: async ({ canvas }) => {
    await expect(canvas.getByText("库存列表", { exact: true })).toBeVisible();
    await expect(
      canvas.queryByLabelText("筛选结果汇总"),
    ).not.toBeInTheDocument();
    await expect(canvas.getByRole("list", { name: "库存卡片" })).toBeVisible();
  },
};

export const DefaultListView: Story = {
  args: { initialView: "list" },
  play: async ({ canvas }) => {
    await expect(
      canvas.getByRole("list", { name: "库存列表视图" }),
    ).toBeVisible();
    await expect(
      canvas.queryByRole("list", { name: "库存卡片" }),
    ).not.toBeInTheDocument();
    await userEvent.click(canvas.getByRole("button", { name: "卡片" }));
    await expect(canvas.getByRole("list", { name: "库存卡片" })).toBeVisible();
  },
};

export const ScrolledListView: Story = {
  args: { initialView: "list", initiallyScrolled: true },
  play: async ({ canvas }) => {
    await expect(
      canvas.getByRole("list", { name: "库存列表视图" }),
    ).toBeVisible();
    await expect(
      canvas.queryByLabelText("筛选结果汇总"),
    ).not.toBeInTheDocument();
  },
};
