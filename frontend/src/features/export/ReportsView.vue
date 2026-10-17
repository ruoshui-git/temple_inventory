<script setup lang="ts">
import { siteDateTime } from "../../lib/nativeTime";
import UiButton from "../../components/ui/UiButton.vue";
import SearchSelect from "../../components/ui/SearchSelect.vue";
import PeriodFilter from "../../components/ui/PeriodFilter.vue";
import CompactFilters from "../../components/filters/CompactFilters.vue";
import FilterPanel from "../../components/ui/FilterPanel.vue";
import QuickExport from "../../components/QuickExport.vue";
import ReportTable from "../../components/ui/ReportTable.vue";
import { groupLabels, reportDefinitions } from "../../lib/reportContract";
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
	extraCount,
	movementFilters,
	reference,
	viewName,
	selectedPreset,
	usePreset,
	save,
	clear,
	rename,
	remove,
	clearSecondary,
	namedViews,
	viewError,
	viewBusy,
	loadTable,
	mainTable,
	refresh,
} = props.controller;
</script>
<template>
	<section class="preview-page preview-reports">
		<p v-if="routeError" role="alert">{{ routeError }}</p>
		<header class="browse-heading">
			<div>
				<h1>导出</h1>
				<p class="muted">完整筛选范围 · 数量按单位与状态分别列示</p>
			</div>
			<QuickExport :query="query" :active="active" @open-full="emit('openExport', $event)" />
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
				<PeriodFilter
					:today="reference.siteDate"
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
				<UiButton @click="clear">重置导出设置</UiButton>
			</div>
			<p v-if="dataset === 'inventory' && query.view !== 'historical'" class="muted">
				当前库存快照（站点时间）：{{ siteDateTime(result.snapshot) }}
			</p>

			<p v-if="dataset === 'loans'" class="muted">
				按借出日期筛选；正常归还、损坏、遗失与未归还为当前结算余额。
			</p>
			<p v-if="dataset === 'inventory' && query.view === 'historical'">
				期初 + 流入 − 流出 + 有符号调整 = 期末。按 ERPNext 原生库存流水计算。
			</p>
			<div
				v-if="dataset === 'activities' && query.view === 'records'"
				class="report-inline-controls"
			>
				<PeriodFilter
					:today="reference.siteDate"
					v-model="query.relatedPeriod"
					label="关联单据记账日期"
					:context="panelContext"
					:active="active"
				/><label class="preview-field"
					>关联记录搜索<input v-model="query.relatedSearch"
				/></label>
			</div>

			<CompactFilters
				v-model="query.scope"
				:hide-activity="['inventory', 'expiry', 'counts'].includes(dataset)"
				:movement="movementFilters"
				records
				:result-count="result.total"
				:extra-count="extraCount"
				:context="panelContext"
				:active="active"
				@clear="clearSecondary()"
			>
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

				<template #chips>
					<template v-for="chip in chips" :key="chip.key">
						<span v-if="chip.fixed" class="compact-filter-indicator">{{
							chip.label
						}}</span>
						<span v-else-if="chip.summary" class="compact-filter-chip-group">
							<FilterPanel
								:label="chip.summary"
								:context="panelContext"
								:active="active"
							>
								<p>{{ chip.label }}</p>
							</FilterPanel>
							<UiButton
								variant="ghost"
								:aria-label="`移除${chip.label}`"
								@click="Object.assign(query, chip.reset)"
							>
								<span aria-hidden="true">×</span>
							</UiButton>
						</span>
						<UiButton
							v-else
							variant="ghost"
							:aria-label="`移除${chip.label}`"
							@click="Object.assign(query, chip.reset)"
							>{{ chip.label }} <span aria-hidden="true">×</span></UiButton
						>
					</template>
				</template>
				<template #actions>
					<FilterPanel label="个人命名视图" :context="panelContext" :active="active">
						<div class="preview-filter-fields">
							<label class="preview-field"
								>已保存视图<select v-model="selectedPreset" @change="usePreset">
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
								>视图名称<input v-model="viewName" /></label
							><UiButton @click="save">保存视图</UiButton
							><UiButton :disabled="!selectedPreset" @click="rename">重命名</UiButton
							><UiButton :disabled="!selectedPreset" @click="remove"
								>删除视图</UiButton
							>
						</div>
						<p v-if="viewError" role="alert">{{ viewError }}</p>
						<p class="muted">
							相对期间随时间解析，自定义日期固定。视图保存到当前账户。
						</p>
					</FilterPanel>
				</template>
			</CompactFilters>
		</section>
		<p v-if="result.error" role="alert">{{ result.error }}</p>
		<section class="surface form-section">
			<div class="compact-filter-toolbar report-results-heading">
				<h2>{{ definition.label }} · {{ result.total }} 行</h2>
				<FilterPanel
					:label="`分组：${groupLabels[query.grouping] || query.grouping}`"
					:context="panelContext"
					:active="active"
				>
					<label class="preview-field"
						>分组<select v-model="query.grouping">
							<option value="none">不分组</option>
							<option v-for="group in definition.groups" :key="group" :value="group">
								{{ groupLabels[group] }}
							</option>
						</select></label
					>
				</FilterPanel>
				<FilterPanel label="排序" :context="panelContext" :active="active">
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
				</FilterPanel>
			</div>
			<p v-if="result.loading" role="status">
				{{ result.tables.length ? "正在刷新，当前结果保留" : "正在加载结果…" }}
			</p>
			<p v-if="result.stale" role="status">上次结果 · 尚未更新</p>
			<p v-if="result.error" role="alert">
				{{ result.error }} <UiButton @click="refresh">重试读取</UiButton>
			</p>
			<ReportTable
				v-if="mainTable"
				:table="mainTable"
				:total="mainTable.total"
				:loading="mainTable.loading"
				:initialized="mainTable.initialized"
				:error="mainTable.error"
				@load-more="loadTable(mainTable, true)"
				@retry="loadTable(mainTable, mainTable.initialized)"
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
					:total="table.total"
					:loading="table.loading"
					:initialized="table.initialized"
					:error="table.error"
					@load-more="loadTable(table, true)"
					@retry="loadTable(table, table.initialized)"
					@open-document="
						(doctype, name) => !result.stale && emit('openDocument', doctype, name)
					"
				/>
			</details>
		</section>
		<details>
			<summary>字段说明</summary>
			<p v-if="dataset === 'activities'">
				物品与库位筛选通过关联单据和借用明细匹配活动；终身流动单据数保持完整。
			</p>
			<p>
				稳定编号与可读名称并列；空白实点表示未核对。单据状态单独分组，转移只计算一次逻辑分配。CSV
				选择一个平面表；XLSX
				包含适用汇总与明细。数据与导出均使用当前账户有权查看的完整范围。
			</p>
		</details>
	</section>
</template>
