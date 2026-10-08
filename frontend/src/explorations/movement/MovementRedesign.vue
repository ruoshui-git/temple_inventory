<script setup lang="ts">
import { computed, ref } from "vue";

type Mode = "items" | "records";
type Kind =
	| "Receive"
	| "Issue"
	| "Transfer"
	| "Loan"
	| "Return"
	| "Damage"
	| "Loss"
	| "Repair"
	| "Disposal"
	| "Reconcile";
const props = withDefaults(
	defineProps<{
		mode?: Mode;
		initiallyScrolled?: boolean;
		initialFilterOpen?: boolean;
		initialMoreOpen?: boolean;
	}>(),
	{
		mode: "items",
		initiallyScrolled: false,
		initialFilterOpen: true,
		initialMoreOpen: false,
	},
);
const mode = ref<Mode>(props.mode);
const compact = ref(props.initiallyScrolled);
const filterOpen = ref(props.initialFilterOpen);
const moreOpen = ref(props.initialMoreOpen);
const search = ref("");
const selectedKinds = ref<Kind[]>([]);
const kinds: Array<{ key: Kind; label: string; icon: string; count: number }> = [
	{ key: "Receive", label: "入库", icon: "↓", count: 12 },
	{ key: "Issue", label: "出库", icon: "↑", count: 8 },
	{ key: "Transfer", label: "转移", icon: "⇄", count: 6 },
	{ key: "Loan", label: "借出", icon: "↗", count: 7 },
	{ key: "Return", label: "归还", icon: "↙", count: 4 },
	{ key: "Damage", label: "损坏", icon: "⚠", count: 2 },
	{ key: "Loss", label: "遗失", icon: "−", count: 1 },
	{ key: "Repair", label: "修复", icon: "✦", count: 1 },
	{ key: "Disposal", label: "报废", icon: "×", count: 2 },
	{ key: "Reconcile", label: "库存调整", icon: "±", count: 3 },
];
const itemRows = [
	[
		"09-28",
		"白砂糖 50磅袋",
		"ITM-000004",
		"入库",
		"+5 Nos",
		"—",
		"A02 / 货架1",
		"REC-000123",
		"王喆媛捐赠",
	],
	[
		"09-28",
		"Bella Marie 小红鞋",
		"ITM-000081",
		"转移",
		"2 Nos",
		"A04",
		"C02",
		"TRF-000081",
		"演出前整理",
	],
	["09-27", "一次性口罩", "ITM-000047", "出库", "−4 包", "C02", "—", "ISS-000047", "分发活动"],
];
const recordRows = [
	["09-28", "REC-000123", "入库", "8 项", "43 Nos", "— → A02 / 货架1", "中秋活动", "王喆媛捐赠"],
	["09-28", "TRF-000081", "转移", "3 项", "12 Nos", "A04 → C02", "演出", "演出服整理"],
];
const rows = computed(() => (mode.value === "items" ? itemRows : recordRows));
function toggle(kind: Kind) {
	selectedKinds.value = selectedKinds.value.includes(kind)
		? selectedKinds.value.filter((value) => value !== kind)
		: [...selectedKinds.value, kind];
}
</script>

<template>
	<main class="movement-exploration" :class="{ compact }">
		<aside v-if="filterOpen" class="movement-exploration-filter" aria-label="筛选">
			<h2>筛选</h2>
			<label
				>物品类别<select>
					<option>全部类别</option>
					<option>厨房用品</option>
				</select></label
			>
			<label v-if="mode === 'items'">物品<input placeholder="搜索物品名称或编码" /></label>
			<label
				>来源位置<select>
					<option>全部来源位置</option>
					<option>A04</option>
				</select></label
			>
			<label
				>去向位置<select>
					<option>全部去向位置</option>
					<option>C02</option>
				</select></label
			>
			<label>活动<input placeholder="搜索活动标题" /></label>
			<button type="button">清除全部</button>
		</aside>
		<section class="movement-exploration-content">
			<header>
				<div>
					<h1>
						{{
							compact
								? "货物流动"
								: `货物流动 · ${mode === "items" ? "明细" : "记录"}`
						}}
					</h1>
					<small>2026-09-01 至 2026-09-30</small>
				</div>
				<div class="movement-exploration-period">
					<button type="button">本周</button
					><button type="button" class="active">本月</button
					><button type="button">本年</button><button type="button">自定义</button>
					<div class="exploration-more">
						<button
							type="button"
							aria-haspopup="menu"
							:aria-expanded="moreOpen"
							@click="moreOpen = !moreOpen"
						>
							{{ moreOpen ? "更多" : "更多" }} ▾
						</button>
						<div v-if="moreOpen" role="menu" aria-label="滚动时间范围">
							<button type="button" role="menuitem">近7天</button
							><button type="button" role="menuitem">近30天</button
							><button type="button" role="menuitem">近90天</button
							><button type="button" role="menuitem">近365天</button>
						</div>
					</div>
				</div>
			</header>
			<div class="movement-exploration-toolbar">
				<b class="compact-exploration-identity"
					>货物流动 · {{ mode === "items" ? "明细" : "记录" }}</b
				><label class="exploration-search"
					><span aria-hidden="true">⌕</span
					><input
						v-model="search"
						type="search"
						placeholder="搜索物品名称、编码或记录编号…"
						aria-label="搜索货物流动" /></label
				><button type="button" class="toolbar-action" @click="filterOpen = !filterOpen">
					筛选</button
				><button type="button" class="toolbar-action">导出</button
				><button v-if="mode === 'records'" type="button" class="toolbar-action primary">
					＋ 新增记录
				</button>
			</div>
			<div class="movement-exploration-chips" role="toolbar" aria-label="动作筛选">
				<button
					type="button"
					:aria-pressed="!selectedKinds.length"
					@click="selectedKinds = []"
				>
					全部 <span>42</span></button
				><button
					v-for="kind in kinds"
					:key="kind.key"
					type="button"
					:data-kind="kind.key"
					:aria-pressed="selectedKinds.includes(kind.key)"
					@click="toggle(kind.key)"
				>
					<b aria-hidden="true">{{ kind.icon }}</b
					>{{ kind.label }} <span>{{ kind.count }}</span>
				</button>
			</div>
			<table>
				<thead>
					<tr>
						<th
							v-for="heading in mode === 'items'
								? ['日期', '物品', '动作', '数量', '从', '到', '关联记录', '备注']
								: [
										'日期',
										'记录编号',
										'类型',
										'物品行数',
										'数量',
										'流向',
										'活动',
										'备注',
									]"
							:key="heading"
						>
							{{ heading }}
						</th>
					</tr>
				</thead>
				<tbody>
					<tr v-for="row in rows" :key="row[1]">
						<td v-for="(value, index) in row" :key="index">{{ value }}</td>
					</tr>
				</tbody>
			</table>
		</section>
	</main>
</template>

<style scoped>
.movement-exploration {
	display: grid;
	grid-template-columns: 250px minmax(0, 1fr);
	min-height: 760px;
	background: #f8f7f4;
	color: #343c46;
}
.movement-exploration-filter {
	padding: 18px 14px;
	border-right: 1px solid #e4ded5;
	background: #fbfaf7;
}
.movement-exploration-filter h2 {
	margin: 0 0 16px;
}
.movement-exploration-filter label {
	display: grid;
	gap: 5px;
	margin: 0 0 13px;
	color: #5e6268;
	font-size: 13px;
}
.movement-exploration-filter input,
.movement-exploration-filter select {
	margin: 0;
	padding: 9px;
	border-radius: 6px;
}
.movement-exploration-content {
	min-width: 0;
	padding: 16px;
}
.movement-exploration header,
.movement-exploration-toolbar,
.movement-exploration-period,
.movement-exploration-chips,
.movement-exploration-actions {
	display: flex;
	align-items: center;
	gap: 7px;
	flex-wrap: wrap;
}
.movement-exploration header {
	justify-content: space-between;
}
.movement-exploration h1 {
	margin: 0;
	font-size: 25px;
}
.movement-exploration small {
	color: #7b8087;
}
.movement-exploration-actions {
	margin-left: auto;
}
.movement-exploration-toolbar {
	display: flex;
	align-items: center;
	gap: 7px;
	flex-wrap: wrap;
	margin-top: 10px;
}
.exploration-search {
	display: flex;
	align-items: center;
	flex: 1;
	min-width: 180px;
	height: 36px;
	gap: 7px;
	padding: 0 10px;
	border: 1px solid #e0e2e4;
	border-radius: 6px;
	background: #fff;
	color: #7b8492;
}
.exploration-search input {
	width: 100%;
	min-width: 0;
	height: 100%;
	margin: 0;
	padding: 0;
	border: 0;
	outline: 0;
	background: transparent;
	box-shadow: none;
}
.compact-exploration-identity {
	display: none;
	font-size: 17px;
	white-space: nowrap;
}
.movement-exploration-period {
	display: flex;
	align-items: center;
	gap: 7px;
	flex-wrap: wrap;
}
.movement-exploration button {
	min-height: 34px;
	padding: 6px 10px;
	border-radius: 6px;
}
.movement-exploration button[aria-pressed="true"],
.movement-exploration button.active {
	background: #9b571d;
	color: #fff;
}
.exploration-more {
	position: relative;
}
.exploration-more > div {
	position: absolute;
	top: calc(100% + 4px);
	right: 0;
	z-index: 3;
	display: grid;
	min-width: 120px;
	padding: 5px;
	background: #fff;
	border: 1px solid #eadfce;
	box-shadow: 0 8px 20px #412c161f;
}
.exploration-more > div button {
	text-align: left;
	border: 0;
}
.movement-exploration-chips {
	display: flex;
	gap: 7px;
	flex-wrap: nowrap;
	overflow: auto;
	margin: 10px 0;
}
.movement-exploration-chips button {
	flex: none;
	border-radius: 999px;
}
.movement-exploration-chips b {
	margin-right: 4px;
}
.movement-exploration table {
	width: 100%;
	border-collapse: collapse;
	background: #fff;
}
.movement-exploration th,
.movement-exploration td {
	padding: 10px;
	border-bottom: 1px solid #f0f0ed;
	text-align: left;
	white-space: nowrap;
}
.movement-exploration th {
	background: #f2f2f0;
	color: #7a7d84;
	font-size: 12px;
}
.compact .movement-exploration-content {
	padding-top: 9px;
}
.compact .movement-exploration h1 {
	font-size: 17px;
}
.compact .movement-exploration header > div:first-child {
	display: none;
}
.compact .compact-exploration-identity {
	display: block;
}
@media (max-width: 1023px) {
	.movement-exploration {
		display: block;
		min-height: 0;
	}
	.movement-exploration-filter {
		display: none;
	}
	.movement-exploration-content {
		padding: 14px;
	}
	.movement-exploration table {
		display: none;
	}
	.movement-exploration-content:after {
		content: "移动端以卡片显示同一组数据";
		display: block;
		margin-top: 10px;
		padding: 16px;
		border-radius: 10px;
		background: #fff;
		color: #6b6257;
	}
}
</style>
