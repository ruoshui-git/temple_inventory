<script setup lang="ts">
import BrowseToolbar from "../../components/ui/BrowseToolbar.vue";
import Scanner from "../../components/Scanner.vue";
import Overlay from "../../components/ui/Overlay.vue";
import RelatedLoanPreview from "../loans/RelatedLoanPreview.vue";
import { nativeStatusLabel } from "../../lib/nativeLabels";
import { warehouseLabel } from "../../lib/warehouseLabel";
import { siteDateTime } from "../../lib/nativeTime";
import { computed, ref, watch } from "vue";
import { useResponsiveLayout } from "../../composables/useResponsiveLayout";
import type { OperationBrowse, OperationGroup } from "./useOperationBrowse";
import type { ReportQuery, ReportRow } from "../../lib/reportContract";
import { movementLabels, scopeFilterChips } from "../../lib/filterPresentation";
import PeriodFilter from "../../components/ui/PeriodFilter.vue";
import CompactFilters from "../../components/filters/CompactFilters.vue";
import UiButton from "../../components/ui/UiButton.vue";
import ReportTable from "../../components/ui/ReportTable.vue";
import QuantitySummary from "../../components/ui/QuantitySummary.vue";
import QuickExport from "../../components/QuickExport.vue";
import ItemGroup from "../../components/ItemGroup.vue";
import InventoryIcon from "../../components/InventoryIcon.vue";
const props = withDefaults(
	defineProps<{
		controller: OperationBrowse;
		family: "movements" | "loans";
		records: boolean;
		active?: boolean;
	}>(),
	{ active: true },
);
const emit = defineEmits<{
	switchView: [records: boolean, query: ReportQuery];
	openDocument: [doctype: string, name: string];
	openLoan: [name: string];
	settle: [name: string];
	openItem: [code: string];
	browse: [query: ReportQuery];
	openExport: [query: ReportQuery];
	newOperation: [kind: string];
}>();
const c = props.controller;
const {
	query,
	routeError,
	result,
	reference,
	scope,
	search,
	status,
	statusChoices,
	extraChips,
	dimension,
	analysis,
	details,
} = c;
const { isMobile } = useResponsiveLayout();
const filtersOpen = ref(false),
	scanOpen = ref(false);
const filters = ref<InstanceType<typeof CompactFilters>>();
const analysisOpen = ref(false),
	quantitiesOpen = ref(false);
const inspected = ref<OperationGroup>();
function inspect(row: OperationGroup) {
	inspected.value = row;
	void c.loadDetails(row);
}
watch([() => props.active, isMobile], () => {
	scanOpen.value = false;
	analysisOpen.value = false;
	quantitiesOpen.value = false;
	inspected.value = undefined;
	c.relatedLoans.close();
});
const outcomeLabels: Record<string, string> = {
	outstanding: "未归还",
	returned: "完好归还",
	damaged: "损坏归还",
	lost: "遗失",
};
const loanLabels: Record<string, string> = {
	Draft: "草稿",
	Cancelled: "已取消",
	Open: "未结清",
	Settled: "已结清",
};
const statusLabel = (value: unknown) =>
	Number(value) === 0 ? "草稿数量" : Number(value) === 2 ? "已取消数量" : "已提交数量";
const dimensions: Record<string, string> = {
	category: "类别 / 单位",
	location: "来源位置 / 单位",
	activity: "活动",
	borrower: "借用方",
	month: "月份",
};
const analysisFields: Record<string, string> = {
	category: "category",
	location: "source_warehouse",
	activity: "activity_title",
	borrower: "borrower",
	month: "month",
};
const sort = computed({
	get: () =>
		query.value.sortBy === "quantity"
			? "quantity"
			: query.value.sortBy === "name"
				? "name"
				: query.value.sort,
	set: (value: string) => {
		if (["name", "quantity"].includes(value)) {
			query.value.sortBy = value as "name" | "quantity";
			query.value.sort = value === "quantity" ? "desc" : "asc";
		} else {
			query.value.sortBy = "date";
			query.value.sort = value === "asc" ? "asc" : "desc";
		}
	},
});
const metrics = computed(() =>
	result.totals.map((row) => ({
		key: JSON.stringify([row.kind, row.outcome_key, row.docstatus, row.stock_uom]),
		label: `${props.family === "loans" && props.records ? (Number(row.docstatus) === 0 ? "计划借出" : "未归还") : familyLabel(row)} · ${statusLabel(row.docstatus)}`,
		quantities: [
			{
				uom: String(row.stock_uom),
				qty: Number(
					props.family === "loans" && props.records
						? Number(row.docstatus) === 0
							? row.borrowed
							: row.outstanding
						: row.stock_qty,
				),
			},
		],
		tone: "neutral" as const,
	})),
);
function familyLabel(row: ReportRow) {
	return props.family === "loans" && row.outcome_key
		? outcomeLabels[String(row.outcome_key)] || String(row.outcome_key)
		: movementLabels[String(row.kind)] || String(row.kind || "数量");
}
function quantities(rows?: { uom: string; qty: number }[]) {
	return rows?.map((row) => `${row.qty} ${row.uom}`).join(" · ") || "—";
}
function matching(row: OperationGroup) {
	return (
		row.matching_totals
			?.map(
				(total) =>
					`${props.family === "loans" ? total.outstanding : total.stock_qty} ${total.stock_uom}`,
			)
			.join(" · ") || "—"
	);
}
function openedRecord(row: OperationGroup) {
	if (result.stale) return;
	props.family === "loans"
		? emit("openLoan", String(row.document))
		: emit("openDocument", String(row.doctype), String(row.document));
}
</script>
<template>
	<section class="browse-page">
		<div class="preview-activity-browse">
			<BrowseToolbar
				:title="family === 'movements' ? '货物流动' : '借用'"
				v-model:search="search"
				:search-label="family === 'movements' ? '搜索货物流动' : '搜索借用'"
				:filters-open="filtersOpen"
				scannable
				:summary="`${family === 'movements' ? '货物流动' : '借用'} · ${result.initialized ? result.total : '读取中'}`"
				:active="active"
				:filter-count="extraChips.length + scopeFilterChips(scope, reference).length"
				@scan="scanOpen = true"
				@filters="filters?.show()"
			>
				<template #actions
					><QuickExport
						:query="query"
						:active="active"
						@open-full="emit('openExport', $event)"
					/><template v-if="family === 'movements'"
						><UiButton
							v-if="reference.operations.Receive"
							variant="primary"
							icon="box"
							@click="emit('newOperation', 'Receive')"
							>入库</UiButton
						><UiButton
							v-if="reference.operations.Issue"
							icon="movement"
							@click="emit('newOperation', 'Issue')"
							>出库</UiButton
						><UiButton
							v-if="reference.operations.Transfer"
							icon="movement"
							@click="emit('newOperation', 'Transfer')"
							>调拨</UiButton
						></template
					><UiButton
						v-else-if="reference.operations.Loan"
						variant="primary"
						icon="loan"
						@click="emit('newOperation', 'Loan')"
						>登记借出</UiButton
					></template
				>
				<nav
					class="browse-view-switch"
					:aria-label="family === 'movements' ? '货物流动视图' : '借用视图'"
				>
					<button
						:aria-current="!records ? 'page' : undefined"
						@click="emit('switchView', false, c.viewQuery(false))"
					>
						按物品</button
					><button
						:aria-current="records ? 'page' : undefined"
						@click="emit('switchView', true, c.viewQuery(true))"
					>
						按记录
					</button>
				</nav>
				<PeriodFilter
					:today="reference.siteDate"
					v-model="scope.period"
					:label="family === 'movements' ? '流动日期' : '借出日期'"
				/>
				<div
					v-if="family === 'movements'"
					class="browse-tabs browse-kind-tabs"
					role="group"
					aria-label="流动类型快捷筛选"
				>
					<button :aria-pressed="!scope.kinds.length" @click="scope.kinds = []">
						全部</button
					><button
						v-for="kind in ['Receive', 'Issue', 'Transfer']"
						:key="kind"
						:aria-pressed="scope.kinds.length === 1 && scope.kinds[0] === kind"
						@click="scope.kinds = [kind]"
					>
						{{ movementLabels[kind] }}</button
					><span v-if="scope.kinds.length > 1" class="chip"
						>多种类型 · {{ scope.kinds.length }}</span
					>
				</div>
				<div class="browse-toolbar">
					<label class="browse-search"
						><InventoryIcon name="search" /><input
							v-model="search"
							type="search"
							:aria-label="family === 'movements' ? '搜索货物流动' : '搜索借用'"
							:placeholder="
								family === 'movements'
									? '搜索物品、单号或活动'
									: '搜索借用人、活动或物品'
							" /></label
					><UiButton icon="scan" @click="scanOpen = true">扫码</UiButton
					><label v-if="records || family === 'loans'" class="preview-inline-field"
						>状态<select
							v-model="status"
							:aria-label="family === 'movements' ? '流动记录状态' : '借用状态'"
						>
							<option
								v-for="[value, label] in statusChoices"
								:key="value"
								:value="value"
							>
								{{ label }}
							</option>
						</select></label
					><select
						v-model="sort"
						:aria-label="family === 'movements' ? '流动日期排序' : '借用排序'"
					>
						<template v-if="family === 'loans' && !records"
							><option value="name">物品名称</option>
							<option value="quantity">数量由多到少</option></template
						><template v-else
							><option value="desc">日期由新到旧</option>
							<option value="asc">日期由旧到新</option></template
						>
					</select>
				</div>
				<CompactFilters
					ref="filters"
					v-model="scope"
					:movement="family === 'movements'"
					:records="records"
					:active="active"
					:extra-count="extraChips.length"
					:result-count="result.total"
					:context="`${family}/${records ? 'records' : 'items'}`"
					@clear="c.clearSecondary"
					@update:open="filtersOpen = $event"
					><template #chips
						><div class="preview-active-filters">
							<button
								v-for="chip in extraChips"
								:key="chip.key"
								class="chip"
								:title="chip.label"
								@click="Object.assign(query, chip.reset)"
							>
								{{ chip.summary || chip.label }} ×
							</button>
						</div></template
					></CompactFilters
				>
				<p v-if="routeError" role="alert">{{ routeError }}</p>
				<p v-if="family === 'loans'" class="browse-note">
					按借出日期筛选，显示当前结清情况。<UiButton
						variant="ghost"
						@click="emit('browse', c.loanHistory())"
						>查看期间借还流动</UiButton
					>
				</p>
				<p v-if="result.snapshot" class="browse-note">
					结果快照（站点时间） {{ siteDateTime(result.snapshot) }} · {{ result.total }}
					{{ records ? "笔记录" : family === "loans" ? "组物品" : "种物品" }} · 已显示
					{{ result.rows.length }}
				</p>
				<template #result-tools
					><span
						>{{ result.initialized ? result.total : "—" }}
						{{ records ? "笔记录" : "种物品" }}</span
					><UiButton v-if="result.initialized" @click="analysisOpen = true"
						>分析结果</UiButton
					></template
				></BrowseToolbar
			>
			<section
				v-if="result.initialized"
				class="preview-activity-summary"
				aria-label="当前筛选汇总"
				aria-live="polite"
			>
				<strong
					>{{ result.summary.document_count || 0 }} 笔记录 ·
					{{ result.summary.item_count || 0 }} 种物品 ·
					{{ result.summary.category_count || 0 }} 个类别</strong
				>
				<QuantitySummary :metrics="metrics.slice(0, 6)" />
				<UiButton v-if="metrics.length > 6" @click="quantitiesOpen = true"
					>查看数量明细</UiButton
				>
			</section>
			<p v-if="result.loading" role="status">
				{{ result.initialized ? "正在更新结果…" : "正在读取结果…" }}
			</p>
			<p v-if="result.stale" class="notice-bar warning" role="status">
				上次结果 · 尚未更新，相关操作暂停。
			</p>
			<p v-if="result.error" class="notice-bar danger" role="alert">
				{{ result.error }} <UiButton @click="c.retry">重试加载</UiButton>
			</p>
			<div class="preview-browse-body">
				<div class="preview-browse-results">
					<Overlay
						v-if="analysisOpen"
						title="分析当前结果"
						adaptive-creation
						@close="analysisOpen = false"
					>
						<label class="preview-field"
							>分组<select v-model="dimension">
								<option
									v-for="(label, value) in dimensions"
									:key="value"
									:value="value"
								>
									{{ label }}
								</option>
							</select></label
						>
						<ReportTable
							v-if="analysis"
							:table="{
								id: 'operation-analysis',
								label: '完整筛选分组',
								columns: [
									analysisFields[dimension]!,
									family === 'loans' ? 'outcome_key' : 'kind',
									'docstatus',
									'item_count',
									'document_count',
									'stock_qty',
									'stock_uom',
								],
								rows: analysis.rows,
							}"
							:total="analysis.total"
							:loading="analysis.loading"
							:initialized="analysis.initialized"
							:error="analysis.error"
							@load-more="c.moreAnalysis"
							@retry="c.moreAnalysis"
						/>
						<p v-else-if="result.loading" role="status">正在读取分析分组…</p>
						<p class="muted">
							基于完整筛选结果；一条记录涉及多个分组时，各组记录数不可相加。
						</p>
					</Overlay>
					<template v-if="!records"
						><ItemGroup
							v-for="row in result.rows"
							:key="row.id"
							:data-browse-row="row.id"
							:expanded="c.expanded.has(row.id)"
							:item="c.stockItem(row)"
							:name="row.item_name || row.item_code || ''"
							:context="`${row.item_code} · ${row.category || ''} · ${row.document_count} 笔记录 · 最近 ${row.date || ''}`"
							@expanded="c.toggle(row, $event)"
							><template #metrics
								><span v-if="family === 'loans'"
									>{{ outcomeLabels[row.outcome_key || ""] }} ·
									{{ row.totals?.[0]?.stock_qty || 0 }} {{ row.stock_uom }}</span
								><span
									v-else
									v-for="total in row.totals"
									:key="JSON.stringify(total)"
									>{{ movementLabels[String(total.kind)] || total.kind }}
									{{ total.stock_qty }} {{ total.stock_uom }} ·
									{{ statusLabel(total.docstatus) }}　</span
								></template
							><UiButton
								:disabled="result.stale"
								@click="emit('openItem', String(row.item_code))"
								>物品详情</UiButton
							><ReportTable
								v-if="details[row.id]"
								:table="details[row.id]!"
								:total="details[row.id]!.total"
								:loading="details[row.id]!.loading"
								:initialized="details[row.id]!.initialized"
								:error="details[row.id]!.error"
								@load-more="c.loadDetails(row, true)"
								@retry="c.loadDetails(row, details[row.id]!.initialized)"
								@open-document="
									(doctype, name) =>
										!result.stale &&
										(family === 'loans'
											? emit('openLoan', name)
											: emit('openDocument', doctype, name))
								"
								><template
									v-if="family === 'loans' && row.outcome_key === 'outstanding'"
									#actions="{ row: contribution }"
									><UiButton
										:disabled="result.stale || !reference.operations.Return"
										@click="emit('settle', String(contribution.original_loan))"
										>登记归还</UiButton
									></template
								></ReportTable
							>
							<p v-else class="muted">展开后读取完整的贡献记录。</p></ItemGroup
						></template
					>
					<div
						v-else-if="family === 'movements'"
						class="browse-table-wrap"
						data-browse-scroll="operations"
					>
						<table class="browse-table">
							<thead>
								<tr>
									<th>记录 / 物品</th>
									<th>类型 / 日期</th>
									<th>流向</th>
									<th>数量</th>
									<th>状态</th>
								</tr>
							</thead>
							<tbody>
								<tr
									v-for="row in result.rows"
									:key="row.id"
									:data-browse-row="row.id"
								>
									<td>
										<button
											class="browse-row-link"
											:disabled="result.stale"
											@click="openedRecord(row)"
										>
											{{ row.document
											}}<small
												>全单 {{ row.whole?.item_count }} 种物品 ·
												{{ row.allocation_count }} 行分配匹配</small
											></button
										><UiButton
											v-if="row.whole?.original_loans?.length"
											:disabled="result.stale"
											@click="c.relatedLoans.show(row.whole.original_loans)"
										>
											{{
												row.whole.original_loans.length === 1
													? "查看关联借出"
													: `关联借出（${row.whole.original_loans.length}）`
											}}</UiButton
										>
									</td>
									<td>
										{{ movementLabels[row.kind || ""] || row.kind
										}}<small>{{ row.date }}</small>
									</td>
									<td>
										<div
											v-for="branch in row.whole?.branches"
											:key="JSON.stringify(branch)"
										>
											{{
												warehouseLabel(branch.source, reference.warehouses)
											}}
											→
											{{
												warehouseLabel(
													branch.destination,
													reference.warehouses,
												)
											}}
										</div>
									</td>
									<td>
										{{ matching(row)
										}}<small
											>匹配行数量 · 全单
											{{ quantities(row.whole?.quantities) }}</small
										>
									</td>
									<td>
										{{
											row.docstatus === 1
												? "已提交"
												: row.docstatus === 0
													? "草稿"
													: "已取消"
										}}
										<UiButton :disabled="result.stale" @click="inspect(row)"
											>匹配分配明细</UiButton
										>
									</td>
								</tr>
							</tbody>
						</table>
					</div>
					<div v-else class="browse-grid browse-grid--two">
						<article
							v-for="row in result.rows"
							:data-browse-row="row.id"
							:key="row.id"
							class="browse-card browse-loan-card"
						>
							<button
								class="browse-card-main"
								:disabled="result.stale"
								@click="openedRecord(row)"
							>
								<h2>{{ row.borrower || "未填写借用方" }}</h2>
								<span class="browse-badge">{{
									loanLabels[row.whole?.loan_status || ""] ||
									row.whole?.loan_status
								}}</span>
								<p>{{ row.document }} · 借出日期 {{ row.date }}</p>
								<p>{{ row.activity_title || "未关联活动" }}</p>
								<strong
									>{{ row.docstatus === 0 ? "草稿物品" : "尚未归还" }}
									{{
										quantities(
											row.docstatus === 0
												? row.whole?.quantities
												: row.whole?.outstanding,
										)
									}}</strong
								>
								<p>
									全单 {{ row.whole?.item_count }} 种物品 ·
									{{ row.allocation_count }} 行分配匹配
								</p></button
							><UiButton
								v-if="row.docstatus === 1 && row.whole?.loan_status === 'Open'"
								:disabled="result.stale || !reference.operations.Return"
								@click="emit('settle', String(row.document))"
								>登记归还</UiButton
							>
							<UiButton :disabled="result.stale" @click="inspect(row)"
								>匹配分配明细</UiButton
							>
						</article>
					</div>
					<div
						v-if="
							result.initialized &&
							!result.loading &&
							!result.error &&
							!result.rows.length
						"
						class="browse-empty"
					>
						<h2>没有匹配的{{ family === "loans" ? "借用" : "流动" }}记录</h2>
						<p>调整日期或筛选条件后重试。</p>
						<UiButton @click="c.reset">重置此页</UiButton>
					</div>
					<UiButton
						v-if="result.next !== null"
						:disabled="result.stale"
						:loading="result.loading"
						@click="c.load(true)"
						>加载更多 · {{ result.rows.length }} / {{ result.total }}</UiButton
					>
				</div>
			</div>
		</div>
		<Overlay
			v-if="inspected"
			title="匹配分配明细"
			adaptive-creation
			@close="inspected = undefined"
		>
			<p class="preview-long-text">
				{{ inspected.document || inspected.item_name }} ·
				{{ movementLabels[inspected.kind || ""] || "" }} · {{ inspected.date || "" }} ·
				{{ nativeStatusLabel(inspected.docstatus) }} · 匹配行 {{ matching(inspected) }} ·
				全单 {{ quantities(inspected.whole?.quantities) }}
			</p>
			<p v-if="result.stale" role="status">上次结果，正在更新；相关操作暂停。</p>
			<ReportTable
				v-if="details[inspected.id]"
				:table="details[inspected.id]!"
				:total="details[inspected.id]!.total"
				:initialized="details[inspected.id]!.initialized"
				:loading="details[inspected.id]!.loading"
				:error="details[inspected.id]!.error"
				:document-links="!result.stale"
				@load-more="c.loadDetails(inspected, true)"
				@retry="c.loadDetails(inspected, details[inspected.id]!.initialized)"
				@open-document="
					(doctype, name) => {
						if (!result.stale) {
							inspected = undefined;
							emit('openDocument', doctype, name);
						}
					}
				"
			/>
		</Overlay>
		<Overlay
			v-if="quantitiesOpen"
			title="当前筛选数量明细"
			adaptive-creation
			@close="quantitiesOpen = false"
			><QuantitySummary :metrics="metrics"
		/></Overlay>
		<RelatedLoanPreview
			:controller="c.relatedLoans"
			:disabled="result.stale"
			@open-full="emit('openLoan', $event)"
		/>
		<Scanner
			v-if="scanOpen"
			presentation="modal"
			@close="scanOpen = false"
			@scan="
				search = $event;
				scanOpen = false;
			"
		/>
	</section>
</template>
