import { userEvent, within } from "storybook/test";
import type { Meta, StoryObj } from "@storybook/vue3-vite";

import DetailPopover from "./DetailPopover.vue";

const meta = {
	title: "Inventory/Detail Popover",
	component: DetailPopover,
	args: {
		label: "库存明细",
		triggerText: "查看明细",
	},
	render: (args) => ({
		components: { DetailPopover },
		setup: () => ({ args }),
		template: `
			<main style="display: grid; min-height: 420px; place-items: center; padding: 48px;">
				<DetailPopover v-bind="args">
					<p>可用库存：20 Nos</p>
					<p>总库存：24 Nos</p>
					<p>借出：3 Nos · 损坏：1 Nos</p>
				</DetailPopover>
			</main>
		`,
	}),
} satisfies Meta<typeof DetailPopover>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const LongContent: Story = {
	render: (args) => ({
		components: { DetailPopover },
		setup: () => ({ args }),
		template: `
			<main style="display: grid; min-height: 520px; place-items: center; padding: 48px;">
				<DetailPopover v-bind="args">
					<h3>ITM-000163 · 饼干烤盘 COOKIE EXCHANGE</h3>
					<p>仓库：一号库房 / 厨房用品储物架</p>
					<p>可用库存：20 Nos</p>
					<p>总库存：24 Nos，其中借出 3 Nos，损坏 1 Nos。</p>
					<p>最近一次入库：2026-09-18，由日常物资整理登记。</p>
					<p>备注：烤盘与烘焙工具放在同一组货架，请归还后放回原位。</p>
				</DetailPopover>
			</main>
		`,
	}),
};

export const Hover: Story = {
	play: async ({ canvasElement }) => {
		const trigger = within(canvasElement).getByRole("button", { name: "库存明细" });
		await userEvent.hover(trigger);
	},
};

export const Focus: Story = {
	play: ({ canvasElement }) => {
		within(canvasElement).getByRole("button", { name: "库存明细" }).focus();
	},
};

export const Pinned: Story = {
	play: async ({ canvasElement }) => {
		await userEvent.click(within(canvasElement).getByRole("button", { name: "库存明细" }));
	},
};