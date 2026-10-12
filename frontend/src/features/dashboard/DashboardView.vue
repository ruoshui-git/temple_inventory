<script setup lang="ts">
import ResponsiveFilterPanel from "../../components/ResponsiveFilterPanel.vue";
import WarehouseSelector from "../../components/WarehouseSelector.vue";
import CategorySelector from "../../components/CategorySelector.vue";
import UiButton from "../../components/UiButton.vue";
import DashboardSectionLayout from "./DashboardSectionLayout.vue";
import DashboardSectionCard from "./DashboardSectionCard.vue";
import UiLoadingBoundary from "../../components/UiLoadingBoundary.vue";
import ReturnToTop from "../../components/ReturnToTop.vue";
import { movementLabel } from "../../lib/movementLabels";
import { normalizeHierarchySelection } from "../../lib/hierarchySelection";
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import type { DashboardController } from "./useDashboardController";

const props = defineProps<{ controller: DashboardController }>();
const c = props.controller;
const dashboardContent = ref<HTMLElement>();
const dashboardHeading = ref<HTMLElement>();
const returnToTopTarget = computed(() => {
	const content = dashboardContent.value;
	if (!content) return undefined;
	return c.surface.value === "desktop"
		? content
		: content.closest<HTMLElement>(".shell-content") || undefined;
});
const contentWidth = ref(0);
let contentObserver: ResizeObserver | undefined;
const desktopGrouped = () => c.surface.value === "desktop" && contentWidth.value >= 760;
const activeWarehouseFilters = () =>
	normalizeHierarchySelection(c.filters.value.warehouses, c.warehouseRows.value);
const activeCategoryFilters = () =>
	normalizeHierarchySelection(c.filters.value.item_groups, c.categoryRows.value);
onMounted(() => {
	if (!dashboardContent.value || typeof ResizeObserver === "undefined") return;
	contentObserver = new ResizeObserver(([entry]) => {
		contentWidth.value = entry.contentRect.width;
	});
	contentObserver.observe(dashboardContent.value);
});
onBeforeUnmount(() => contentObserver?.disconnect());
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
	path: "/loans/records",
	query: {
		status: "outstanding",
		warehouses: c.filters.value.warehouses,
		item_groups: c.filters.value.item_groups,
	},
});
const previewQuery = () =>
	c.data.value.expiry?.preview_mode === "expired"
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
			c.data.value.distribution?.mode === "warehouse"
				? [bar.key]
				: c.filters.value.warehouses,
		item_groups:
			c.data.value.distribution?.mode === "category"
				? [bar.key]
				: c.filters.value.item_groups,
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
const distributionBars = () => c.data.value.distribution?.bars || [];
const expiryPreviewRange = () => {
	const mode = c.expiryPreview.value;
	const range = c.data.value.expiry?.preview_ranges?.[mode];
	if (!range?.to) return "";
	return mode === "expired"
		? `已过期：早于 ${range.to}`
		: `即将过期：${range.from} 至 ${range.to}`;
};
const distributionMaximum = () =>
	Math.max(0, ...distributionBars().map((bar: any) => bar.distinct_items));
const distributionTicks = () => {
	const maximum = distributionMaximum();
	if (maximum === 0) return [0];
	const step = Math.max(1, Math.ceil(maximum / 4));
	const ticks = [];
	for (let value = 0; value < maximum; value += step) ticks.push(value);
	if (ticks[ticks.length - 1] !== maximum) ticks.push(maximum);
	return ticks;
};
const distributionWidth = (count: number) =>
	distributionMaximum() ? `${(count / distributionMaximum()) * 100}%` : "0%";
const sectionStale = (section: Parameters<typeof c.sectionStale>[0]) => c.sectionStale(section);
const dataStale = (section: Parameters<typeof c.sectionStale>[0]) =>
	Boolean(c.globalLoading?.value || (!c.hasSuccessfulData.value && c.loading.value)) ||
	c.sectionStale(section);
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
		<main ref="dashboardContent" class="dashboard-content">
			<header class="dashboard-header">
				<div>
					<p class="eyebrow">寺院物资</p>
					<h1 ref="dashboardHeading" tabindex="-1">物资总览</h1>
					<p class="dashboard-scope">{{ c.activeScopeLabel.value }}</p>
				</div>
				<div class="dashboard-header-actions">
					<span v-if="c.data.value?.generated_at"
						>最后更新：{{ generatedAt(c.data.value.generated_at) }}</span
					>
					<UiButton variant="ghost" size="compact" @click="c.refresh">↻ 刷新</UiButton
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
					v-for="value in activeWarehouseFilters()"
					:key="`warehouse-${value}`"
					type="button"
					@click="
						c.updateFilters({
							warehouses: activeWarehouseFilters().filter((item) => item !== value),
							item_groups: activeCategoryFilters(),
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
					v-for="value in activeCategoryFilters()"
					:key="`group-${value}`"
					type="button"
					@click="
						c.updateFilters({
							warehouses: activeWarehouseFilters(),
							item_groups: activeCategoryFilters().filter((item) => item !== value),
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
			<UiLoadingBoundary
				:busy="c.globalLoading?.value ?? (!c.hasSuccessfulData.value && c.loading.value)"
				:mode="c.hasSuccessfulData.value ? 'refresh' : 'initial'"
				:message="c.hasSuccessfulData.value ? '正在更新…' : '正在加载物资总览…'"
				:region="dashboardContent"
				:block-interactions="false"
			>
				<p
					v-if="c.error.value && !c.hasSuccessfulData.value"
					class="dashboard-error"
					role="alert"
				>
					{{ c.error.value }} <button type="button" @click="c.refresh">重试</button>
				</p>
				<div
					v-if="c.loading.value && !c.hasSuccessfulData.value"
					class="dashboard-loading"
				></div>
				<DashboardSectionLayout
					v-else-if="c.hasSuccessfulData.value"
					:grouped="desktopGrouped()"
				>
					<template #inventory>
						<DashboardSectionCard :controller="c" section="inventory"
							><div class="dashboard-section-content">
								<div class="section-heading">
									<h2>库存概览</h2>
									<RouterLink
										:inert="dataStale('inventory') ? true : undefined"
										:aria-disabled="dataStale('inventory')"
										:to="stockQuery()"
										>查看库存 ›</RouterLink
									>
								</div>
								<div class="metric-grid">
									<RouterLink
										:inert="dataStale('inventory') ? true : undefined"
										:aria-disabled="dataStale('inventory')"
										v-for="metric in [
											{
												key: 'available_stock',
												label: '可用库存',
												tone: 'healthy',
											},
											{
												key: 'total_stock',
												label: '库存总计',
												tone: 'neutral',
											},
											{
												key: 'on_loan_qty',
												label: '借出',
												tone: 'borrowed',
											},
											{ key: 'damaged_qty', label: '损坏', tone: 'danger' },
										]"
										:key="metric.key"
										class="metric-card"
										:class="metric.tone"
										:to="stockQuery()"
										><span>{{ metric.label }}</span
										><strong>{{
											fmt(
												c.data.value.inventory?.totals?.[metric.key]
													?.unitless_total,
											)
										}}</strong
										><small>{{
											quantities(
												c.data.value.inventory?.totals?.[metric.key],
											)
										}}</small></RouterLink
									>
								</div>
							</div>
						</DashboardSectionCard>
					</template>
					<template #expiry>
						<DashboardSectionCard :controller="c" section="expiry"
							><div class="dashboard-section-content">
								<div class="section-heading">
									<h2>效期概览</h2>
									<RouterLink
										:inert="dataStale('expiry') ? true : undefined"
										:aria-disabled="dataStale('expiry')"
										:to="{
											path: '/expiry',
											query: {
												warehouses: c.filters.value.warehouses,
												item_groups: c.filters.value.item_groups,
											},
										}"
										>查看全部 ›</RouterLink
									>
								</div>
								<div class="expiry-grid">
									<RouterLink
										:inert="dataStale('expiry') ? true : undefined"
										:aria-disabled="dataStale('expiry')"
										v-for="bucket in c.expiryBuckets.value"
										:key="bucket.label"
										class="expiry-card"
										:class="
											bucket.label.includes('已过期')
												? 'expired'
												: 'upcoming'
										"
										:to="expiryQuery(bucket)"
										><span>{{ bucket.label }}</span
										><strong>{{ bucket.count }}</strong
										><small>个批次</small></RouterLink
									>
								</div>
								<div class="preview-toolbar">
									<h3>效期批次预览</h3>
									<p v-if="expiryPreviewRange()" class="preview-range">
										{{ expiryPreviewRange() }}
									</p>
									<div class="segmented">
										<button
											:class="{
												active: c.expiryPreview.value === 'expired',
											}"
											@click="c.expiryPreview.value = 'expired'"
										>
											已过期</button
										><button
											:class="{
												active: c.expiryPreview.value === 'upcoming',
											}"
											@click="c.expiryPreview.value = 'upcoming'"
										>
											即将过期
										</button>
									</div>
								</div>
								<div class="dashboard-list">
									<RouterLink
										:inert="dataStale('expiry') ? true : undefined"
										:aria-disabled="dataStale('expiry')"
										v-for="row in c.data.value.expiry?.preview || []"
										:key="row.batch_no"
										:to="previewQuery()"
										class="dashboard-list-row"
										><span
											><b>{{ row.item_name || row.item_code }}</b
											><small
												>{{ row.batch_no }} · {{ row.expiry_date }}</small
											></span
										><strong
											>{{ fmt(row.total_qty) }} {{ row.stock_uom }}</strong
										></RouterLink
									>
									<p
										v-if="!(c.data.value.expiry?.preview || []).length"
										class="empty-state"
									>
										当前范围没有需要关注的批次
									</p>
								</div>
							</div>
						</DashboardSectionCard>
					</template>
					<template #distribution>
						<DashboardSectionCard :controller="c" section="distribution"
							><div class="dashboard-section-content">
								<div class="section-heading">
									<h2>库存分布</h2>
									<div class="segmented">
										<button
											:class="{
												active: c.distributionMode.value === 'warehouse',
											}"
											@click="c.distributionMode.value = 'warehouse'"
										>
											按仓库</button
										><button
											:class="{
												active: c.distributionMode.value === 'category',
											}"
											@click="c.distributionMode.value = 'category'"
										>
											按类别
										</button>
									</div>
								</div>
								<p class="distribution-total">
									物品种数 ·
									{{ c.data.value.distribution?.distinct_items ?? 0 }} 种
								</p>
								<p class="distribution-note">
									按物品编码去重统计有库存的物品种数，不是库存数量之和。
								</p>
								<p
									v-if="c.data.value.distribution?.mode === 'warehouse'"
									class="distribution-note"
								>
									同一种物品可出现在多个仓库中，因此各仓库种数相加可能大于总种数。
								</p>
								<div class="distribution-list">
									<div class="distribution-axis" aria-hidden="true">
										<span
											v-for="tick in distributionTicks()"
											:key="tick"
											:style="{
												left: `${distributionMaximum() ? (tick / distributionMaximum()) * 100 : 0}%`,
											}"
											>{{ tick }}</span
										>
									</div>
									<RouterLink
										:inert="dataStale('distribution') ? true : undefined"
										:aria-disabled="dataStale('distribution')"
										v-for="bar in c.data.value.distribution?.bars || []"
										:key="bar.key"
										class="distribution-row"
										:to="distributionQuery(bar)"
									>
										<span>{{ bar.label }}</span>
										<div>
											<i
												:style="{
													width: distributionWidth(bar.distinct_items),
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
							</div>
						</DashboardSectionCard>
					</template>

					<template #movement>
						<DashboardSectionCard :controller="c" section="movement"
							><div class="dashboard-section-content">
								<div class="section-heading">
									<h2>货物流动概览</h2>
									<div class="movement-heading-actions">
										<div class="segmented">
											<button
												:class="{
													active: c.movementPeriod.value === 'this_week',
												}"
												@click="c.movementPeriod.value = 'this_week'"
											>
												本周</button
											><button
												:class="{
													active:
														c.movementPeriod.value === 'this_month',
												}"
												@click="c.movementPeriod.value = 'this_month'"
											>
												本月</button
											><button
												:class="{
													active: c.movementPeriod.value === 'this_year',
												}"
												@click="c.movementPeriod.value = 'this_year'"
											>
												本年</button
											><button
												:class="{
													active: c.movementPeriod.value === 'all',
												}"
												@click="c.movementPeriod.value = 'all'"
											>
												全部
											</button>
										</div>
										<RouterLink
											:inert="dataStale('movement') ? true : undefined"
											:aria-disabled="dataStale('movement')"
											:to="movementQuery()"
											>查看记录 ›</RouterLink
										>
									</div>
								</div>
								<div class="movement-layout">
									<div class="movement-grid">
										<RouterLink
											:inert="dataStale('movement') ? true : undefined"
											:aria-disabled="dataStale('movement')"
											v-for="summary in c.movementSummaries.value"
											:key="summary.kind"
											:to="movementQuery(summary.kind)"
											class="movement-card"
											><span>{{ summary.label }}</span
											><strong>{{
												fmt(summary.quantity?.unitless_total)
											}}</strong
											><small
												>合计数量 ·
												{{ quantities(summary.quantity) }}</small
											><em>{{ summary.record_count }} 条记录</em></RouterLink
										>
									</div>
									<div class="recent-panel">
										<h3>最近记录</h3>
										<RouterLink
											:inert="dataStale('movement') ? true : undefined"
											:aria-disabled="dataStale('movement')"
											v-for="row in c.data.value.movement?.recent || []"
											:key="row.record_name"
											:to="row.detail_route || '/movements/records'"
											class="dashboard-list-row"
											><span
												><b>{{ movementLabel(row.movement_kind) }}</b
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
							</div>
						</DashboardSectionCard>
					</template>
					<template #loans>
						<DashboardSectionCard :controller="c" section="loans"
							><div class="dashboard-section-content">
								<div class="section-heading">
									<h2>借出中</h2>
									<RouterLink
										:inert="dataStale('loans') ? true : undefined"
										:aria-disabled="dataStale('loans')"
										:to="loanQuery()"
										>查看借用 ›</RouterLink
									>
								</div>
								<div class="loan-summary">
									<div>
										<span>未归还记录数</span
										><strong>{{
											c.data.value.loans?.record_count || 0
										}}</strong>
									</div>
									<div>
										<span>尚未归还数量</span
										><strong>{{
											fmt(c.data.value.loans?.quantity?.unitless_total)
										}}</strong
										><small>{{
											quantities(c.data.value.loans?.quantity)
										}}</small>
									</div>
								</div>
								<div class="dashboard-list">
									<RouterLink
										:inert="dataStale('loans') ? true : undefined"
										:aria-disabled="dataStale('loans')"
										v-for="row in c.data.value.loans?.rows || []"
										:key="row.name"
										:to="`/loans/${encodeURIComponent(row.name)}`"
										class="dashboard-list-row"
										><span
											><b
												>{{ row.borrower || "未填写借用方" }} ·
												{{ row.status }}</b
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
									<p
										v-if="!(c.data.value.loans?.rows || []).length"
										class="empty-state"
									>
										当前没有未归还借用
									</p>
								</div>
							</div>
						</DashboardSectionCard>
					</template>
					<template #reminders>
						<DashboardSectionCard :controller="c" section="reminders"
							><div class="dashboard-section-content">
								<div class="section-heading"><h2>提醒事项</h2></div>
								<div class="reminder-grid">
									<RouterLink
										:inert="dataStale('reminders') ? true : undefined"
										:aria-disabled="dataStale('reminders')"
										v-for="reminder in c.data.value.reminders || []"
										:key="reminder.kind"
										:to="reminderQuery(reminder)"
										class="reminder-card"
										:class="reminder.severity"
										><span>{{ reminder.label }}</span
										><strong>{{ reminder.count }}</strong
										><small>查看详情 ›</small></RouterLink
									>
									<p
										v-if="!(c.data.value.reminders || []).length"
										class="empty-state"
									>
										暂无需要处理的提醒
									</p>
								</div>
							</div>
						</DashboardSectionCard>
					</template>
				</DashboardSectionLayout>
			</UiLoadingBoundary>
		</main>
		<ReturnToTop
			:target="returnToTopTarget"
			:heading="dashboardHeading"
			:hidden="c.surface.value === 'mobile' && c.filterOpen.value"
		/>
	</div>
</template>

<style scoped>
.dashboard-page {
	display: flex;
	min-height: 100%;
	background: var(--ti-canvas);
	color: var(--ti-ink);
}
.dashboard-page button:not(:disabled) {
	cursor: pointer;
}
.dashboard-page button:disabled {
	cursor: not-allowed;
	opacity: 0.55;
}
.dashboard-page button:not(:disabled):hover {
	border-color: var(--ti-border-strong);
	background-color: var(--ti-accent-soft);
}
.dashboard-page button:not(:disabled):focus-visible {
	outline: 3px solid var(--ti-accent);
	outline-offset: 3px;
}
.dashboard-content {
	flex: 1;
	min-width: 0;
	min-height: 0;
	container-type: inline-size;
	overflow: auto;
	padding: var(--ti-density-page) var(--ti-density-page) 82px;
}
.dashboard-page button.return-to-top:not(:disabled):hover {
	border-color: var(--ti-border-strong);
	background-color: var(--ti-surface);
}
.dashboard-desktop-filter {
	display: none;
	width: 250px;
	flex: none;
	box-sizing: border-box;
	overflow-y: auto;
	padding: var(--ti-density-page) var(--ti-space-3);
	border-right: 1px solid var(--ti-border);
	background: var(--ti-canvas);
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
	flex-wrap: wrap;
	gap: var(--ti-density-gap);
}
.dashboard-header {
	margin-bottom: var(--ti-space-6);
}
.eyebrow {
	margin: 0;
	color: var(--ti-accent);
	font-size: var(--ti-font-body);
	font-weight: 700;
}
h1 {
	margin: var(--ti-space-1) 0 var(--ti-space-1);
	font-size: var(--ti-font-heading);
}
.dashboard-scope {
	margin: 0;
	color: var(--ti-muted);
	font-size: var(--ti-font-body);
}
.dashboard-header-actions {
	display: flex;
	align-items: center;
	gap: var(--ti-density-row-gap);
	color: var(--ti-muted);
	font-size: var(--ti-font-body);
}
.dashboard-active-filters {
	display: flex;
	flex-wrap: wrap;
	gap: var(--ti-space-2);
	margin: calc(var(--ti-space-2) * -1) 0 var(--ti-space-5);
}
.dashboard-active-filters button {
	padding: var(--ti-space-1) var(--ti-space-2);
	border: 1px solid var(--ti-border);
	border-radius: var(--ti-radius-pill);
	background: var(--ti-surface);
	color: var(--ti-accent-strong);
	font: inherit;
	font-size: max(12px, var(--ti-font-small));
	cursor: pointer;
}
.dashboard-active-filters .clear-filter-chip {
	border-color: transparent;
	background: transparent;
	color: var(--ti-accent);
}
.dashboard-section {
	position: relative;
	min-width: 0;
	padding: var(--ti-density-gap);
	border: 1px solid var(--ti-border);
	border-radius: var(--ti-radius-card);
	background: var(--ti-surface);
	box-shadow: var(--ti-shadow-card);
}
.dashboard-section a[aria-disabled="true"] {
	cursor: not-allowed;
	opacity: 0.55;
}
.dashboard-section button:disabled {
	cursor: not-allowed;
	opacity: 0.55;
}
.dashboard-section a:not([aria-disabled="true"]),
.dashboard-section button:not(:disabled) {
	cursor: pointer;
}
.dashboard-section a:not([aria-disabled="true"]):hover {
	color: var(--ti-accent-strong);
	text-decoration: underline;
}
.dashboard-section a:not([aria-disabled="true"]):focus-visible,
.dashboard-section button:not(:disabled):focus-visible {
	outline: 3px solid var(--ti-accent);
	outline-offset: 3px;
}
h2 {
	margin: 0;
	font-size: var(--ti-font-section);
}
h3 {
	margin: 0;
	font-size: var(--ti-font-body);
}
.section-heading a {
	color: var(--ti-accent);
	font-size: var(--ti-font-body);
}
.metric-grid,
.expiry-grid,
.movement-grid,
.reminder-grid {
	display: grid;
	gap: var(--ti-density-row-gap);
	margin-top: var(--ti-space-4);
}
.metric-grid {
	grid-template-columns: repeat(2, minmax(0, 1fr));
}
.expiry-grid {
	grid-template-columns: repeat(3, minmax(0, 1fr));
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
	gap: var(--ti-density-row-gap);
	padding: var(--ti-density-gap);
	border: 1px solid var(--ti-border);
	border-radius: var(--ti-radius-card);
	color: inherit;
	text-decoration: none;
	transition:
		transform var(--ti-motion-fast),
		box-shadow var(--ti-motion-fast);
}
.metric-card:hover,
.expiry-card:hover,
.movement-card:hover,
.reminder-card:hover {
	transform: translateY(-1px);
	box-shadow: var(--ti-shadow-card);
}
.metric-card span,
.expiry-card span,
.movement-card span,
.reminder-card span {
	color: var(--ti-muted);
	font-size: var(--ti-font-body);
}
.metric-card strong,
.expiry-card strong,
.movement-card strong,
.reminder-card strong {
	font-size: var(--ti-font-heading);
	line-height: 1.1;
}
.metric-card small,
.expiry-card small,
.movement-card small,
.reminder-card small {
	color: var(--ti-muted);
	font-size: max(12px, var(--ti-font-small));
	min-width: 0;
	overflow-wrap: anywhere;
}
.metric-card.healthy {
	background: var(--ti-success-bg);
	color: var(--ti-success);
}
.metric-card.neutral {
	background: var(--ti-surface-raised);
	color: var(--ti-accent-strong);
}
.metric-card.borrowed {
	background: var(--ti-info-bg);
	color: var(--ti-info);
}
.metric-card.danger,
.expired {
	background: var(--ti-danger-bg);
	color: var(--ti-danger);
}
.upcoming {
	background: var(--ti-warning-bg);
	color: var(--ti-warning);
}
.preview-toolbar {
	margin-top: var(--ti-space-5);
}
.preview-range {
	margin: var(--ti-space-1) 0 var(--ti-space-2);
	color: var(--ti-muted);
	font-size: max(12px, var(--ti-font-small));
}
.segmented {
	display: inline-flex;
	gap: var(--ti-space-1);
	padding: var(--ti-space-1);
	border-radius: var(--ti-radius-small);
	background: var(--ti-border);
}
.segmented button {
	min-height: 44px;
	padding: var(--ti-space-1) var(--ti-space-2);
	border: 0;
	border-radius: var(--ti-radius-small);
	background: transparent;
	color: var(--ti-muted);
	font: inherit;
	font-size: max(12px, var(--ti-font-small));
	cursor: pointer;
}
.segmented button.active {
	background: var(--ti-surface);
	color: var(--ti-accent-strong);
	box-shadow: var(--ti-shadow-card);
}
.movement-heading-actions {
	display: flex;
	align-items: center;
	flex-wrap: wrap;
	min-width: 0;
	gap: var(--ti-density-row-gap);
}
.dashboard-list {
	margin-top: var(--ti-space-2);
	border: 1px solid var(--ti-border);
	border-radius: var(--ti-radius-small);
	overflow: hidden;
}
.dashboard-list-row {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: var(--ti-density-gap);
	padding: var(--ti-density-row-gap) var(--ti-space-3);
	border-bottom: 1px solid var(--ti-border);
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
	min-width: 0;
	white-space: normal;
	overflow-wrap: anywhere;
}
.dashboard-list-row small {
	margin-top: var(--ti-space-1);
	color: var(--ti-muted);
	font-size: max(12px, var(--ti-font-small));
}
.dashboard-list-row strong {
	flex: none;
	max-width: 40%;
	white-space: normal;
	text-align: right;
	overflow-wrap: anywhere;
	font-size: var(--ti-font-body);
}
.movement-layout {
	display: block;
	margin-top: var(--ti-space-4);
}
.movement-grid {
	margin-top: 0;
}
.recent-panel {
	min-width: 0;
	margin-top: var(--ti-space-4);
}
.recent-panel h3 {
	margin: 0 0 var(--ti-space-2);
}
.movement-card em {
	margin-top: var(--ti-space-1);
	color: var(--ti-muted);
	font-size: max(12px, var(--ti-font-small));
	font-style: normal;
}
.loan-summary {
	display: flex;
	gap: var(--ti-density-row-gap);
	margin-top: var(--ti-space-4);
}
.loan-summary > div {
	flex: 1;
	padding: var(--ti-density-gap);
	border-radius: var(--ti-radius-control);
	background: var(--ti-info-bg);
}
.loan-summary span,
.loan-summary small {
	display: block;
	color: var(--ti-muted);
	font-size: var(--ti-font-body);
}
.loan-summary strong {
	display: block;
	margin: var(--ti-space-1) 0;
	color: var(--ti-info);
	font-size: var(--ti-font-heading);
}
.reminder-grid {
	grid-template-columns: repeat(3, minmax(0, 1fr));
}
.reminder-card.critical {
	background: var(--ti-danger-bg);
	color: var(--ti-danger);
}
.reminder-card.warning {
	background: var(--ti-warning-bg);
	color: var(--ti-warning);
}
.distribution-note {
	margin: var(--ti-space-2) 0 var(--ti-space-3);
	color: var(--ti-muted);
	font-size: max(12px, var(--ti-font-small));
}
.distribution-total {
	margin: var(--ti-space-3) 0 0;
	color: var(--ti-ink);
	font-size: var(--ti-font-body);
	font-weight: 750;
}
.distribution-row {
	display: grid;
	grid-template-columns: minmax(120px, 180px) 1fr 45px;
	align-items: center;
	gap: var(--ti-density-row-gap);
	margin: var(--ti-space-3) 0;
	font-size: var(--ti-font-body);
	color: inherit;
	text-decoration: none;
}
.distribution-row > div {
	height: 18px;
	overflow: hidden;
	border-radius: var(--ti-radius-small);
	background: var(--ti-border);
	border-left: 1px solid var(--ti-muted);
}
.distribution-row i {
	display: block;
	height: 100%;
	border-radius: inherit;
	background: linear-gradient(90deg, var(--ti-accent), var(--ti-accent-strong));
}
.distribution-axis {
	position: relative;
	height: 16px;
	margin: 0 var(--ti-space-8) var(--ti-space-1) var(--ti-space-8);
	color: var(--ti-muted);
	font-size: max(12px, var(--ti-font-small));
}
.distribution-axis span {
	position: absolute;
	transform: translateX(-50%);
}
.distribution-row strong {
	text-align: right;
}
.empty-state {
	margin: 0;
	padding: var(--ti-space-4);
	color: var(--ti-muted);
	text-align: center;
	font-size: var(--ti-font-body);
}
.dashboard-loading {
	padding: var(--ti-space-8) var(--ti-space-5);
	color: var(--ti-muted);
	text-align: center;
}
.dashboard-error {
	padding: var(--ti-space-3) var(--ti-space-4);
	border-radius: var(--ti-radius-small);
	background: var(--ti-danger-bg);
	color: var(--ti-danger);
}
.dashboard-error button {
	border: 0;
	background: transparent;
	color: inherit;
	text-decoration: underline;
	cursor: pointer;
}
.dashboard-filter-section {
	margin-bottom: var(--ti-space-5);
}
.dashboard-filter-section h3 {
	margin-bottom: var(--ti-space-2);
}
@media (min-width: 1024px) {
	.segmented button {
		min-height: var(--ti-density-control);
	}
	.dashboard-page {
		min-height: 0;
		height: 100%;
	}
	.dashboard-content {
		height: 100%;
		box-sizing: border-box;
	}
	.dashboard-desktop-filter {
		max-height: 100%;
	}
}
@media (max-width: 1023px) {
	.dashboard-desktop-filter {
		display: none !important;
	}
	.dashboard-page {
		display: block;
		min-height: calc(100dvh - var(--mobile-nav-height, 0px));
		height: auto;
	}
	.dashboard-content {
		overflow: visible;
		padding: var(--ti-density-page) var(--ti-density-page) var(--ti-space-5);
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
		padding: var(--ti-density-gap);
		border-radius: var(--ti-radius-card);
	}
	.movement-grid,
	.reminder-grid {
		grid-template-columns: repeat(2, minmax(0, 1fr));
	}
	.movement-heading-actions {
		align-items: flex-end;
		flex-direction: column;
		gap: var(--ti-space-2);
	}
	.recent-panel {
		margin-top: var(--ti-space-3);
	}
	.loan-summary {
		flex-direction: column;
	}
	.dashboard-list-row {
		padding: var(--ti-density-row-gap) var(--ti-density-row-gap);
	}
	.distribution-axis {
		margin-right: 0;
		margin-left: 0;
	}
	.distribution-row {
		grid-template-columns: minmax(0, 1fr) auto;
		grid-template-rows: auto 18px;
		row-gap: var(--ti-space-1);
	}
	.distribution-row > div {
		grid-column: 1 / -1;
		grid-row: 2;
	}
}
@media (max-width: 520px) {
	h1 {
		font-size: var(--ti-font-heading);
	}
	.dashboard-header {
		display: block;
	}
	.dashboard-header-actions {
		margin-top: var(--ti-space-3);
		justify-content: space-between;
	}
	.movement-grid,
	.reminder-grid {
		grid-template-columns: 1fr;
	}
	.expiry-grid {
		grid-template-columns: repeat(3, minmax(0, 1fr));
	}
	.expiry-card strong {
		font-size: var(--ti-font-heading);
	}
}
</style>
