<script setup lang="ts">
import DisclosureIcon from "../../components/ui/DisclosureIcon.vue";
import BrowseToolbar from "../../components/ui/BrowseToolbar.vue";
import BrowseChip from "../../components/ui/BrowseChip.vue";
import BrowseFilters from "../../components/filters/BrowseFilters.vue";
import { useFilterRailPreference } from "../../composables/useFilterRailPreference";
import { useResponsiveLayout } from "../../composables/useResponsiveLayout";
import { siteDateTime } from "../../lib/nativeTime";
import UiButton from "../../components/ui/UiButton.vue";
import BrowseRefreshNotice from "../../components/ui/BrowseRefreshNotice.vue";
import SearchSelect from "../../components/ui/SearchSelect.vue";
import PeriodFilter from "../../components/ui/PeriodFilter.vue";
import QuickExport from "../../components/QuickExport.vue";
import FilterRailEdge from "../../components/ui/FilterRailEdge.vue";
import BrowseSplitButton from "../../components/ui/BrowseSplitButton.vue";
import ReturnToTop from "../../components/ui/ReturnToTop.vue";
import ReportTable from "../../components/ui/ReportTable.vue";
import {
	groupLabels,
	groupSequencesForView,
	groupsForView,
	reportDefinitions,
	sortableColumnsForView,
} from "../../lib/reportContract";
import { nextGroupByField, removeGroupByField } from "../../lib/groupBy";
import { computed, ref } from "vue";
import { clearScopeField, scopeFilterFieldChips } from "../../lib/filterPresentation";
import { periodLabels, sitePeriodSummary } from "../../lib/sitePeriod";
import { hasReportStatuses } from "../../lib/reportFilters";
import type { useExportWorkspaceController } from "./useReportController";
import { operationLabels } from "../documents/operationCodec";
import { kindIcons } from "../../lib/kindIcons";
const props = withDefaults(
	defineProps<{
		controller: ReturnType<typeof useExportWorkspaceController>;
		active?: boolean;
	}>(),
	{ active: true },
);
const emit = defineEmits<{
	openDocument: [doctype: string, name: string];
	newOperation: [kind: string];
}>();
const quickExport = ref<InstanceType<typeof QuickExport>>();
const filterSheetOpen = ref(false);
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
const createOptions = computed(() =>
	(Object.keys(operationLabels) as (keyof typeof operationLabels)[])
		.filter((kind) => kind !== "Receive" && reference.operations[kind])
		.map((kind) => ({ kind, label: operationLabels[kind]!, icon: kindIcons[kind].icon })),
);
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
			@filter-open="filterSheetOpen = $event"
		>
			<template #actions>
				<QuickExport
					ref="quickExport"
					:query="query"
					:active="active"
					:preview="false"
					:matched-count="result.total"
					:tables="
						result.tables.map((table) => ({
							id: table.id,
							label: table.label,
							count: table.total,
						}))
					"
					:show-open-report="false"
					:show-trigger="false"
				/>
				<UiButton variant="primary" icon="export" @click="quickExport?.open()"
					>导出</UiButton
				>
			</template>
			<template #subtitle
				><p class="muted">按所选条件筛选；不同单位或状态的数量会分开显示。</p></template
			>
			<template #filters>
				<div class="browse-filter-mega reports-filter-mega">
					<section class="browse-filter-mega-section">
						<div class="preview-filter-fields">
							<details
								v-if="
									(dataset !== 'inventory' || query.view === 'historical') &&
									(dataset !== 'expiry' || query.expiryWindow === 'period')
								"
								class="browse-filter-disclosure"
								data-filter-field="period"
							>
								<summary class="ti-disclosure">
									<DisclosureIcon variant="inline" />
									{{ definition.dateLabel }}
									<small>{{
										sitePeriodSummary(query.scope.period, reference.siteDate)
									}}</small>
								</summary>
								<PeriodFilter
									:today="reference.siteDate"
									v-model="query.scope.period"
									:label="definition.dateLabel"
									field-key="period"
									embedded
								/>
							</details>
							<template v-if="dataset === 'activities' && query.view === 'records'">
								<details
									class="browse-filter-disclosure"
									data-filter-field="relatedPeriod"
								>
									<summary class="ti-disclosure">
										<DisclosureIcon variant="inline" />
										关联单据记账日期
										<small>{{
											sitePeriodSummary(
												query.relatedPeriod,
												reference.siteDate,
											)
										}}</small>
									</summary>
									<PeriodFilter
										:today="reference.siteDate"
										v-model="query.relatedPeriod"
										label="关联单据记账日期"
										field-key="relatedPeriod"
										embedded
									/>
								</details>
								<details
									class="browse-filter-disclosure"
									data-filter-field="relatedSearch"
								>
									<summary class="ti-disclosure">
										<DisclosureIcon variant="inline" />关联记录搜索<small>{{
											query.relatedSearch || "不限"
										}}</small>
									</summary>
									<label class="preview-field"
										>关联记录搜索<input v-model="query.relatedSearch"
									/></label>
								</details>
							</template>
							<details
								v-if="dataset === 'expiry'"
								class="browse-filter-disclosure"
								data-filter-field="expiryWindow"
							>
								<summary class="ti-disclosure">
									<DisclosureIcon variant="inline" />到期窗口<small>{{
										query.expiryWindow
									}}</small>
								</summary>
								<label class="preview-field"
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
							</details>
							<BrowseFilters
								v-model="query.scope"
								disclosure-mode
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
						<fieldset
							class="preview-filter-fields"
							data-filter-field="groupBy"
							tabindex="-1"
						>
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
							<details
								v-if="dataset === 'movements'"
								class="browse-filter-disclosure"
								data-filter-field="includeAdjustments"
							>
								<summary class="ti-disclosure">
									<DisclosureIcon variant="inline" />
									盘点调整
									<small>{{
										query.includeAdjustments ? "包括" : "不包括"
									}}</small>
								</summary>
								<label class="preview-choice-label"
									><input
										type="checkbox"
										v-model="query.includeAdjustments"
									/>包含期初与盘点调整</label
								>
							</details>
							<details
								v-if="hasReportStatuses(query)"
								class="browse-filter-disclosure"
								data-filter-field="status"
							>
								<summary class="ti-disclosure">
									<DisclosureIcon variant="inline" />
									单据状态
									<small>{{
										query.statuses
											.map((status) => ["草稿", "已提交", "已取消"][status])
											.join("、") || "未选择"
									}}</small>
								</summary>
								<fieldset>
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
							</details>
							<details
								v-if="
									['inventory', 'expiry'].includes(dataset) ||
									(dataset === 'loans' && query.view === 'items')
								"
								class="browse-filter-disclosure"
								data-filter-field="includeZero"
							>
								<summary class="ti-disclosure">
									<DisclosureIcon variant="inline" />
									{{ dataset === "loans" ? "已结清物品" : "零库存" }}
									<small>{{ query.includeZero ? "显示" : "隐藏" }}</small>
								</summary>
								<label class="preview-choice-label"
									><input type="checkbox" v-model="query.includeZero" />{{
										dataset === "loans" ? "显示已结清物品" : "包含零库存"
									}}</label
								>
							</details>
							<details
								v-if="dataset === 'expiry'"
								class="browse-filter-disclosure"
								data-filter-field="includeUndated"
							>
								<summary class="ti-disclosure">
									<DisclosureIcon variant="inline" />
									无效期批次
									<small>{{ query.includeUndated ? "包含" : "不包含" }}</small>
								</summary>
								<label class="preview-choice-label"
									><input
										type="checkbox"
										v-model="query.includeUndated"
									/>全部日期中包含无效期</label
								>
							</details>
							<template v-if="dataset === 'activities'">
								<details
									class="browse-filter-disclosure"
									data-filter-field="activityStatus"
								>
									<summary class="ti-disclosure">
										<DisclosureIcon variant="inline" />
										归档状态
										<small>{{
											query.activityStatus === "all"
												? "全部"
												: query.activityStatus === "active"
													? "进行中"
													: "已归档"
										}}</small>
									</summary>
									<label class="preview-field"
										>归档状态<select v-model="query.activityStatus">
											<option value="all">全部</option>
											<option value="active">进行中</option>
											<option value="archived">已归档</option>
										</select></label
									>
								</details>
								<details
									class="browse-filter-disclosure"
									data-filter-field="typeId"
								>
									<summary class="ti-disclosure">
										<DisclosureIcon variant="inline" />
										活动类型
										<small>{{
											reference.activityTypes.find(
												(option) => option.value === query.typeId,
											)?.label ||
											query.typeId ||
											"不限"
										}}</small>
									</summary>
									<SearchSelect
										label="活动类型"
										v-model="query.typeId"
										:options="reference.activityTypes"
									/>
								</details>
							</template>
							<details
								v-if="dataset === 'counts'"
								class="browse-filter-disclosure"
								data-filter-field="countReviewed"
							>
								<summary class="ti-disclosure">
									<DisclosureIcon variant="inline" />
									核对状态
									<small>{{
										query.countReviewed === "all"
											? "全部行"
											: query.countReviewed === "reviewed"
												? "已核对"
												: "未核对"
									}}</small>
								</summary>
								<label class="preview-field"
									>核对状态<select v-model="query.countReviewed">
										<option value="all">全部行</option>
										<option value="reviewed">已核对</option>
										<option value="unreviewed">未核对</option>
									</select></label
								>
							</details>
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
							<UiButton class="browse-filter-clear" @click="clear"
								>重置导出设置</UiButton
							>
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
		<div class="report-scope-controls" aria-label="报表范围">
			<label class="preview-field">
				报表数据集
				<select v-model="dataset" aria-label="报表数据集">
					<option v-for="(option, id) in reportDefinitions" :key="id" :value="id">
						{{ option.label }}
					</option>
				</select>
			</label>
			<label class="preview-field">
				视图
				<select v-model="query.view" aria-label="报表视图">
					<option v-for="view in definition.views" :key="view.id" :value="view.id">
						{{ view.label }}
					</option>
				</select>
			</label>
		</div>
		<p v-if="dataset === 'inventory' && query.view !== 'historical'" class="muted">
			当前库存快照（站点时间）：{{ siteDateTime(result.snapshot) }}
		</p>
		<p v-if="dataset === 'loans'" class="muted">
			按借出日期筛选；正常归还、损坏、遗失与未归还为当前结算余额。
		</p>
		<p v-if="dataset === 'inventory' && query.view === 'historical'">
			期初 + 流入 − 流出 + 有符号调整 = 期末。按 ERPNext 库存流水计算。
		</p>

		<p v-if="result.error" role="alert">{{ result.error }}</p>
		<div class="preview-browse-body">
			<aside
				v-if="sidebarOpen && sidebarAvailable && !isMobile"
				class="preview-filter-rail browse-filter-rail"
			>
				<div class="filter-rail-heading">
					<h3>类别与仓库</h3>
					<FilterRailEdge
						:open="true"
						:active="query.scope.categories.length + query.scope.warehouses.length > 0"
						@toggle="toggleSidebar"
					/>
				</div>
				<BrowseFilters
					v-model="query.scope"
					:fields="['categories', 'warehouses']"
					hide-activity
				/>
			</aside>
			<FilterRailEdge
				v-if="!sidebarOpen && sidebarAvailable && !isMobile"
				:open="false"
				:active="query.scope.categories.length + query.scope.warehouses.length > 0"
				@toggle="toggleSidebar"
			/>
			<section class="preview-browse-results surface form-section">
				<div class="compact-filter-toolbar report-results-heading">
					<h2>
						主表：{{ mainTable?.label || definition.label }} · {{ result.total }} 行
					</h2>
				</div>
				<div
					v-if="result.loading && !mainTable"
					class="report-initial-skeleton"
					role="status"
				>
					<span class="sr-only">结果准备中…</span>
					<div class="report-initial-skeleton-row" aria-hidden="true">
						<i v-for="column in 6" :key="column" />
					</div>
					<div
						v-for="row in 5"
						:key="row"
						class="report-initial-skeleton-row"
						aria-hidden="true"
					>
						<i v-for="column in 6" :key="column" />
					</div>
				</div>
				<BrowseRefreshNotice :show="result.refreshFailed" :retry="() => refresh(true)" />
				<p v-if="result.error && !result.refreshFailed" role="alert">
					{{ result.error }} <UiButton @click="refresh(true)">重试读取</UiButton>
				</p>
				<ReportTable
					v-if="mainTable"
					:table="mainTable"
					:preference-id="`reports.${query.dataset}.${query.view}.${mainTable.id}`"
					:total="mainTable.total"
					:loading="mainTable.loading || result.loading"
					:initialized="mainTable.initialized"
					:error="mainTable.error"
					:stale="result.stale"
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
				<p
					v-if="result.tables.some((row) => row.id !== result.main)"
					class="muted report-supplementary-note"
				>
					打开下方补充表可查看更多明细；导出对话框可选择要包含的工作表。
				</p>
				<details
					v-for="table in result.tables.filter((row) => row.id !== result.main)"
					:key="table.id"
					:data-browse-details="'table:' + table.id"
					@toggle="($event.target as HTMLDetailsElement).open && loadTable(table)"
				>
					<summary class="ti-disclosure">
						<DisclosureIcon variant="inline" />补充表：{{ table.label }} ·
						{{ table.total }} 条匹配结果
					</summary>
					<ReportTable
						:table="table"
						:preference-id="`reports.${query.dataset}.${query.view}.${table.id}`"
						:total="table.total"
						:loading="table.loading"
						:initialized="table.initialized"
						:error="table.error"
						:stale="result.stale"
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
			<summary class="ti-disclosure"><DisclosureIcon variant="inline" />字段说明</summary>
			<p v-if="dataset === 'activities'">
				物品与库位筛选通过关联单据和借用明细匹配活动；终身流动单据数保持完整。
			</p>
			<p>
				物品编号和名称会同时显示。盘点数量留空表示未核对；不同状态分别统计，调拨不会重复计算。CSV
				导出每次包含一张表；XLSX 可选择工作表和相关资料表。仅包含你有权查看的数据。
			</p>
		</details>
	</section>
	<ReturnToTop :active="active" :hidden="isMobile && filterSheetOpen" />
</template>
