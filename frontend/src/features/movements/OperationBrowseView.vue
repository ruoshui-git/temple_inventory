<script setup lang="ts">
import BrowseToolbar from "../../components/ui/BrowseToolbar.vue";
import Scanner from "../../components/Scanner.vue";
import Overlay from "../../components/ui/Overlay.vue";
import RelatedLoanPreview from "../loans/RelatedLoanPreview.vue";
import { nativeStatusLabel } from "../../lib/nativeLabels";
import { warehouseLabel } from "../../lib/warehouseLabel";
import { computed, ref, watch } from "vue";
import { useResponsiveLayout } from "../../composables/useResponsiveLayout";
import type { OperationBrowse, OperationGroup } from "./useOperationBrowse";
import type { ReportQuery } from "../../lib/reportContract";
import { movementLabels, scopeFilterChips } from "../../lib/filterPresentation";
import FilterButton from "../../components/ui/FilterButton.vue";
import UiButton from "../../components/ui/UiButton.vue";
import ReportTable from "../../components/ui/ReportTable.vue";
import QuantitySummary from "../../components/ui/QuantitySummary.vue";
import QuickExport from "../../components/QuickExport.vue";
import ItemGroup from "../../components/ItemGroup.vue";
import InventoryIcon from "../../components/InventoryIcon.vue";
import SortControl from "../../components/ui/SortControl.vue";
import { loanSummaryMetrics, movementSummaryMetrics } from "./movementSummary";
import OperationBrowseFilters from "./OperationBrowseFilters.vue";
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
	extraChips,
	dimension,
	analysis,
	details,
} = c;
const { isMobile } = useResponsiveLayout();
const filtersOpen = ref(false),
	scanOpen = ref(false);
const analysisOpen = ref(false);
const inspected = ref<OperationGroup>();
function inspect(row: OperationGroup) {
	inspected.value = row;
	void c.loadDetails(row);
}
watch([() => props.active, isMobile], () => {
	scanOpen.value = false;
	analysisOpen.value = false;
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
const dimensions: Record<string, string> = {
	category: "类别 / 单位",
	location: "来源位置 / 单位",
	activity: "活动",
	borrower: "借用方",
	month: "月份",
};
const scopeChips = computed(() => scopeFilterChips(scope.value, reference));
function removeScopeChip(chip: (typeof scopeChips.value)[number]) {
	const previous = scope.value[chip.field];
	if (Array.isArray(previous))
		Object.assign(scope.value, {
			[chip.field]: previous.filter((value) => value !== chip.value),
		});
	else Object.assign(scope.value, { [chip.field]: "" });
}
const analysisFields: Record<string, string> = {
	category: "category",
	location: "source_warehouse",
	activity: "activity_title",
	borrower: "borrower",
	month: "month",
};
const sortState = (field: string) =>
	query.value.sortBy === field
		? query.value.sort === "asc"
			? "ascending"
			: "descending"
		: "none";
const sortFields = computed(() =>
	props.family === "loans" && !props.records
		? [
				{ value: "name", label: "物品名称" },
				{ value: "quantity", label: "数量" },
			]
		: [{ value: "date", label: "日期" }],
);
const sortGlyph = (field: string) =>
	query.value.sortBy === field ? (query.value.sort === "asc" ? "↑" : "↓") : "↕";
function sortRecords(field: string) {
	if (query.value.sortBy === field)
		query.value.sort = query.value.sort === "asc" ? "desc" : "asc";
	else {
		query.value.sortBy = field as "date";
		query.value.sort = "asc";
	}
}
const metrics = computed(() => {
	if (props.family === "movements") {
		return movementSummaryMetrics(result.totals);
	}
	return loanSummaryMetrics(result.totals, props.records);
});
function quantities(rows?: { uom: string; qty: number }[]) {
	return rows?.map((row) => `${row.qty} ${row.uom}`).join(" | ") || "—";
}
function itemTotals(row: OperationGroup) {
	const groups =
		props.family === "movements"
			? movementSummaryMetrics(row.totals || [])
			: loanSummaryMetrics(row.totals || [], false);
	return groups
		.map(
			(group) =>
				`${group.label} ${group.quantities
					.map(
						(quantity) =>
							`${quantity.qty} ${quantity.uom}${quantity.status ? ` · ${quantity.status}` : ""}`,
					)
					.join(" | ")}`,
		)
		.join(" · ");
}
function matching(row: OperationGroup) {
	const totals = [...(row.matching_totals || [])].sort((a, b) =>
		String(a.stock_uom).localeCompare(String(b.stock_uom), "zh-CN"),
	);
	const grouped = new Map<string, number>();
	for (const total of totals) {
		const uom = String(total.stock_uom);
		grouped.set(
			uom,
			(grouped.get(uom) || 0) +
				Number(props.family === "loans" ? total.outstanding : total.stock_qty),
		);
	}
	const detail = [...grouped].map(([uom, qty]) => `${qty} ${uom}`).join(" | ");
	if (!detail) return "—";
	const label =
		props.family === "loans"
			? "未归还"
			: movementLabels[row.kind || ""] || row.kind || "货物流动";
	return `${label} ${detail}`;
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
				:summary="family === 'movements' ? '货物流动' : '借用'"
				:active="active"
				:filter-count="extraChips.length + scopeFilterChips(scope, reference).length"
				@scan="scanOpen = true"
				@filters="filtersOpen = !filtersOpen"
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
					><FilterButton
						:expanded="filtersOpen"
						:count="extraChips.length + scopeFilterChips(scope, reference).length"
						@click="filtersOpen = !filtersOpen"
					/>
					<SortControl
						v-model:field="query.sortBy"
						v-model:direction="query.sort"
						:fields="sortFields"
						:label="family === 'loans' ? '借用排序' : '流动排序'"
					/>
				</div>
				<div v-if="scopeChips.length || extraChips.length" class="compact-filter-chips">
					<UiButton
						v-for="chip in scopeChips"
						:key="chip.key"
						variant="ghost"
						:aria-label="`移除${chip.label}`"
						@click="removeScopeChip(chip)"
						>{{ chip.label }} ×</UiButton
					>
					<UiButton
						v-for="chip in extraChips"
						:key="chip.key"
						variant="ghost"
						:aria-label="`移除${chip.label}`"
						@click="Object.assign(query, chip.reset)"
						>{{ chip.summary || chip.label }} ×</UiButton
					>
				</div>
				<p v-if="routeError" role="alert">{{ routeError }}</p>
				<p v-if="family === 'loans'" class="browse-note">
					按借出日期筛选，显示当前结清情况。<UiButton
						variant="ghost"
						@click="emit('browse', c.loanHistory())"
						>查看期间借还流动</UiButton
					>
				</p>
				<template #result-tools
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
				<p class="browse-result-count">
					筛选结果：{{ result.total }} {{ records ? "笔记录" : "种物品" }}
				</p>
				<QuantitySummary :metrics="metrics" :loading="result.loading || result.stale" />
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
			<Overlay
				v-if="filtersOpen && isMobile"
				title="筛选"
				drawer
				@close="filtersOpen = false"
			>
				<OperationBrowseFilters :controller="c" :family="family" :records="records" />
			</Overlay>
			<div class="preview-browse-body">
				<aside v-if="filtersOpen && !isMobile" class="preview-filter-rail">
					<h3>筛选{{ family === "movements" ? "货物流动" : "借用" }}</h3>
					<OperationBrowseFilters :controller="c" :family="family" :records="records" />
				</aside>
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
								><span>{{ itemTotals(row) }}</span></template
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
									<th :aria-sort="sortState('date')">
										<button @click="sortRecords('date')">
											类型 / 日期 {{ sortGlyph("date") }}
										</button>
									</th>
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
												>整单 {{ row.whole?.item_count }} 种物品 ·
												{{ row.allocation_count }} 条符合筛选的明细</small
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
											>筛选内数量 · 整单
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
											>符合筛选的明细</UiButton
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
									整单 {{ row.whole?.item_count }} 种物品 ·
									{{ row.allocation_count }} 条符合筛选的明细
								</p></button
							><UiButton
								v-if="row.docstatus === 1 && row.whole?.loan_status === 'Open'"
								:disabled="result.stale || !reference.operations.Return"
								@click="emit('settle', String(row.document))"
								>登记归还</UiButton
							>
							<UiButton :disabled="result.stale" @click="inspect(row)"
								>符合筛选的明细</UiButton
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
						>加载更多</UiButton
					>
				</div>
			</div>
		</div>
		<Overlay
			v-if="inspected"
			title="符合筛选的明细"
			adaptive-creation
			@close="inspected = undefined"
		>
			<p class="preview-long-text">
				{{ inspected.document || inspected.item_name }} ·
				{{ movementLabels[inspected.kind || ""] || "" }} · {{ inspected.date || "" }} ·
				{{ nativeStatusLabel(inspected.docstatus) }} · 筛选内数量
				{{ matching(inspected) }} · 整单 {{ quantities(inspected.whole?.quantities) }}
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
