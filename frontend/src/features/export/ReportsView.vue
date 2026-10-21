<script setup lang="ts">
import BrowseToolbar from "../../components/ui/BrowseToolbar.vue";
import BrowseChip from "../../components/ui/BrowseChip.vue";
import BrowseFilters from "../../components/filters/BrowseFilters.vue";
import { useFilterRailPreference } from "../../composables/useFilterRailPreference";
import { useResponsiveLayout } from "../../composables/useResponsiveLayout";
import { siteDateTime } from "../../lib/nativeTime";
import UiButton from "../../components/ui/UiButton.vue";
import SearchSelect from "../../components/ui/SearchSelect.vue";
import PeriodFilter from "../../components/ui/PeriodFilter.vue";
import FilterPanel from "../../components/ui/FilterPanel.vue";
import QuickExport from "../../components/QuickExport.vue";
import ReportTable from "../../components/ui/ReportTable.vue";
import {
	groupLabels,
	groupSequencesForView,
	groupsForView,
	reportDefinitions,
	sortableColumnLabels,
	sortableColumnsForView,
} from "../../lib/reportContract";
import { nextGroupByField, removeGroupByField } from "../../lib/groupBy";
import { computed } from "vue";
import { clearScopeField, scopeFilterFieldChips } from "../../lib/filterPresentation";
import { periodLabels } from "../../lib/sitePeriod";
import { hasReportStatuses } from "../../lib/reportFilters";
import type { useExportWorkspaceController } from "./useReportController";
const props = withDefaults(
	defineProps<{
		controller: ReturnType<typeof useExportWorkspaceController>;
		active?: boolean;
	}>(),
	{ active: true },
);
const emit = defineEmits<{
	openDocument: [doctype: string, name: string];
	openExport: [query: import("../../lib/reportContract").ReportQuery];
}>();
const {
	routeError,
	dataset,
	query,
	result,
	definition,
	panelContext,
	chips,
	movementFilters,
	reference,
	viewName,
	selectedPreset,
	usePreset,
	save,
	clear,
	rename,
	remove,
	namedViews,
	viewError,
	viewBusy,
	loadTable,
	mainTable,
	refresh,
	groups,
} = props.controller;
const availableGroups = computed(() => groupsForView(dataset.value, query.value.view));
const availableSecondGroups = computed(() =>
	groupSequencesForView(dataset.value, query.value.view)
		.filter((sequence) => sequence[0] === query.value.groupBy[0] && sequence.length === 2)
		.map((sequence) => sequence[1]),
);
const scopeChips = computed(() => scopeFilterFieldChips(query.value.scope, reference));
const periodChip = computed(() => {
	const period = query.value.scope.period;
	if (period.key === "all") return undefined;
	const label =
		period.key === "custom"
			? [period.from, period.to].filter(Boolean).join(" – ") || "日期待补全"
			: periodLabels[period.key] || period.key;
	return { label: `期间：${label}` };
});
const relatedPeriodChip = computed(() => {
	if (
		dataset.value !== "activities" ||
		query.value.view !== "records" ||
		query.value.relatedPeriod.key === "all"
	)
		return undefined;
	const value = query.value.relatedPeriod;
	const summary =
		value.key === "custom"
			? [value.from, value.to].filter(Boolean).join(" – ")
			: periodLabels[value.key];
	return { label: `关联单据日期：${summary || "日期待补全"}` };
});
const availableSortColumns = computed(() =>
	sortableColumnsForView(dataset.value, query.value.view),
);
function sortReport(field: string) {
	if (!availableSortColumns.value.includes(field)) return;
	if (query.value.sortBy === field)
		query.value.sort = query.value.sort === "asc" ? "desc" : "asc";
	else {
		query.value.sortBy = field;
		query.value.sort = "asc";
	}
}
const reportSidebarKey = computed(() => `reports.${dataset.value}.${query.value.view}`);
const reportSidebarDefault = computed(
	() => dataset.value === "inventory" || dataset.value === "expiry",
);
const {
	open: sidebarOpen,
	toggle: toggleSidebar,
	saveError: sidebarSaveError,
	retry: retrySidebarSave,
} = useFilterRailPreference(reportSidebarKey, reference, reportSidebarDefault);
const { isMobile } = useResponsiveLayout();
const sidebarAvailable = computed(() => dataset.value !== "activities");
function setGroup(index: number, value: string) {
	query.value.groupBy = nextGroupByField(
		dataset.value,
		query.value.view,
		query.value.groupBy,
		index,
		value,
	);
}
</script>
<template>
	<section class="preview-page preview-reports">
		<p v-if="routeError" role="alert">{{ routeError }}</p>
		<BrowseToolbar
			title="报表"
			:summary="`${definition.label} · ${result.total} 行`"
			v-model:search="query.search"
			search-label="搜索完整结果"
			:active="active"
			:filter-count="
				scopeChips.length +
				chips.filter((chip) => !chip.fixed).length +
				Number(Boolean(periodChip)) +
				Number(Boolean(relatedPeriodChip))
			"
			:sidebar-open="sidebarOpen"
			:sidebar-save-error="sidebarSaveError"
			:retry-sidebar-save="retrySidebarSave"
			:sidebar-available="sidebarAvailable"
			@sidebar="toggleSidebar"
		>
			<template #actions>
				<QuickExport
					:query="query"
					:active="active"
					@open-full="emit('openExport', $event)"
				/>
			</template>
			<template #subtitle
				><p class="muted">完整筛选范围 · 数量按单位与状态分别列示</p></template
			>
			<template #filters>
				<div class="browse-filter-mega reports-filter-mega">
					<section class="browse-filter-mega-section">
						<h3>筛选</h3>
						<div class="preview-filter-fields">
							<label class="preview-field"
								>数据集<select v-model="dataset">
									<option
										v-for="(option, id) in reportDefinitions"
										:key="id"
										:value="id"
									>
										{{ option.label }}
									</option>
								</select></label
							>
							<label class="preview-field"
								>视图<select v-model="query.view">
									<option
										v-for="view in definition.views"
										:key="view.id"
										:value="view.id"
									>
										{{ view.label }}
									</option>
								</select></label
							>
							<PeriodFilter
								v-if="
									(dataset !== 'inventory' || query.view === 'historical') &&
									(dataset !== 'expiry' || query.expiryWindow === 'period')
								"
								:today="reference.siteDate"
								v-model="query.scope.period"
								:label="definition.dateLabel"
								field-key="period"
								embedded
							/>
							<template v-if="dataset === 'activities' && query.view === 'records'">
								<PeriodFilter
									:today="reference.siteDate"
									v-model="query.relatedPeriod"
									label="关联单据记账日期"
									field-key="relatedPeriod"
									embedded
								/>
								<label class="preview-field"
									>关联记录搜索<input v-model="query.relatedSearch"
								/></label>
							</template>
							<label v-if="dataset === 'expiry'" class="preview-field"
								>到期窗口<select v-model="query.expiryWindow">
									<option value="period">选定日期期间</option>
									<option value="next_7">未来7天（含今日）</option>
									<option value="next_30">未来30天（含今日）</option>
									<option value="next_90">未来90天（含今日）</option>
									<option value="next_365">未来365天（含今日）</option>
									<option value="expired">已过期</option>
									<option value="undated">无效期</option>
								</select></label
							>
							<BrowseFilters
								v-model="query.scope"
								:hide-activity="
									['inventory', 'expiry', 'counts'].includes(dataset)
								"
								:movement="movementFilters"
								:hierarchy-in-rail="sidebarOpen && sidebarAvailable && !isMobile"
								records
							/>
						</div>
					</section>
					<section class="browse-filter-mega-section browse-filter-grouping">
						<h3>分组</h3>
						<fieldset class="preview-filter-fields">
							<legend>分组 · 最多两级</legend>
							<label class="preview-field"
								>第一级分组<select
									:value="query.groupBy[0] || ''"
									@change="
										setGroup(0, ($event.target as HTMLSelectElement).value)
									"
								>
									<option value="">不分组</option>
									<option
										v-for="group in availableGroups"
										:key="group"
										:value="group"
									>
										{{ groupLabels[group] }}
									</option>
								</select></label
							>
							<label class="preview-field"
								>第二级分组<select
									:value="query.groupBy[1] || ''"
									@change="
										setGroup(1, ($event.target as HTMLSelectElement).value)
									"
									:disabled="!query.groupBy[0] || !availableSecondGroups.length"
								>
									<option value="">无</option>
									<option
										v-for="group in availableSecondGroups"
										:key="group"
										:value="group"
									>
										{{ groupLabels[group] }}
									</option>
								</select></label
							>
						</fieldset>
					</section>
					<section class="browse-filter-mega-section reports-filter-secondary">
						<h3>其他筛选与视图</h3>
						<div class="preview-filter-fields">
							<label v-if="dataset === 'movements'" class="preview-choice-label"
								><input
									type="checkbox"
									v-model="query.includeAdjustments"
								/>包含期初与库存调整</label
							>
							<fieldset v-if="hasReportStatuses(query)">
								<legend>单据状态</legend>
								<label
									v-for="(label, status) in ['草稿', '已提交', '已取消']"
									:key="status"
									class="preview-choice-label"
									><input
										type="checkbox"
										v-model="query.statuses"
										:value="status"
									/>{{ label }}</label
								>
							</fieldset>
							<label
								v-if="
									['inventory', 'expiry'].includes(dataset) ||
									(dataset === 'loans' && query.view === 'items')
								"
								class="preview-choice-label"
								><input type="checkbox" v-model="query.includeZero" />{{
									dataset === "loans" ? "显示已结清物品" : "包含零库存"
								}}</label
							>
							<label v-if="dataset === 'expiry'" class="preview-choice-label"
								><input
									type="checkbox"
									v-model="query.includeUndated"
								/>全部日期中包含无效期</label
							>
							<template v-if="dataset === 'activities'"
								><label class="preview-field"
									>归档状态<select v-model="query.activityStatus">
										<option value="all">全部</option>
										<option value="active">进行中</option>
										<option value="archived">已归档</option>
									</select></label
								><SearchSelect
									label="活动类型"
									v-model="query.typeId"
									:options="reference.activityTypes"
							/></template>
							<label v-if="dataset === 'counts'" class="preview-field"
								>核对状态<select v-model="query.countReviewed">
									<option value="all">全部行</option>
									<option value="reviewed">已核对</option>
									<option value="unreviewed">未核对</option>
								</select></label
							>
							<fieldset class="preview-field">
								<legend>个人命名视图</legend>
								<label class="preview-field"
									>已保存视图<select
										v-model="selectedPreset"
										@change="usePreset"
									>
										<option value="">选择视图</option>
										<option
											v-for="view in namedViews"
											:key="view.id"
											:value="String(view.id)"
										>
											{{ view.title }}
										</option>
									</select></label
								><label class="preview-field"
									>视图名称<input v-model="viewName"
								/></label>
								<div class="browse-result-toolbar">
									<UiButton @click="save">保存视图</UiButton
									><UiButton :disabled="!selectedPreset" @click="rename"
										>重命名</UiButton
									><UiButton :disabled="!selectedPreset" @click="remove"
										>删除视图</UiButton
									>
								</div>
								<p v-if="viewError" role="alert">{{ viewError }}</p>
								<p class="muted">
									相对期间随时间解析，自定义日期固定。视图保存到当前账户。
								</p>
							</fieldset>
							<UiButton @click="clear">重置导出设置</UiButton>
						</div>
					</section>
				</div>
			</template>
			<template #chips="{ openFilters, editFilter }">
				<BrowseChip
					v-if="periodChip"
					:label="periodChip.label"
					@edit="editFilter('period')"
					@remove="query.scope.period = { key: 'all', from: '', to: '' }"
				/>
				<BrowseChip
					v-if="relatedPeriodChip"
					:label="relatedPeriodChip.label"
					@edit="editFilter('relatedPeriod')"
					@remove="query.relatedPeriod = { key: 'all', from: '', to: '' }"
				/>
				<BrowseChip
					v-for="chip in scopeChips"
					:key="chip.key"
					:label="chip.label"
					@edit="editFilter(chip.field)"
					@remove="clearScopeField(query.scope, chip.field)"
				/>
				<BrowseChip
					v-for="(group, index) in query.groupBy"
					:key="`group:${index}:${group}`"
					:label="`第${index + 1}级分组：${groupLabels[group] || group}`"
					@edit="openFilters"
					@remove="
						query.groupBy = removeGroupByField(
							dataset,
							query.view,
							query.groupBy,
							index,
						)
					"
				/>
				<template v-for="chip in chips" :key="chip.key">
					<BrowseChip
						:label="chip.summary || chip.label"
						:removable="!chip.fixed"
						@edit="openFilters"
						@remove="Object.assign(query, chip.reset)"
					/>
				</template>
			</template>
		</BrowseToolbar>
		<p v-if="dataset === 'inventory' && query.view !== 'historical'" class="muted">
			当前库存快照（站点时间）：{{ siteDateTime(result.snapshot) }}
		</p>
		<p v-if="dataset === 'loans'" class="muted">
			按借出日期筛选；正常归还、损坏、遗失与未归还为当前结算余额。
		</p>
		<p v-if="dataset === 'inventory' && query.view === 'historical'">
			期初 + 流入 − 流出 + 有符号调整 = 期末。按 ERPNext 原生库存流水计算。
		</p>

		<p v-if="result.error" role="alert">{{ result.error }}</p>
		<div class="preview-browse-body">
			<aside
				v-if="sidebarOpen && sidebarAvailable && !isMobile"
				class="preview-filter-rail browse-filter-rail"
			>
				<h3>类别与仓库</h3>
				<BrowseFilters
					v-model="query.scope"
					:fields="['categories', 'warehouses']"
					hide-activity
				/>
			</aside>
			<section class="preview-browse-results surface form-section">
				<div class="compact-filter-toolbar report-results-heading">
					<h2>{{ definition.label }} · {{ result.total }} 行</h2>
					<FilterPanel label="排序" :context="panelContext" :active="active">
						<label class="preview-field"
							>排序依据<select v-model="query.sortBy">
								<option
									v-for="column in availableSortColumns"
									:key="column"
									:value="column"
								>
									{{ sortableColumnLabels[column] || column }}
								</option>
							</select></label
						>
						<label class="preview-field"
							>排序<select v-model="query.sort">
								<option value="asc">升序</option>
								<option value="desc">降序</option>
							</select></label
						>
					</FilterPanel>
				</div>
				<p v-if="result.loading" role="status">
					{{ result.tables.length ? "正在刷新，当前结果保留" : "正在加载结果…" }}
				</p>
				<p v-if="result.stale" role="status">上次结果 · 尚未更新</p>
				<p v-if="result.error" role="alert">
					{{ result.error }} <UiButton @click="refresh(true)">重试读取</UiButton>
				</p>
				<ReportTable
					v-if="mainTable"
					:table="mainTable"
					:preference-id="`reports.${query.dataset}.${query.view}.${mainTable.id}`"
					:total="mainTable.total"
					:loading="mainTable.loading"
					:initialized="mainTable.initialized"
					:error="mainTable.error"
					:sortable-columns="availableSortColumns"
					:sort-by="query.sortBy"
					:sort-direction="query.sort"
					:grouped="query.groupBy.length > 0"
					:group-pages="groups"
					@load-more="loadTable(mainTable, true)"
					@sort="sortReport"
					@retry="
						loadTable(
							mainTable,
							mainTable.initialized && mainTable.next !== null,
							true,
						)
					"
					@open-document="
						(doctype, name) => !result.stale && emit('openDocument', doctype, name)
					"
				/>
				<details
					v-for="table in result.tables.filter((row) => row.id !== result.main)"
					:key="table.id"
					:data-browse-details="'table:' + table.id"
					@toggle="($event.target as HTMLDetailsElement).open && loadTable(table)"
				>
					<summary>{{ table.label }} · {{ table.total }}</summary>
					<p v-if="table.loading && !table.initialized" role="status">正在读取明细…</p>
					<ReportTable
						:table="table"
						:preference-id="`reports.${query.dataset}.${query.view}.${table.id}`"
						:total="table.total"
						:loading="table.loading"
						:initialized="table.initialized"
						:error="table.error"
						@load-more="loadTable(table, true)"
						@retry="loadTable(table, table.initialized && table.next !== null, true)"
						@open-document="
							(doctype, name) => !result.stale && emit('openDocument', doctype, name)
						"
					/>
				</details>
			</section>
		</div>
		<details>
			<summary>字段说明</summary>
			<p v-if="dataset === 'activities'">
				物品与库位筛选通过关联单据和借用明细匹配活动；终身流动单据数保持完整。
			</p>
			<p>
				稳定编号与可读名称并列；空白实点表示未核对。单据状态单独分组，转移只计算一次逻辑明细。CSV
				选择一个平面表；XLSX
				包含适用汇总与明细。数据与导出均使用当前账户有权查看的完整范围。
			</p>
		</details>
	</section>
</template>
