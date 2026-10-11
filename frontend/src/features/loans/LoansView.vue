<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, reactive, ref, toRef, watch } from "vue";
import { useInfiniteScroll } from "../../composables/useInfiniteScroll";
import { useCompactBrowse } from "../../composables/useCompactBrowse";
import "../../components/browse-surface.css";
import type { ResponsiveSurface } from "../../composables/useResponsiveLayout";
import ActiveFilterChips from "../../components/ActiveFilterChips.vue";
import SortableDataTable from "../../components/SortableDataTable.vue";
import WarehouseSelector from "../../components/WarehouseSelector.vue";
import CategorySelector from "../../components/CategorySelector.vue";
import ResponsiveFilterPanel from "../../components/ResponsiveFilterPanel.vue";
import ItemImagePreview from "../../components/ItemImagePreview.vue";
import IconButton from "../../components/IconButton.vue";
import UiButton from "../../components/UiButton.vue";
import MovementLookup from "../../components/MovementLookup.vue";
import CompactFilterSection from "../../components/CompactFilterSection.vue";
import FloatingActionMenu from "../../components/FloatingActionMenu.vue";
import PageActionMenu from "../../components/PageActionMenu.vue";
import ResultCountStrip from "../../components/ResultCountStrip.vue";
import ColumnSummaryDialog from "../../components/ColumnSummaryDialog.vue";
import LoanGroupBreakdown, { closeLoanGroupBreakdowns } from "./LoanGroupBreakdown.vue";
import MobileSubnav from "../../components/MobileSubnav.vue";
import ReturnToTop from "../../components/ReturnToTop.vue";
import MobileBrowseHeader from "../../components/MobileBrowseHeader.vue";
import MovementPeriodSelector from "../../components/MovementPeriodSelector.vue";
import ColumnSummaryTrigger from "../../components/ColumnSummaryTrigger.vue";
import { type LoansController } from "./useLoansController";

const props = defineProps<{ controller: LoansController; surface: ResponsiveSurface }>();
const c = reactive(props.controller);
const surface = toRef(props, "surface");
const filterPanel = ref<{ openPanel: (event?: Event) => void } | null>(null);
const scrollRoot = ref<HTMLElement>();
useCompactBrowse(scrollRoot, toRef(c, "compact"));
const browseHeading = ref<HTMLElement>();
const mobileBrowseHeader = ref<{ heading?: HTMLElement }>();
const floatingActionsOpen = ref(false);
const sentinel = ref<HTMLElement>();
const summaryOpen = ref(false);
const breakdownTriggers = new Map<string, { activate: () => void; close: () => void }>();
watch(
	() => c.breakdownRow?.name,
	(name) => {
		if (!name) closeLoanGroupBreakdowns();
	},
	{ flush: "sync" },
);
function setBreakdownTrigger(row: any, component: any) {
	if (component?.activate) breakdownTriggers.set(row.name, component);
	else breakdownTriggers.delete(row.name);
}
function activateRow(row: any) {
	if (c.mode === "items") breakdownTriggers.get(row.name)?.activate();
	else c.openLoan(row.name || row.record_name);
}
function showBreakdown(row: any, pinned: boolean) {
	if (!c.isPeriodRangeValid()) return;
	void c.loadBreakdown(row);
	c.setBreakdownState(row, pinned);
}
const infiniteScroll = useInfiniteScroll({
	hasMore: () => c.rows.length < c.total,
	isLoading: () => c.loading || c.loadingMore,
	onLoadMore: () => c.load(true),
});
const pageActionsDisabled = () =>
	c.pageActions.length > 0 && c.pageActions.every((action) => action.disabled || action.loading);
function selectAction(kind: string) {
	return kind === "Return" ? c.createReturn() : c.createLoan();
}
onMounted(async () => {
	await nextTick();
	infiniteScroll.connect(scrollRoot.value, sentinel.value);
});
watch(
	() => c.scrollResetToken,
	async () => {
		await nextTick();
		scrollRoot.value?.scrollTo?.({ top: 0 });
		c.compact = false;
	},
);
onBeforeUnmount(() => infiniteScroll.disconnect());
</script>

<template>
	<main class="app-shell wide-shell viewport-list-root loan-browse">
		<div
			class="list-layout desktop-list-layout compact-filter-layout"
			:class="{ 'filters-open': c.desktopFilterOpen }"
		>
			<ResponsiveFilterPanel
				ref="filterPanel"
				v-model:open="c.filterOpen"
				:count="c.activeCount"
				:show-trigger="false"
				clearable
				@clear="c.clearFilters"
			>
				<CompactFilterSection title="状态" icon="filter" :collapsible="false"
					><fieldset class="choice-list">
						<legend class="sr-only">状态</legend>
						<label
							v-for="option in c.mode === 'items'
								? c.statusOptions
								: c.recordStatusOptions"
							:key="option.value"
							class="choice-row"
							><input
								v-model="c.filters.status"
								type="radio"
								:value="option.value"
							/>{{ option.label }}</label
						>
					</fieldset></CompactFilterSection
				>
				<CompactFilterSection title="借出时间" icon="calendar" :collapsible="false">
					<MovementPeriodSelector
						v-model:period-key="c.filters.period_key"
						v-model:date-from="c.filters.date_from"
						v-model:date-to="c.filters.date_to"
						:resolved-from="c.resolvedPeriod.date_from"
						:resolved-to="c.resolvedPeriod.date_to"
						variant="ledger"
						aria-label="借出时间范围"
					/>
					<p v-if="c.periodValidationError" class="period-validation-error" role="alert">
						{{ c.periodValidationError }}
					</p>
				</CompactFilterSection>
				<CompactFilterSection title="物品类别" icon="card"
					><CategorySelector
						v-model="c.filters.item_groups"
						:rows="c.boot?.item_groups || []"
						:counts="c.facets.item_groups"
						embedded
						placeholder="物品类别"
				/></CompactFilterSection>
				<CompactFilterSection title="物品" icon="search"
					><MovementLookup
						v-model="c.filters.item_code"
						v-model:query="c.itemQuery"
						:options="c.itemOptions"
						:loading="c.filterOptionsBusy"
						placeholder="搜索物品名称或编码"
						aria-label="物品"
						@update:query="c.scheduleItemSearch(String($event || ''))"
				/></CompactFilterSection>
				<CompactFilterSection title="原始借出位置" icon="warehouse"
					><WarehouseSelector
						v-model="c.filters.warehouses"
						:rows="c.boot?.physical_tree || []"
						:counts="c.facets.warehouses"
						embedded
						placeholder="原始借出位置"
				/></CompactFilterSection>
				<CompactFilterSection title="相关活动" icon="calendar"
					><MovementLookup
						v-model="c.filters.activity"
						v-model:query="c.activityQuery"
						:options="c.activityOptions"
						placeholder="搜索活动"
						aria-label="相关活动"
				/></CompactFilterSection>
			</ResponsiveFilterPanel>
			<div class="results-column" :class="{ compact: c.compact }">
				<header
					v-if="surface === 'desktop'"
					class="browse-results-header results-chrome loan-browse-header"
				>
					<div class="loan-heading">
						<div>
							<span class="compact-heading"
								>借用 · {{ c.mode === "items" ? "明细" : "记录" }}</span
							>
							<h1 ref="browseHeading" tabindex="-1">
								借用 · {{ c.mode === "items" ? "明细" : "记录" }}
							</h1>
						</div>
						<PageActionMenu
							v-if="surface === 'desktop' && c.pageActions.length"
							:actions="c.pageActions"
							:disabled="pageActionsDisabled()"
							label="新增借用记录"
							@select="selectAction"
						/>
					</div>
					<div class="result-toolbar">
						<label class="loan-search browse-search-field"
							><span aria-hidden="true">⌕</span
							><input
								v-model="c.filters.search"
								type="search"
								:placeholder="
									c.mode === 'items'
										? '搜索物品、借用方或记录编号'
										: '搜索记录编号、借用方或活动'
								"
								aria-label="搜索借用记录"
						/></label>
						<div class="loan-toolbar-actions">
							<UiButton
								v-if="surface === 'desktop'"
								variant="secondary"
								size="compact"
								type="button"
								class="toolbar-action desktop-filter-button"
								:aria-expanded="c.desktopFilterOpen"
								@click="c.openFilters($event, filterPanel)"
								>筛选<span v-if="c.activeCount" class="filter-count">{{
									c.activeCount
								}}</span></UiButton
							><ColumnSummaryTrigger @click="summaryOpen = true" />
						</div>
					</div>
					<div class="browse-result-meta">
						<ActiveFilterChips
							:chips="c.chips"
							@remove="c.removeChip"
							@clear="c.clearFilters"
						/><ResultCountStrip
							:loaded="c.rows.length"
							:filtered="c.total"
							:overall="c.overall"
							:updating="c.loading && c.rows.length > 0"
						/>
					</div>
					<div class="loan-status-chips" role="toolbar" aria-label="状态筛选">
						<button
							v-for="option in c.statusOptionsForMode"
							:key="option.value"
							type="button"
							class="loan-status-chip"
							:aria-pressed="c.filters.status === option.value"
							@click="c.setStatus(option.value)"
						>
							{{ option.label }}
						</button>
					</div>
				</header>
				<MobileBrowseHeader
					v-else
					ref="mobileBrowseHeader"
					:title="`借用 · ${c.mode === 'items' ? '明细' : '记录'}`"
					short-title="借用"
					:compact="c.compact"
					:destination-key="`loan-${c.mode}`"
				>
					<template #tabs>
						<MobileSubnav
							:items="c.contextItems"
							:active-key="c.mode"
							:compact="c.compact"
							aria-label="借用页面"
						/>
					</template>
					<template #search-actions>
						<label class="loan-search browse-search-field">
							<span aria-hidden="true">⌕</span>
							<input
								v-model="c.filters.search"
								type="search"
								:placeholder="
									c.mode === 'items'
										? '搜索物品、借用方或记录编号'
										: '搜索记录编号、借用方或活动'
								"
								aria-label="搜索借用记录"
							/>
						</label>
						<IconButton
							class="mobile-filter-button"
							:label="`筛选，${c.activeCount} 项已启用`"
							title="筛选"
							@click="c.openFilters($event, filterPanel)"
						>
							<svg aria-hidden="true" viewBox="0 0 24 24">
								<path d="M4 6h16M7 12h10M10 18h4" />
							</svg>
							<span v-if="c.activeCount" class="icon-count">{{
								c.activeCount
							}}</span>
						</IconButton>
					</template>
					<template #secondary>
						<div class="browse-result-meta">
							<ActiveFilterChips
								:chips="c.chips"
								@remove="c.removeChip"
								@clear="c.clearFilters"
							/>
							<ResultCountStrip
								:loaded="c.rows.length"
								:filtered="c.total"
								:overall="c.overall"
								:updating="c.loading && c.rows.length > 0"
							/>
						</div>
						<div class="loan-status-chips" role="toolbar" aria-label="状态筛选">
							<button
								v-for="option in c.statusOptionsForMode"
								:key="option.value"
								type="button"
								class="loan-status-chip"
								:aria-pressed="c.filters.status === option.value"
								@click="c.setStatus(option.value)"
							>
								{{ option.label }}
							</button>
						</div>
						<div
							v-if="c.periodValidationError"
							class="period-validation-error"
							role="alert"
						>
							{{ c.periodValidationError }}
						</div>
						<ColumnSummaryTrigger @click="summaryOpen = true" />
					</template>
				</MobileBrowseHeader>
				<div
					ref="scrollRoot"
					class="results-scroll browse-compact-table"
					@scroll.passive="c.onResultsScroll"
				>
					<SortableDataTable
						:surface="surface"
						:rows="c.rows"
						:columns="c.columns"
						:column-summaries="c.columnSummaries"
						:row-key="c.mode === 'items' ? 'name' : 'record_name'"
						:sort="c.sort"
						:loading="c.loading"
						:loading-more="c.loadingMore"
						:show-summary="false"
						:error="c.error"
						:empty-message="
							c.mode === 'items'
								? '没有符合条件的借用物品明细'
								: '没有符合条件的借用记录'
						"
						@sort="c.sort = $event"
						@activate="activateRow"
					>
						<template #error
							>{{ c.error }}
							<UiButton
								variant="ghost"
								size="compact"
								type="button"
								@click="c.load()"
								>重试</UiButton
							></template
						>
						<template #cell-loan_date="{ row }">{{
							String(row.loan_date || "").slice(0, 10)
						}}</template
						><template #cell-item="{ row }"
							><div class="loan-item-cell">
								<ItemImagePreview
									:src="row.image || undefined"
									:alt="row.item_name"
								/><span
									>{{ row.item_name }}<small>{{ row.item_code }}</small></span
								>
							</div></template
						><template #cell-record_name="{ row }"
							><RouterLink
								:to="`/loans/${encodeURIComponent(row.record_name)}`"
								data-row-control
								@click.stop
								>{{ row.record_name }}</RouterLink
							></template
						>
						<template #cell-quantity="{ row }">{{
							c.formatQuantities(row.quantity_values)
						}}</template>
						<template #cell-outcome_label="{ row }"
							><span class="loan-status">{{ row.outcome_label }}</span></template
						>
						<template #cell-record_count="{ row }">
							<LoanGroupBreakdown
								:ref="(component) => setBreakdownTrigger(row, component)"
								:row="row"
								:active-name="c.breakdownRow?.name || ''"
								:open="c.breakdownRow?.name === row.name && c.breakdownOpen"
								:pinned="c.breakdownRow?.name === row.name && c.breakdownPinned"
								:records="c.breakdownRow?.name === row.name ? c.breakdownRows : []"
								:total="c.breakdownTotal"
								:loading="c.breakdownLoading"
								:error="c.breakdownError"
								:format-quantities="c.formatQuantities"
								:warehouse-text="c.warehouseText"
								@show="showBreakdown(row, $event)"
								@hide="c.closeBreakdown()"
								@more="c.loadBreakdown(row, true)"
								@retry="c.loadBreakdown(row, c.breakdownRows.length > 0, true)"
							/>
						</template>
						<template #cell-loaned="{ row }">{{
							c.formatQuantities(row.loaned_qty)
						}}</template
						><template #cell-outstanding="{ row }">{{
							c.formatQuantities(row.outstanding_qty)
						}}</template
						><template #cell-loaned_qty="{ row }">{{
							c.formatQuantities(row.loaned_qty)
						}}</template
						><template #cell-outstanding_qty="{ row }">{{
							c.formatQuantities(row.outstanding_qty)
						}}</template
						><template #cell-loan_status="{ row }"
							><span class="loan-status">{{
								c.statusLabel(row.loan_status)
							}}</span></template
						><template #cell-original_warehouse="{ row }">{{
							c.warehouseText(row.original_warehouse)
						}}</template
						><template #cell-activity_title="{ row }">{{
							row.activity_title || row.activity || "—"
						}}</template
						><template #cell-line_count="{ row }"
							><RouterLink
								:to="`/loans/${encodeURIComponent(row.record_name)}`"
								data-row-control
								@click.stop
								>{{ row.line_count }} 项</RouterLink
							></template
						>
						<template #mobile-row="{ row, activateKey }"
							><article
								class="loan-card"
								tabindex="0"
								@keydown="activateKey"
								@click="activateRow(row)"
							>
								<header>
									<span>{{
										c.mode === "items"
											? row.outcome_label
											: String(row.loan_date || "").slice(0, 10)
									}}</span
									><span v-if="c.mode === 'records'" class="loan-status">{{
										c.statusLabel(row.loan_status)
									}}</span>
									<LoanGroupBreakdown
										v-if="c.mode === 'items'"
										:ref="(component) => setBreakdownTrigger(row, component)"
										:row="row"
										:active-name="c.breakdownRow?.name || ''"
										:open="
											c.breakdownRow?.name === row.name && c.breakdownOpen
										"
										:pinned="
											c.breakdownRow?.name === row.name && c.breakdownPinned
										"
										:records="
											c.breakdownRow?.name === row.name
												? c.breakdownRows
												: []
										"
										:total="c.breakdownTotal"
										:loading="c.breakdownLoading"
										:error="c.breakdownError"
										:format-quantities="c.formatQuantities"
										:warehouse-text="c.warehouseText"
										@show="showBreakdown(row, $event)"
										@hide="c.closeBreakdown()"
										@more="c.loadBreakdown(row, true)"
										@retry="
											c.loadBreakdown(row, c.breakdownRows.length > 0, true)
										"
									/>
								</header>
								<div v-if="c.mode === 'items'" class="loan-item-cell">
									<ItemImagePreview
										:src="row.image || undefined"
										:alt="row.item_name"
									/><span
										><b>{{ row.item_name }}</b
										><small>{{ row.item_code }}</small></span
									>
								</div>
								<strong v-else
									>{{ row.record_name }} ·
									{{ row.borrower || "未填写借用方" }}</strong
								>
								<dl v-if="c.mode === 'items'">
									<div>
										<dt>数量</dt>
										<dd>{{ c.formatQuantities(row.quantity_values) }}</dd>
									</div>
									<div>
										<dt>归还状态</dt>
										<dd>{{ row.outcome_label }}</dd>
									</div>
									<div>
										<dt>借用记录</dt>
										<dd>{{ row.record_count }} 条记录</dd>
									</div>
								</dl>
								<dl v-else>
									<div>
										<dt>物品行数</dt>
										<dd>{{ row.line_count }} 项</dd>
									</div>
									<div>
										<dt>未归还</dt>
										<dd>{{ c.formatQuantities(row.outstanding_qty) }}</dd>
									</div>
									<div>
										<dt>活动</dt>
										<dd>{{ row.activity_title || row.activity || "—" }}</dd>
									</div>
								</dl>
							</article></template
						>
					</SortableDataTable>
					<div ref="sentinel" aria-hidden="true"></div>
					<div v-if="c.appendError" class="table-append-error" role="alert">
						{{ c.appendError }}
						<UiButton
							variant="ghost"
							size="compact"
							type="button"
							@click="c.load(true)"
							>重试</UiButton
						>
					</div>
				</div>
			</div>
		</div>
		<ColumnSummaryDialog
			v-model:open="summaryOpen"
			:columns="c.columns"
			:summaries="c.columnSummaries"
			:loading="c.loading"
		/><FloatingActionMenu
			v-if="surface === 'mobile' && c.pageActions.length"
			:actions="c.pageActions"
			:disabled="pageActionsDisabled()"
			label="新建借出"
			@select="selectAction"
			@update:open="floatingActionsOpen = $event"
		/>
		<ReturnToTop
			:target="scrollRoot"
			:heading="surface === 'desktop' ? browseHeading : mobileBrowseHeader?.heading"
			:hidden="Boolean(c.filterOpen || summaryOpen || c.breakdownOpen)"
			:floating-action-open="floatingActionsOpen"
			:has-floating-action="surface === 'mobile' && c.pageActions.length > 0"
		/>
	</main>
</template>
<style scoped>
.loan-browse {
	box-sizing: border-box;
	width: 100%;
	max-width: none;
	margin-inline: 0;
	padding-inline: 16px;
	color: #343c46;
	background: #f8f7f4;
}
.loan-browse .desktop-list-layout {
	width: 100%;
	min-width: 0;
	grid-template-columns: minmax(0, 1fr);
	gap: 0;
}
.loan-browse .results-column {
	width: 100%;
	min-width: 0;
}
.loan-browse .desktop-list-layout:not(.filters-open) {
	grid-template-areas: "results";
}
.loan-browse .desktop-list-layout.filters-open {
	grid-template-columns: 250px minmax(0, 1fr);
}
.loan-browse .desktop-list-layout:not(.filters-open) :deep(.filter-sidebar) {
	display: none;
}
.loan-browse .desktop-list-layout.filters-open :deep(.filter-sidebar) {
	box-sizing: border-box;
	padding: 14px 12px;
	border-right: 1px solid #e4ded5;
	border-radius: 0;
	background: #fbfaf7;
	box-shadow: none;
}
.loan-browse-header {
	min-width: 0;
	width: 100%;
	display: grid;
	grid-template-columns: minmax(0, 1fr);
	align-items: stretch;
	justify-content: stretch;
	gap: 8px;
	padding: 14px 0 8px;
	background: #f8f7f4;
}
.loan-heading,
.loan-heading > div,
.result-toolbar,
.loan-search,
.loan-item-cell,
.loan-card header {
	display: flex;
	align-items: center;
}
.loan-heading {
	justify-content: space-between;
	gap: 14px;
}
.loan-heading h1 {
	margin: 0;
}
.loan-heading .compact-heading {
	display: none;
}
.results-column.compact .loan-heading h1 {
	position: absolute;
	width: 1px;
	height: 1px;
	padding: 0;
	margin: -1px;
	overflow: hidden;
	clip: rect(0, 0, 0, 0);
	white-space: nowrap;
	border: 0;
}
.results-column.compact .loan-heading .compact-heading {
	display: block;
}
.result-toolbar {
	min-width: 0;
	width: 100%;
	gap: 8px;
}
.loan-search {
	min-width: 0;
	flex: 1 1 auto;
	gap: 7px;
}
.loan-toolbar-actions {
	display: flex;
	flex: 0 0 auto;
	align-items: center;
	gap: 8px;
	margin-left: auto;
}
.browse-result-meta {
	display: flex;
	align-items: flex-start;
	justify-content: space-between;
	gap: 12px;
}
.loan-status-chips {
	display: flex;
	align-items: center;
	gap: 6px;
	width: 100%;
	padding: 4px 0 2px;
	overflow-x: auto;
	scrollbar-width: none;
}
.loan-status-chips::-webkit-scrollbar {
	display: none;
}
.loan-status-chip {
	flex: none;
	min-height: 34px;
	padding: 7px 12px;
	border: 1px solid #ded6c9;
	border-radius: 999px;
	background: #fffdf9;
	color: #6f604f;
	font-size: 16px;
	white-space: nowrap;
}
.loan-status-chip[aria-pressed="true"] {
	border-color: #9b571d;
	background: #9b571d;
	color: #fff;
}
.loan-item-cell {
	gap: 9px;
	min-width: 0;
}
.loan-item-cell span {
	display: grid;
	min-width: 0;
}
.loan-item-cell small,
.loan-card small {
	color: #6b6257;
}
.loan-status {
	color: #805022;
	font-size: 12px;
	font-weight: 700;
}
.loan-card {
	display: grid;
	gap: 12px;
	padding: 14px;
	border: 1px solid #eee5da;
	border-radius: 12px;
	background: #fff;
}
.loan-card header {
	justify-content: space-between;
}
.loan-card dl {
	display: grid;
	grid-template-columns: repeat(3, minmax(0, 1fr));
	gap: 8px;
	margin: 0;
}
.loan-card dt {
	color: #6b6257;
	font-size: 12px;
}
.loan-card dd {
	margin: 3px 0 0;
}
.choice-list {
	display: grid;
	gap: 8px;
	border: 0;
	padding: 0;
	margin: 0;
}
.period-validation-error {
	margin: 5px 0 0;
	color: #9b3229;
	font-size: 13px;
}
@media (min-width: 1024px) {
	.loan-browse .result-toolbar {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		align-items: center;
	}
	.loan-browse .loan-search {
		width: 100%;
	}
	.loan-browse .loan-toolbar-actions {
		justify-self: end;
	}
}
@media (max-width: 1023px) {
	.loan-browse {
		box-sizing: border-box;
		width: 100%;
		max-width: 100vw;
		height: calc(
			100dvh - var(--mobile-nav-height, 0px) - var(--mobile-context-nav-height, 0px)
		);
		min-width: 0;
		min-height: 0;
		padding-inline: 10px;
		overflow: hidden;
	}
	.loan-browse > .list-layout {
		display: flex;
		width: 100%;
		height: 100%;
		min-width: 0;
		min-height: 0;
		flex-direction: column;
		overflow: hidden;
	}
	.loan-browse .results-column {
		display: grid;
		grid-template-rows: auto minmax(0, 1fr);
		width: 100%;
		min-width: 0;
		min-height: 0;
	}
	.loan-browse .results-scroll {
		min-width: 0;
		min-height: 0;
		max-width: 100%;
		overflow-x: hidden;
		overflow-y: auto;
		padding-bottom: calc(var(--mobile-nav-height, 0px) + 105px);
	}
	.loan-browse .filters-open :deep(.filter-sidebar) {
		position: fixed;
		inset: 0 0 auto;
		z-index: 51;
		max-height: 80dvh;
		overflow: auto;
	}
	.loan-browse .results-chrome {
		background: #f8f7f4;
	}
	.loan-browse .loan-search {
		min-width: 0;
	}
	.loan-browse .loan-toolbar-actions {
		margin-left: auto;
	}
	.loan-browse .column-summary-trigger,
	.loan-browse .mobile-filter-button {
		flex: none;
	}
	.loan-heading h1 {
		display: none;
	}
	.loan-heading .compact-heading {
		display: block;
	}
	.loan-heading {
		flex-wrap: wrap;
	}
	.browse-result-meta {
		flex-wrap: wrap;
	}
	.browse-result-meta :deep(.result-count-strip) {
		width: 100%;
		justify-content: flex-end;
	}
	.loan-card dl {
		grid-template-columns: 1fr 1fr;
	}
	.loan-status-chip {
		min-height: 40px;
		font-size: 16px;
	}
}
@media (min-width: 1024px) {
	.loan-browse .results-scroll {
		padding-bottom: 82px;
	}
}
</style>
