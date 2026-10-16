<script setup lang="ts">
import { computed, onActivated, ref, watch } from "vue";
import PreviewOverlay from "./PreviewOverlay.vue";
import PreviewResultState from "./components/PreviewResultState.vue";
import PreviewUiButton from "./components/PreviewUiButton.vue";
import PreviewSearchSelect from "./components/PreviewSearchSelect.vue";
import PreviewPeriodFilter from "./components/PreviewPeriodFilter.vue";
import PreviewCompactFilters from "./components/PreviewCompactFilters.vue";
import PreviewFilterPanel from "./components/PreviewFilterPanel.vue";
import {
	reportFilterChips,
	hasReportStatuses,
	clearReportSecondaryFilters,
} from "./reportFilters";
import PreviewQuickReport from "./components/PreviewQuickReport.vue";
import PreviewReportTable from "./components/PreviewReportTable.vue";
import {
	reportDefinitions,
	reportGroupingChoices,
	reportStates,
	reportWorkspace,
	projectReport,
	groupLabels,
	newReportQuery,
	namedReportViews,
	saveReportView,
	renameReportView,
	type ReportDataset,
} from "./reportModel";
import { reviewSession } from "./reviewModel";
import { activityTypes } from "./activityData";
const props = withDefaults(defineProps<{ page: string; variant: string; active?: boolean }>(), {
	active: true,
});
const emit = defineEmits<{
	navigate: [page: string, variant: string];
	notify: [message: string];
}>();
const dataset = ref<ReportDataset>(reportWorkspace.dataset);
const query = computed(() => reportStates[dataset.value]);
const contextVersion = ref(0);
const panelContext = computed(
	() => `${dataset.value}/${query.value.view}/${props.variant}/${contextVersion.value}`,
);
const chips = computed(() => reportFilterChips(query.value));
const extraCount = computed(() => chips.value.filter((chip) => !chip.fixed).length);
const movementFilters = computed(
	() =>
		dataset.value === "movements" ||
		(dataset.value === "activities" && query.value.view === "records"),
);
const definition = computed(() => reportDefinitions[dataset.value]);
const result = computed(() => projectReport(query.value));
const selectedHistorical = ref("");
const historyDrill = computed(() => result.value.tables.find((table) => table.id === "ledger"));
const limit = ref(30),
	viewName = ref(""),
	error = ref(""),
	selectedPreset = ref("");
function enter() {
	if (reportWorkspace.incoming) {
		const incoming = reportWorkspace.incoming;
		contextVersion.value++;
		dataset.value = incoming.dataset;
		Object.assign(reportStates[incoming.dataset], incoming);
		reportWorkspace.incoming = undefined;
	} else if (props.variant in reportDefinitions) dataset.value = props.variant as ReportDataset;
}
watch(() => props.variant, enter, { immediate: true });
onActivated(enter);
watch(dataset, (value) => {
	reportWorkspace.dataset = value;
	limit.value = 30;
});
watch(
	() => query.value.view,
	(view) => {
		if (!reportGroupingChoices(query.value).includes(query.value.grouping))
			query.value.grouping = "none";
		if (view === "historical" && query.value.scope.period.key === "all")
			query.value.scope.period = { key: "this_month", from: "", to: "" };
	},
);
function save() {
	error.value = saveReportView(viewName.value, query.value);
	if (!error.value) {
		viewName.value = "";
		emit("notify", "视图已保存在本次预览会话");
	}
}
function usePreset() {
	const preset = namedReportViews.find((row) => String(row.id) === selectedPreset.value);
	if (preset) {
		dataset.value = preset.query.dataset;
		Object.assign(query.value, JSON.parse(JSON.stringify(preset.query)));
		viewName.value = preset.name;
		contextVersion.value++;
	}
}
function rename() {
	error.value = renameReportView(Number(selectedPreset.value), viewName.value);
}
function remove() {
	const index = namedReportViews.findIndex((row) => String(row.id) === selectedPreset.value);
	if (index >= 0) namedReportViews.splice(index, 1);
	selectedPreset.value = "";
}
function clear() {
	contextVersion.value++;
	Object.assign(query.value, newReportQuery(dataset.value));
}
function openDocument(id: string) {
	if (id.startsWith("HIST-")) {
		selectedHistorical.value = id;
		return;
	}
	reviewSession.selectedMovementName = id;
	emit("navigate", "movement-records", "selected");
}
</script>
<template>
	<section class="preview-page preview-reports">
		<header class="browse-heading">
			<div>
				<span class="eyebrow">REPORTS / 分析</span>
				<h1>报表</h1>
				<p class="muted">完整筛选范围 · 数量按单位与状态分别列示</p>
			</div>
			<PreviewQuickReport
				:query="query"
				:active="active"
				@navigate="(page, variant) => emit('navigate', page, variant)"
				@notify="emit('notify', $event)"
			/>
		</header>
		<section class="surface form-section">
			<div class="report-inline-controls">
				<label class="preview-field"
					>数据集<select v-model="dataset">
						<option
							v-for="(definition, id) in reportDefinitions"
							:key="id"
							:value="id"
						>
							{{ definition.label }}
						</option>
					</select></label
				><label class="preview-field"
					>视图<select v-model="query.view">
						<option v-for="view in definition.views" :key="view.id" :value="view.id">
							{{ view.label }}
						</option>
					</select></label
				><label class="preview-field"
					>搜索<input v-model="query.search" placeholder="搜索完整结果"
				/></label>
				<PreviewPeriodFilter
					v-if="
						(dataset !== 'inventory' || query.view === 'historical') &&
						(dataset !== 'expiry' || query.expiryWindow === 'period')
					"
					v-model="query.scope.period"
					:label="definition.dateLabel"
					:context="panelContext"
					:active="active"
				/>
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
				<PreviewUiButton @click="clear">重置报表</PreviewUiButton>
			</div>
			<p v-if="dataset === 'inventory' && query.view !== 'historical'" class="muted">
				当前库存快照：{{ result.snapshot }}
			</p>

			<p v-if="dataset === 'loans'" class="muted">
				按借出日期筛选；正常归还、损坏、遗失与未归还为当前结算余额。
			</p>
			<p v-if="dataset === 'inventory' && query.view === 'historical'">
				期初 + 流入 − 流出 + 有符号调整 = 期末。使用独立权威账本样本；不从当前库存倒推。
			</p>
			<div
				v-if="dataset === 'activities' && query.view === 'records'"
				class="report-inline-controls"
			>
				<PreviewPeriodFilter
					v-model="query.relatedPeriod"
					label="关联单据记账日期"
					:context="panelContext"
					:active="active"
				/><label class="preview-field"
					>关联记录搜索<input v-model="query.relatedSearch"
				/></label>
			</div>

			<PreviewCompactFilters
				v-model="query.scope"
				:hide-activity="['inventory', 'expiry', 'counts'].includes(dataset)"
				:movement="movementFilters"
				records
				:result-count="result.count"
				:extra-count="extraCount"
				:context="panelContext"
				:active="active"
				@clear="clearReportSecondaryFilters(query)"
			>
				<fieldset v-if="hasReportStatuses(query)">
					<legend>单据状态</legend>
					<label
						v-for="(label, status) in ['草稿', '已提交', '已取消']"
						:key="status"
						class="preview-choice-label"
						><input type="checkbox" v-model="query.statuses" :value="status" />{{
							label
						}}</label
					>
				</fieldset>
				<label
					v-if="['inventory', 'expiry'].includes(dataset)"
					class="preview-choice-label"
					><input type="checkbox" v-model="query.includeZero" />包含零库存</label
				><label v-if="dataset === 'expiry'" class="preview-choice-label"
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
					><PreviewSearchSelect
						label="活动类型"
						v-model="query.typeId"
						:options="
							activityTypes.map((row) => ({ value: row.id, label: row.label }))
						"
				/></template>
				<label v-if="dataset === 'counts'" class="preview-field"
					>核对状态<select v-model="query.countReviewed">
						<option value="all">全部行</option>
						<option value="reviewed">已核对</option>
						<option value="unreviewed">未核对</option>
					</select></label
				>

				<template #chips>
					<template v-for="chip in chips" :key="chip.key">
						<span v-if="chip.fixed" class="compact-filter-indicator">{{
							chip.label
						}}</span>
						<span v-else-if="chip.summary" class="compact-filter-chip-group">
							<PreviewFilterPanel
								:label="chip.summary"
								:context="panelContext"
								:active="active"
							>
								<p>{{ chip.label }}</p>
							</PreviewFilterPanel>
							<PreviewUiButton
								variant="ghost"
								:aria-label="`移除${chip.label}`"
								@click="Object.assign(query, chip.reset)"
							>
								<span aria-hidden="true">×</span>
							</PreviewUiButton>
						</span>
						<PreviewUiButton
							v-else
							variant="ghost"
							:aria-label="`移除${chip.label}`"
							@click="Object.assign(query, chip.reset)"
							>{{ chip.label }} <span aria-hidden="true">×</span></PreviewUiButton
						>
					</template>
				</template>
				<template #actions>
					<PreviewFilterPanel
						label="个人命名视图 · 本次会话"
						:context="panelContext"
						:active="active"
					>
						<div class="preview-filter-fields">
							<label class="preview-field"
								>已保存视图<select v-model="selectedPreset" @change="usePreset">
									<option value="">选择视图</option>
									<option
										v-for="view in namedReportViews"
										:key="view.id"
										:value="String(view.id)"
									>
										{{ view.name }}
									</option>
								</select></label
							><label class="preview-field"
								>视图名称<input v-model="viewName" /></label
							><PreviewUiButton @click="save">保存视图</PreviewUiButton
							><PreviewUiButton :disabled="!selectedPreset" @click="rename"
								>重命名</PreviewUiButton
							><PreviewUiButton :disabled="!selectedPreset" @click="remove"
								>删除视图</PreviewUiButton
							>
						</div>
						<p v-if="error" role="alert">{{ error }}</p>
						<p class="muted">
							相对期间随时间解析，自定义日期固定。刷新预览会话后重置。
						</p>
					</PreviewFilterPanel>
				</template>
			</PreviewCompactFilters>
		</section>
		<PreviewOverlay
			v-if="selectedHistorical && historyDrill"
			:title="'贡献单据 ' + selectedHistorical"
			@close="selectedHistorical = ''"
		>
			<PreviewReportTable
				:table="{
					...historyDrill,
					rows: historyDrill.rows.filter((row) => row.documentId === selectedHistorical),
				}"
			/>
			<p>独立账本样本中的贡献行。转移的来源与去向在合并范围内净额为零。</p>
		</PreviewOverlay>
		<p v-if="result.error" role="alert">{{ result.error }}</p>
		<section class="surface form-section">
			<div class="compact-filter-toolbar report-results-heading">
				<h2>{{ definition.label }} · {{ result.count }} 行</h2>
				<PreviewFilterPanel
					:label="`分组：${groupLabels[query.grouping] || query.grouping}`"
					:context="panelContext"
					:active="active"
				>
					<label class="preview-field"
						>分组<select v-model="query.grouping">
							<option value="none">不分组</option>
							<option
								v-for="group in reportGroupingChoices(query)"
								:key="group"
								:value="group"
							>
								{{ groupLabels[group] }}
							</option>
						</select></label
					>
				</PreviewFilterPanel>
				<PreviewFilterPanel label="排序" :context="panelContext" :active="active">
					<label class="preview-field"
						>排序依据<select v-model="query.sortBy">
							<option value="identity">编号</option>
							<option value="date">日期</option>
							<option v-if="dataset === 'activities'" value="modified">
								更新时间
							</option>
							<option value="name">名称</option>
							<option value="quantity">数量</option>
						</select></label
					>
					<label class="preview-field"
						>排序<select v-model="query.sort">
							<option value="asc">升序</option>
							<option value="desc">降序</option>
						</select></label
					>
				</PreviewFilterPanel>
			</div>
			<PreviewResultState :total="result.count">
				<PreviewReportTable :table="result.tables[0]!" :limit="limit" /><PreviewUiButton
					v-if="result.count > limit"
					@click="limit += 30"
					>加载更多</PreviewUiButton
				>
				<details v-for="table in result.tables.slice(1)" :key="table.id">
					<summary>{{ table.label }} · {{ table.rows.length }}</summary>
					<PreviewReportTable :table="table" />
					<div class="form-actions">
						<PreviewUiButton
							v-for="id in [
								...new Set(
									table.rows
										.map((row) => String(row.documentId || ''))
										.filter(Boolean),
								),
							]"
							:key="id"
							@click="openDocument(id)"
							>查看 {{ id }}</PreviewUiButton
						>
					</div>
				</details>
			</PreviewResultState>
		</section>
		<details>
			<summary>字段说明</summary>
			<p v-if="dataset === 'activities'">
				物品与库位筛选通过关联单据和借用明细匹配活动；终身流动单据数保持完整。
			</p>
			<p>
				稳定编号与可读名称并列；空白实点表示未核对。单据状态单独分组，转移只计算一次逻辑分配。CSV
				选择一个平面表；XLSX 包含适用汇总与明细。预览不代表生产权限或导出完整性。
			</p>
		</details>
	</section>
</template>
