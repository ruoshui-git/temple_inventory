<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, reactive, ref, toRef, watch } from "vue";
import { useInfiniteScroll } from "../../composables/useInfiniteScroll";
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
import { type LoansController } from "./useLoansController";

const props = defineProps<{ controller: LoansController; surface: ResponsiveSurface }>();
const c = reactive(props.controller);
const surface = toRef(props, "surface");
const filterPanel = ref<{ openPanel: (event?: Event) => void } | null>(null);
const scrollRoot = ref<HTMLElement>();
const sentinel = ref<HTMLElement>();
const summaryOpen = ref(false);
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
							v-for="option in c.statusOptions"
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
				<CompactFilterSection title="借出日期" icon="calendar" :collapsible="false"
					><input v-model="c.filters.loan_date" type="date" aria-label="借出日期"
				/></CompactFilterSection>
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
				<header class="results-chrome loan-browse-header">
					<div class="loan-heading">
						<div>
							<span class="compact-heading"
								>借用 · {{ c.mode === "items" ? "明细" : "记录" }}</span
							>
							<h1>借用 · {{ c.mode === "items" ? "明细" : "记录" }}</h1>
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
						<label class="loan-search"
							><span aria-hidden="true">⌕</span
							><input
								v-model="c.filters.search"
								type="search"
								:placeholder="
									c.mode === 'items'
										? '搜索物品、借用方或记录编号'
										: '搜索记录编号、借用方或活动'
								"
								aria-label="搜索借用记录" /></label
						><UiButton
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
						><IconButton
							v-if="surface === 'mobile'"
							class="mobile-filter-button"
							label="筛选"
							title="筛选"
							@click="c.openFilters($event, filterPanel)"
							><svg aria-hidden="true" viewBox="0 0 24 24">
								<path d="M4 6h16M7 12h10M10 18h4" /></svg
							><span v-if="c.activeCount" class="icon-count">{{
								c.activeCount
							}}</span></IconButton
						><button
							class="column-summary-trigger"
							type="button"
							@click="summaryOpen = true"
						>
							Σ <span>列汇总</span>
						</button>
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
				</header>
				<div ref="scrollRoot" class="results-scroll" @scroll.passive="c.onResultsScroll">
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
						@activate="(row) => c.openLoan(row.loan || row.name)"
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
								@click="c.openLoan(row.loan || row.name)"
							>
								<header>
									<span>{{ String(row.loan_date || "").slice(0, 10) }}</span
									><span class="loan-status">{{
										c.statusLabel(row.loan_status)
									}}</span>
								</header>
								<div v-if="c.mode === 'items'" class="loan-item-cell">
									<ItemImagePreview
										:src="row.image || undefined"
										:alt="row.item_name"
									/><span
										><b>{{ row.item_name }}</b
										><small
											>{{ row.item_code }} ·
											{{ row.borrower || "未填写借用方" }}</small
										></span
									>
								</div>
								<strong v-else
									>{{ row.record_name }} ·
									{{ row.borrower || "未填写借用方" }}</strong
								>
								<dl>
									<div>
										<dt>{{ c.mode === "items" ? "借出数量" : "物品行数" }}</dt>
										<dd>
											{{
												c.mode === "items"
													? c.formatQuantities(row.loaned_qty)
													: `${row.line_count} 项`
											}}
										</dd>
									</div>
									<div>
										<dt>未归还</dt>
										<dd>{{ c.formatQuantities(row.outstanding_qty) }}</dd>
									</div>
									<div>
										<dt>活动</dt>
										<dd>{{ row.activity_title || row.activity || "—" }}</dd>
									</div>
									<template v-if="c.mode === 'items'">
										<div>
											<dt>原始位置</dt>
											<dd>{{ c.warehouseText(row.original_warehouse) }}</dd>
										</div>
										<div>
											<dt>借用记录</dt>
											<dd>
												<RouterLink
													:to="`/loans/${encodeURIComponent(row.loan)}`"
													data-row-control
													@click.stop
													>{{ row.loan }}</RouterLink
												>
											</dd>
										</div>
									</template>
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
		/>
	</main>
</template>
<style scoped>
.loan-browse-header {
	display: grid;
	gap: 8px;
	padding: 14px 0 8px;
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
	display: none;
}
.results-column.compact .loan-heading .compact-heading {
	display: block;
}
.result-toolbar {
	gap: 8px;
}
.loan-search {
	flex: 1;
	gap: 7px;
}
.loan-search input {
	width: 100%;
}
.browse-result-meta {
	display: flex;
	align-items: flex-start;
	justify-content: space-between;
	gap: 12px;
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
.column-summary-trigger {
	white-space: nowrap;
}
@media (max-width: 1023px) {
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
}
</style>
