<script setup lang="ts">
import ResponsiveFilterPanel from "../../components/ResponsiveFilterPanel.vue";
import WarehouseSelector from "../../components/WarehouseSelector.vue";
import CategorySelector from "../../components/CategorySelector.vue";
import UiButton from "../../components/UiButton.vue";
import type { DashboardController } from "./useDashboardController";

const props = defineProps<{ controller: DashboardController }>();
const c = props.controller;
const fmt = (value: number) =>
	new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 }).format(Number(value || 0));
const generatedAt = (value?: string) => {
	if (!value) return "";
	const parsed = new Date(value.replace(" ", "T"));
	return Number.isNaN(parsed.getTime())
		? value
		: new Intl.DateTimeFormat("zh-CN", {
				month: "numeric",
				day: "numeric",
				hour: "2-digit",
				minute: "2-digit",
			}).format(parsed);
};
const quantities = (summary: any) =>
	(summary?.by_uom || []).map((row: any) => `${fmt(row.qty)} ${row.uom}`).join(" · ") || "—";
const movementQuery = (kind?: string) => ({
	path: "/movements/records",
	query: {
		warehouses: c.filters.value.warehouses,
		item_groups: c.filters.value.item_groups,
		period: c.movementPeriod.value,
		...(kind ? { kind } : {}),
	},
});
const expiryQuery = (bucket: any) => {
	const ranges: Record<string, [string, string]> = {
		expired_1_30: ["-30", "-1"],
		expired_31_90: ["-90", "-31"],
		expired_over_90: ["-3650", "-91"],
		upcoming_0_30: ["0", "30"],
		upcoming_31_90: ["31", "90"],
		upcoming_over_90: ["91", "3650"],
	};
	const [from, to] = ranges[bucket.key] || ["-30", "30"];
	const expiryRange =
		bucket.key === "expired_over_90"
			? { expiry_window: "overdue_beyond", expiry_days: "90" }
			: bucket.key === "upcoming_over_90"
				? { expiry_window: "remaining_beyond", expiry_days: "90" }
				: {
						expiry_window: "custom",
						expiry_from_days: from,
						expiry_to_days: to,
					};
	return {
		path: "/expiry",
		query: {
			warehouses: c.filters.value.warehouses,
			item_groups: c.filters.value.item_groups,
			...expiryRange,
		},
	};
};
const stockQuery = () => ({
	path: "/stock",
	query: { warehouses: c.filters.value.warehouses, item_groups: c.filters.value.item_groups },
});
const loanQuery = () => ({
	path: "/loans",
	query: { warehouses: c.filters.value.warehouses, item_groups: c.filters.value.item_groups },
});
const previewQuery = () =>
	c.expiryPreview.value === "expired"
		? {
				path: "/expiry",
				query: {
					warehouses: c.filters.value.warehouses,
					item_groups: c.filters.value.item_groups,
					expiry_window: "overdue",
				},
			}
		: expiryQuery({ key: "upcoming_0_30" });
const reminderQuery = (reminder: any) =>
	reminder.kind === "damaged"
		? {
				path: "/pending",
				query: {
					warehouses: c.filters.value.warehouses,
					item_groups: c.filters.value.item_groups,
				},
			}
		: reminder.kind === "expired"
			? {
					path: "/expiry",
					query: {
						warehouses: c.filters.value.warehouses,
						item_groups: c.filters.value.item_groups,
						expiry_window: "overdue",
					},
				}
			: expiryQuery({ key: reminder.kind });
const distributionQuery = (bar: any) => ({
	path: "/stock",
	query: {
		warehouses:
			c.distributionMode.value === "warehouse" ? [bar.key] : c.filters.value.warehouses,
		item_groups:
			c.distributionMode.value === "category" ? [bar.key] : c.filters.value.item_groups,
	},
});
const loanContext = (row: any) =>
	row.activity_title || row.activity || row.purpose || "无相关活动或用途";
const loanLocations = (row: any) =>
	[
		...new Set<string>(
			(row.items || []).map((item: any) => item.original_warehouse).filter(Boolean),
		),
	].join("、");
const selectorWarehouses = () =>
	c.warehouseRows.value.map((row: any) => ({
		...row,
		warehouse_name: row.local_label || row.warehouse_name || row.name,
	}));
const selectorCategories = () =>
	c.categoryRows.value.map((row: any) => ({
		...row,
		item_group_name: row.item_group_name || row.name,
	}));
</script>

<template>
	<div class="dashboard-page">
		<ResponsiveFilterPanel
			v-if="c.surface.value === 'mobile'"
			v-model:open="c.filterOpen.value"
			:count="c.activeFilterCount.value"
			title="首页筛选"
			clearable
			:show-trigger="false"
			@clear="c.clearFilters"
		>
			<section class="dashboard-filter-section">
				<h3>仓库 / 位置</h3>
				<WarehouseSelector
					:model-value="c.filters.value.warehouses"
					:rows="selectorWarehouses()"
					title="仓库 / 位置"
					placeholder="搜索仓库或位置"
					embedded
					@update:model-value="
						c.updateFilters({
							warehouses: $event,
							item_groups: c.filters.value.item_groups,
						})
					"
				/>
			</section>
			<section class="dashboard-filter-section">
				<h3>物品类别</h3>
				<CategorySelector
					:model-value="c.filters.value.item_groups"
					:rows="selectorCategories()"
					title="物品类别"
					placeholder="搜索物品类别"
					embedded
					@update:model-value="
						c.updateFilters({
							warehouses: c.filters.value.warehouses,
							item_groups: $event,
						})
					"
				/>
			</section>
		</ResponsiveFilterPanel>
		<aside v-if="c.desktopFilterOpen.value" class="dashboard-desktop-filter">
			<section class="dashboard-filter-section">
				<h3>仓库 / 位置</h3>
				<WarehouseSelector
					:model-value="c.filters.value.warehouses"
					:rows="selectorWarehouses()"
					title="仓库 / 位置"
					placeholder="搜索仓库或位置"
					embedded
					@update:model-value="
						c.updateFilters({
							warehouses: $event,
							item_groups: c.filters.value.item_groups,
						})
					"
				/>
			</section>
			<section class="dashboard-filter-section">
				<h3>物品类别</h3>
				<CategorySelector
					:model-value="c.filters.value.item_groups"
					:rows="selectorCategories()"
					title="物品类别"
					placeholder="搜索物品类别"
					embedded
					@update:model-value="
						c.updateFilters({
							warehouses: c.filters.value.warehouses,
							item_groups: $event,
						})
					"
				/>
			</section>
			<button class="clear-all-filters" type="button" @click="c.clearFilters">
				恢复默认筛选
			</button>
		</aside>
		<main class="dashboard-content">
			<header class="dashboard-header">
				<div>
					<p class="eyebrow">寺院物资</p>
					<h1>物资总览</h1>
					<p class="dashboard-scope">{{ c.activeScopeLabel.value }}</p>
				</div>
				<div class="dashboard-header-actions">
					<span v-if="c.data.value?.generated_at"
						>最后更新：{{ generatedAt(c.data.value.generated_at) }}</span
					>
					<span v-if="c.refreshing.value" aria-live="polite">正在更新…</span
					><UiButton variant="ghost" size="compact" @click="c.refresh">↻ 刷新</UiButton
					><button
						class="dashboard-filter-trigger"
						type="button"
						@click="
							c.surface.value === 'desktop'
								? (c.desktopFilterOpen.value = !c.desktopFilterOpen.value)
								: (c.filterOpen.value = true)
						"
					>
						筛选<span v-if="c.activeFilterCount.value" class="filter-count">{{
							c.activeFilterCount.value
						}}</span>
					</button>
				</div>
			</header>
			<div
				v-if="c.activeFilterCount.value"
				class="dashboard-active-filters"
				aria-label="当前筛选"
			>
				<button
					v-for="value in c.filters.value.warehouses"
					:key="`warehouse-${value}`"
					type="button"
					@click="
						c.updateFilters({
							warehouses: c.filters.value.warehouses.filter(
								(item) => item !== value,
							),
							item_groups: c.filters.value.item_groups,
						})
					"
				>
					位置：{{
						c.warehouseRows.value.find((row: any) => row.name === value)
							?.local_label || value
					}}
					×
				</button>
				<button
					v-for="value in c.filters.value.item_groups"
					:key="`group-${value}`"
					type="button"
					@click="
						c.updateFilters({
							warehouses: c.filters.value.warehouses,
							item_groups: c.filters.value.item_groups.filter(
								(item) => item !== value,
							),
						})
					"
				>
					类别：{{
						c.categoryRows.value.find((row: any) => row.name === value)
							?.item_group_name || value
					}}
					×
				</button>
				<button type="button" class="clear-filter-chip" @click="c.clearFilters">
					清空
				</button>
			</div>
			<p v-if="c.error.value" class="dashboard-error" role="alert">
				{{ c.error.value }} <button type="button" @click="c.refresh">重试</button>
			</p>
			<div v-if="c.loading.value" class="dashboard-loading" aria-live="polite">
				正在加载物资总览…
			</div>
			<template v-else>
				<section class="dashboard-section">
					<div class="section-heading">
						<h2>库存概览</h2>
						<RouterLink :to="stockQuery()">查看库存 ›</RouterLink>
					</div>
					<div class="metric-grid">
						<RouterLink
							v-for="metric in [
								{ key: 'available_stock', label: '可用库存', tone: 'healthy' },
								{ key: 'total_stock', label: '库存总计', tone: 'neutral' },
								{ key: 'on_loan_qty', label: '借出', tone: 'borrowed' },
								{ key: 'damaged_qty', label: '损坏', tone: 'danger' },
							]"
							:key="metric.key"
							class="metric-card"
							:class="metric.tone"
							:to="stockQuery()"
							><span>{{ metric.label }}</span
							><strong>{{
								fmt(c.data.value.inventory?.totals?.[metric.key]?.unitless_total)
							}}</strong
							><small>{{
								quantities(c.data.value.inventory?.totals?.[metric.key])
							}}</small></RouterLink
						>
					</div>
				</section>
				<section class="dashboard-section">
					<div class="section-heading">
						<h2>效期概览</h2>
						<RouterLink to="/expiry">查看全部 ›</RouterLink>
					</div>
					<div class="expiry-grid">
						<RouterLink
							v-for="bucket in c.expiryBuckets.value"
							:key="bucket.label"
							class="expiry-card"
							:class="bucket.label.includes('已过期') ? 'expired' : 'upcoming'"
							:to="expiryQuery(bucket)"
							><span>{{ bucket.label }}</span
							><strong>{{ bucket.count }}</strong
							><small>个批次</small></RouterLink
						>
					</div>
					<div class="preview-toolbar">
						<h3>效期批次预览</h3>
						<div class="segmented">
							<button
								:class="{ active: c.expiryPreview.value === 'expired' }"
								@click="c.expiryPreview.value = 'expired'"
							>
								已过期</button
							><button
								:class="{ active: c.expiryPreview.value === 'upcoming' }"
								@click="c.expiryPreview.value = 'upcoming'"
							>
								即将过期
							</button>
						</div>
					</div>
					<div class="dashboard-list">
						<RouterLink
							v-for="row in c.data.value.expiry?.preview || []"
							:key="row.batch_no"
							:to="previewQuery()"
							class="dashboard-list-row"
							><span
								><b>{{ row.item_name || row.item_code }}</b
								><small>{{ row.batch_no }} · {{ row.expiry_date }}</small></span
							><strong
								>{{ fmt(row.total_qty) }} {{ row.stock_uom }}</strong
							></RouterLink
						>
						<p v-if="!(c.data.value.expiry?.preview || []).length" class="empty-state">
							当前范围没有需要关注的批次
						</p>
					</div>
				</section>
				<section class="dashboard-section">
					<div class="section-heading">
						<h2>货物流动概览</h2>
						<div class="movement-heading-actions">
							<div class="segmented">
								<button
									:class="{ active: c.movementPeriod.value === 'this_week' }"
									@click="c.movementPeriod.value = 'this_week'"
								>
									本周</button
								><button
									:class="{ active: c.movementPeriod.value === 'this_month' }"
									@click="c.movementPeriod.value = 'this_month'"
								>
									本月</button
								><button
									:class="{ active: c.movementPeriod.value === 'this_year' }"
									@click="c.movementPeriod.value = 'this_year'"
								>
									本年</button
								><button
									:class="{ active: c.movementPeriod.value === 'all' }"
									@click="c.movementPeriod.value = 'all'"
								>
									全部
								</button>
							</div>
							<RouterLink :to="movementQuery()">查看记录 ›</RouterLink>
						</div>
					</div>
					<div class="movement-layout">
						<div class="movement-grid">
							<RouterLink
								v-for="summary in c.movementSummaries.value"
								:key="summary.kind"
								:to="movementQuery(summary.kind)"
								class="movement-card"
								><span>{{ summary.label }}</span
								><strong>{{ fmt(summary.quantity?.unitless_total) }}</strong
								><small>合计数量 · {{ quantities(summary.quantity) }}</small
								><em>{{ summary.record_count }} 条记录</em></RouterLink
							>
						</div>
						<div class="recent-panel">
							<h3>最近记录</h3>
							<RouterLink
								v-for="row in c.data.value.movement?.recent || []"
								:key="row.record_name"
								:to="row.detail_route || '/movements/records'"
								class="dashboard-list-row"
								><span
									><b>{{ row.movement_kind }}</b
									><small
										>{{ row.posting_date }} ·
										{{ row.item_name || row.item_code }}</small
									></span
								><strong
									>{{ fmt(row.stock_qty || row.qty) }}
									{{ row.stock_uom || row.uom }}</strong
								></RouterLink
							>
						</div>
					</div>
				</section>
				<section class="dashboard-section loan-section">
					<div class="section-heading">
						<h2>借出中</h2>
						<RouterLink :to="loanQuery()">查看借用 ›</RouterLink>
					</div>
					<div class="loan-summary">
						<div>
							<span>未归还记录数</span
							><strong>{{ c.data.value.loans?.record_count || 0 }}</strong>
						</div>
						<div>
							<span>尚未归还数量</span
							><strong>{{
								fmt(c.data.value.loans?.quantity?.unitless_total)
							}}</strong
							><small>{{ quantities(c.data.value.loans?.quantity) }}</small>
						</div>
					</div>
					<div class="dashboard-list">
						<RouterLink
							v-for="row in c.data.value.loans?.rows || []"
							:key="row.name"
							:to="`/loans/${encodeURIComponent(row.name)}`"
							class="dashboard-list-row"
							><span
								><b>{{ row.borrower || "未填写借用方" }} · {{ row.status }}</b
								><small
									>{{
										(row.items || [])
											.map((item: any) => item.item_name)
											.slice(0, 2)
											.join("、") || "无物品名称"
									}}
									· {{ loanContext(row) }} ·
									{{ String(row.loan_date || "").slice(0, 10) }} ·
									{{ row.outstanding_lines || 0 }} 项未归还<span
										v-if="loanLocations(row)"
									>
										· {{ loanLocations(row) }}</span
									></small
								></span
							><strong>{{
								quantities({ by_uom: row.outstanding_qty })
							}}</strong></RouterLink
						>
						<p v-if="!(c.data.value.loans?.rows || []).length" class="empty-state">
							当前没有未归还借用
						</p>
					</div>
				</section>
				<section class="dashboard-section">
					<div class="section-heading"><h2>提醒事项</h2></div>
					<div class="reminder-grid">
						<RouterLink
							v-for="reminder in c.data.value.reminders || []"
							:key="reminder.kind"
							:to="reminderQuery(reminder)"
							class="reminder-card"
							:class="reminder.severity"
							><span>{{ reminder.label }}</span
							><strong>{{ reminder.count }}</strong
							><small>查看详情 ›</small></RouterLink
						>
						<p v-if="!(c.data.value.reminders || []).length" class="empty-state">
							暂无需要处理的提醒
						</p>
					</div>
				</section>
				<section class="dashboard-section">
					<div class="section-heading">
						<h2>库存分布</h2>
						<div class="segmented">
							<button
								:class="{ active: c.distributionMode.value === 'warehouse' }"
								@click="c.distributionMode.value = 'warehouse'"
							>
								按仓库</button
							><button
								:class="{ active: c.distributionMode.value === 'category' }"
								@click="c.distributionMode.value = 'category'"
							>
								按类别
							</button>
						</div>
					</div>
					<p class="distribution-note">按当前范围统计去重物品数</p>
					<div class="distribution-list">
						<RouterLink
							v-for="bar in c.data.value.distribution?.bars || []"
							:key="bar.key"
							class="distribution-row"
							:to="distributionQuery(bar)"
						>
							<span>{{ bar.label }}</span>
							<div>
								<i
									:style="{
										width: `${Math.max(4, (bar.distinct_items / Math.max(...(c.data.value.distribution?.bars || [{ distinct_items: 1 }]).map((entry: any) => entry.distinct_items), 1)) * 100)}%`,
									}"
								></i>
							</div>
							<strong>{{ bar.distinct_items }}</strong>
						</RouterLink>
						<p
							v-if="!(c.data.value.distribution?.bars || []).length"
							class="empty-state"
						>
							当前范围没有可展示的分布数据
						</p>
					</div>
				</section>
			</template>
		</main>
	</div>
</template>

<style scoped>
.dashboard-page {
	display: flex;
	min-height: 100%;
	background: #f8f7f4;
	color: #343c46;
}
.dashboard-content {
	flex: 1;
	min-width: 0;
	overflow: auto;
	padding: 30px clamp(18px, 3vw, 48px) 56px;
}
.dashboard-desktop-filter {
	display: none;
	width: 250px;
	flex: none;
	box-sizing: border-box;
	overflow-y: auto;
	padding: 22px 14px;
	border-right: 1px solid #ebe6de;
	background: #f7f5f1;
}
.dashboard-page:has(.dashboard-desktop-filter) .dashboard-desktop-filter {
	display: block;
}
.dashboard-header,
.section-heading,
.preview-toolbar {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 16px;
}
.dashboard-header {
	margin-bottom: 26px;
}
.eyebrow {
	margin: 0;
	color: #946c3f;
	font-size: 13px;
	font-weight: 700;
}
h1 {
	margin: 2px 0 4px;
	font-size: clamp(27px, 3vw, 37px);
}
.dashboard-scope {
	margin: 0;
	color: #7c828b;
	font-size: 14px;
}
.dashboard-header-actions {
	display: flex;
	align-items: center;
	gap: 8px;
	color: #7c828b;
	font-size: 13px;
}
.dashboard-active-filters {
	display: flex;
	flex-wrap: wrap;
	gap: 7px;
	margin: -10px 0 20px;
}
.dashboard-active-filters button {
	padding: 5px 9px;
	border: 1px solid #e6d9c8;
	border-radius: 999px;
	background: #fffaf3;
	color: #81552c;
	font: inherit;
	font-size: 12px;
	cursor: pointer;
}
.dashboard-active-filters .clear-filter-chip {
	border-color: transparent;
	background: transparent;
	color: #2276d2;
}
.dashboard-section {
	margin-bottom: 22px;
	padding: 20px;
	border: 1px solid #e8e1d8;
	border-radius: 16px;
	background: #fffefa;
	box-shadow: 0 8px 24px rgb(91 69 39 / 4%);
}
h2 {
	margin: 0;
	font-size: 20px;
}
h3 {
	margin: 0;
	font-size: 15px;
}
.section-heading a {
	color: #2276d2;
	font-size: 13px;
}
.metric-grid,
.expiry-grid,
.movement-grid,
.reminder-grid {
	display: grid;
	gap: 10px;
	margin-top: 16px;
}
.metric-grid {
	grid-template-columns: repeat(4, minmax(0, 1fr));
}
.expiry-grid {
	grid-template-columns: repeat(6, minmax(0, 1fr));
}
.movement-grid {
	grid-template-columns: repeat(3, minmax(0, 1fr));
}
.metric-card,
.expiry-card,
.movement-card,
.reminder-card {
	display: flex;
	min-width: 0;
	flex-direction: column;
	gap: 5px;
	padding: 15px;
	border: 1px solid #eee8df;
	border-radius: 11px;
	color: inherit;
	text-decoration: none;
	transition:
		transform 0.15s,
		box-shadow 0.15s;
}
.metric-card:hover,
.expiry-card:hover,
.movement-card:hover,
.reminder-card:hover {
	transform: translateY(-1px);
	box-shadow: 0 5px 16px rgb(91 69 39 / 9%);
}
.metric-card span,
.expiry-card span,
.movement-card span,
.reminder-card span {
	color: #6d737c;
	font-size: 13px;
}
.metric-card strong,
.expiry-card strong,
.movement-card strong,
.reminder-card strong {
	font-size: 27px;
	line-height: 1.1;
}
.metric-card small,
.expiry-card small,
.movement-card small,
.reminder-card small {
	color: #777d86;
	font-size: 12px;
}
.metric-card.healthy {
	background: #effaf5;
	color: #087c63;
}
.metric-card.neutral {
	background: #faf8f3;
	color: #805b36;
}
.metric-card.borrowed {
	background: #eef5ff;
	color: #176ccb;
}
.metric-card.danger,
.expired {
	background: #fff2f1;
	color: #d63335;
}
.upcoming {
	background: #fff8ea;
	color: #bc6b0b;
}
.preview-toolbar {
	margin-top: 22px;
}
.segmented {
	display: inline-flex;
	gap: 2px;
	padding: 3px;
	border-radius: 8px;
	background: #f2eee8;
}
.segmented button {
	padding: 6px 10px;
	border: 0;
	border-radius: 6px;
	background: transparent;
	color: #6d737c;
	font: inherit;
	font-size: 12px;
	cursor: pointer;
}
.segmented button.active {
	background: #fff;
	color: #81552c;
	box-shadow: 0 1px 4px rgb(81 57 30 / 12%);
}
.movement-heading-actions {
	display: flex;
	align-items: center;
	gap: 12px;
}
.dashboard-list {
	margin-top: 10px;
	border: 1px solid #eee8df;
	border-radius: 10px;
	overflow: hidden;
}
.dashboard-list-row {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 14px;
	padding: 11px 13px;
	border-bottom: 1px solid #f1ece5;
	color: inherit;
	text-decoration: none;
}
.dashboard-list-row:last-child {
	border-bottom: 0;
}
.dashboard-list-row span {
	min-width: 0;
}
.dashboard-list-row b,
.dashboard-list-row small {
	display: block;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}
.dashboard-list-row small {
	margin-top: 3px;
	color: #7a8088;
	font-size: 12px;
}
.dashboard-list-row strong {
	flex: none;
	font-size: 13px;
}
.movement-layout {
	display: grid;
	grid-template-columns: minmax(0, 1.5fr) minmax(280px, 1fr);
	gap: 16px;
	margin-top: 16px;
}
.recent-panel {
	min-width: 0;
}
.recent-panel h3 {
	margin: 0 0 9px;
}
.movement-card em {
	margin-top: 4px;
	color: #59616d;
	font-size: 12px;
	font-style: normal;
}
.loan-summary {
	display: flex;
	gap: 12px;
	margin-top: 16px;
}
.loan-summary > div {
	flex: 1;
	padding: 15px;
	border-radius: 11px;
	background: #eef5ff;
}
.loan-summary span,
.loan-summary small {
	display: block;
	color: #607188;
	font-size: 13px;
}
.loan-summary strong {
	display: block;
	margin: 5px 0;
	color: #176ccb;
	font-size: 28px;
}
.reminder-grid {
	grid-template-columns: repeat(3, minmax(0, 1fr));
}
.reminder-card.critical {
	background: #fff2f1;
	color: #c63535;
}
.reminder-card.warning {
	background: #fff8ea;
	color: #b96b0b;
}
.distribution-note {
	margin: 10px 0 14px;
	color: #7c828b;
	font-size: 12px;
}
.distribution-row {
	display: grid;
	grid-template-columns: minmax(120px, 180px) 1fr 45px;
	align-items: center;
	gap: 12px;
	margin: 11px 0;
	font-size: 13px;
	color: inherit;
	text-decoration: none;
}
.distribution-row > div {
	height: 12px;
	overflow: hidden;
	border-radius: 10px;
	background: #eee8df;
}
.distribution-row i {
	display: block;
	height: 100%;
	border-radius: inherit;
	background: linear-gradient(90deg, #74a9ee, #59c39f);
}
.distribution-row strong {
	text-align: right;
}
.empty-state {
	margin: 0;
	padding: 18px;
	color: #7c828b;
	text-align: center;
	font-size: 13px;
}
.dashboard-loading {
	padding: 60px 20px;
	color: #7c828b;
	text-align: center;
}
.dashboard-error {
	padding: 12px 15px;
	border-radius: 10px;
	background: #fff2f1;
	color: #b52c2c;
}
.dashboard-error button {
	border: 0;
	background: transparent;
	color: inherit;
	text-decoration: underline;
	cursor: pointer;
}
.dashboard-filter-section {
	margin-bottom: 20px;
}
.dashboard-filter-section h3 {
	margin-bottom: 10px;
}
@media (max-width: 1023px) {
	.dashboard-desktop-filter {
		display: none !important;
	}
	.dashboard-page {
		display: block;
		min-height: calc(100dvh - var(--mobile-nav-height, 0px));
	}
	.dashboard-content {
		overflow: visible;
		padding: 22px 14px calc(78px + var(--mobile-nav-height, 0px));
	}
	.dashboard-header {
		align-items: flex-start;
	}
	.dashboard-header-actions {
		flex-wrap: wrap;
		justify-content: flex-end;
	}
	.dashboard-header-actions > span {
		display: none;
	}
	.dashboard-section {
		padding: 15px;
		border-radius: 13px;
	}
	.metric-grid {
		grid-template-columns: repeat(2, minmax(0, 1fr));
	}
	.expiry-grid {
		grid-template-columns: repeat(2, minmax(0, 1fr));
	}
	.movement-grid,
	.reminder-grid {
		grid-template-columns: repeat(2, minmax(0, 1fr));
	}
	.movement-layout {
		display: block;
	}
	.movement-heading-actions {
		align-items: flex-end;
		flex-direction: column;
		gap: 7px;
	}
	.recent-panel {
		margin-top: 18px;
	}
	.loan-summary {
		flex-direction: column;
	}
	.dashboard-list-row {
		padding: 11px 10px;
	}
}
@media (max-width: 520px) {
	h1 {
		font-size: 27px;
	}
	.dashboard-header {
		display: block;
	}
	.dashboard-header-actions {
		margin-top: 12px;
		justify-content: space-between;
	}
	.movement-grid,
	.reminder-grid {
		grid-template-columns: 1fr;
	}
	.expiry-grid {
		grid-template-columns: repeat(2, minmax(0, 1fr));
	}
	.expiry-card strong {
		font-size: 23px;
	}
}
</style>
