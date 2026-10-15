<script setup lang="ts">
import PreviewResultState from "./components/PreviewResultState.vue";
import { computed, ref, watch, onActivated, onDeactivated } from "vue";
import { useResponsiveLayout } from "../composables/useResponsiveLayout";
import PreviewItemGroup from "./components/PreviewItemGroup.vue";
import PreviewFilterButton from "./components/PreviewFilterButton.vue";
import InventoryIcon from "../components/InventoryIcon.vue";
import PreviewUiButton from "./components/PreviewUiButton.vue";
import PreviewPeriodFilter from "./components/PreviewPeriodFilter.vue";
import PreviewBrowseFilters from "./components/PreviewBrowseFilters.vue";
import PreviewOverlay from "./PreviewOverlay.vue";
import {
	reviewSession,
	reviewMovementRows,
	type PreviewPage,
	type ReviewLoan,
} from "./reviewModel";
import {
	emptyScope,
	filterMovements,
	groupMovements,
	filterLoans,
	groupLoans,
	movementLabels,
	outcomes,
	remaining,
	loanStatus,
	quantityText,
	movementSummary,
} from "./browseModel";
const props = defineProps<{ family: "movement" | "loan"; records: boolean; variant: string }>();
const emit = defineEmits<{
	navigate: [page: PreviewPage, variant: string];
	movement: [name: string];
	loan: [name: string];
	return: [name: string];
	notify: [message: string];
}>();
const { isMobile } = useResponsiveLayout();
const filtersOpen = ref(false);
const resultLimit = ref(20);
const analysisDimension = ref("category");
const analysis = computed(() => {
	const result = new Map<string, { qty: number; records: Set<string>; items: Set<string> }>();
	const rows =
		props.family === "movement"
			? movementRows.value
			: loanSummaryGroups.value.flatMap((group) =>
					group.entries.map((entry) => ({
						code: group.code,
						qty: entry.qty,
						name: entry.loan.name,
						uom: group.uom,
						from: entry.line.location || "",
						kind: outcomes[group.outcome],
						activity: entry.loan.activity,
						borrower: entry.loan.borrower,
						date: entry.loan.loanDate,
						docstatus: entry.loan.status === "draft" ? 0 : 1,
					})),
				);
	for (const row of rows) {
		const dimension =
			analysisDimension.value === "category"
				? stockItem(row.code)?.category
				: analysisDimension.value === "location"
					? row.from
					: analysisDimension.value === "activity"
						? row.activity
						: analysisDimension.value === "borrower"
							? row.borrower
							: row.date.slice(0, 7);
		const label =
			props.family === "movement" ? movementLabels[row.kind] || row.kind : row.kind;
		const status = row.docstatus === 0 ? "草稿" : row.docstatus === 2 ? "已取消" : "已提交";
		const key = `${dimension || "未指定"} · ${label} · ${status} · ${row.uom}`;
		const group = result.get(key) || {
			qty: 0,
			records: new Set<string>(),
			items: new Set<string>(),
		};
		group.qty += row.qty;
		group.records.add(row.name);
		if (row.code) group.items.add(row.code);
		result.set(key, group);
	}
	return [...result.entries()];
});

const exportOpen = ref(false);
const exportFailed = ref(false);
const exportFormat = ref("CSV");
const exportDataset = ref("summary");
function openExport() {
	exportDataset.value = "summary";
	exportFailed.value = false;
	exportOpen.value = true;
}
const summary = computed(() => movementSummary(movementRows.value, reviewSession));
const loanSummaryGroups = computed(() =>
	groupLoans(loans.value, props.records ? "all" : status.value, reviewSession),
);
const loanSummary = computed(() => ({
	items: new Set(
		(props.records && status.value === "draft"
			? loans.value.flatMap((loan) => loan.lines)
			: loanSummaryGroups.value
		).map((row) => row.code),
	).size,
	outstanding: new Set(
		loanSummaryGroups.value
			.filter((row) => row.outcome === "outstanding")
			.flatMap((row) => row.entries.map((entry) => entry.loan.name)),
	).size,
	totals: Object.entries(outcomes).map(([key, label]) => ({
		label,
		text: quantityText(loanSummaryGroups.value.filter((row) => row.outcome === key)),
	})),
}));
const stockItem = (code: string) => reviewSession.stock.find((item) => item.code === code);
const categoriesFor = (codes: string[]) =>
	[...new Set(codes.map((code) => stockItem(code)?.category).filter(Boolean))].join("、");
const scope = computed({
	get: () =>
		props.family === "movement"
			? reviewSession.filters.movementScope
			: reviewSession.filters.loanScope,
	set: (value) => {
		if (props.family === "movement") reviewSession.filters.movementScope = value;
		else reviewSession.filters.loanScope = value;
	},
});
const search = computed({
	get: () =>
		props.family === "movement"
			? reviewSession.filters.movementItems.search
			: reviewSession.filters.loanItems.search,
	set: (value) => {
		if (props.family === "movement") reviewSession.filters.movementItems.search = value;
		else reviewSession.filters.loanItems.search = value;
	},
});
const sort = computed({
	get: () =>
		props.records
			? reviewSession.filters.movementRecords.sort
			: reviewSession.filters.movementItems.sort,
	set: (value) => {
		if (props.records) reviewSession.filters.movementRecords.sort = value;
		else reviewSession.filters.movementItems.sort = value;
	},
});
const kinds = computed(() =>
	Object.entries(movementLabels).filter(
		([kind]) => props.records || !["Opening", "Reconcile"].includes(kind),
	),
);
const statusChoices = computed(() =>
	props.family === "movement"
		? [
				["completed", "已提交"],
				["draft", "草稿"],
				["cancelled", "已取消"],
			]
		: props.records
			? [
					["all", "全部"],
					["open", "未结清"],
					["settled", "已结清"],
					["draft", "草稿"],
				]
			: [["all", "全部"], ...Object.entries(outcomes)],
);
function syncStatus() {
	if (
		props.family === "movement" &&
		props.records &&
		["completed", "draft", "cancelled"].includes(props.variant)
	)
		reviewSession.filters.movementRecords.status =
			props.variant as typeof reviewSession.filters.movementRecords.status;
	if (
		props.family === "loan" &&
		props.records &&
		["all", "open", "settled", "draft"].includes(props.variant)
	)
		reviewSession.filters.loanRecords.status =
			props.variant as typeof reviewSession.filters.loanRecords.status;
	if (
		props.family === "loan" &&
		!props.records &&
		["all", ...Object.keys(outcomes)].includes(props.variant)
	)
		reviewSession.filters.loanItems.status =
			props.variant as typeof reviewSession.filters.loanItems.status;
}
watch(() => [props.family, props.records, props.variant], syncStatus, { immediate: true });
onActivated(syncStatus);
onDeactivated(() => {
	filtersOpen.value = false;
	exportOpen.value = false;
});
const status = computed(() =>
	props.family === "movement"
		? reviewSession.filters.movementRecords.status
		: props.records
			? reviewSession.filters.loanRecords.status
			: reviewSession.filters.loanItems.status,
);
function setStatus(value: string) {
	emit(
		"navigate",
		props.family === "movement"
			? "movement-records"
			: props.records
				? "loan-records"
				: "loan-items",
		value,
	);
}
function switchView(records: boolean) {
	if (props.family === "movement") {
		if (!records)
			scope.value.kinds = scope.value.kinds.filter(
				(kind) => !["Opening", "Reconcile"].includes(kind),
			);
		emit(
			"navigate",
			records ? "movement-records" : "movement-items",
			records ? reviewSession.filters.movementRecords.status : "list",
		);
	} else
		emit(
			"navigate",
			records ? "loan-records" : "loan-items",
			records
				? reviewSession.filters.loanRecords.status
				: reviewSession.filters.loanItems.status,
		);
}
const movementRows = computed(() =>
	filterMovements(
		reviewMovementRows().filter((row) =>
			props.records
				? row.docstatus ===
					(status.value === "draft" ? 0 : status.value === "cancelled" ? 2 : 1)
				: row.docstatus === 1 && !["Opening", "Reconcile"].includes(row.kind),
		),
		scope.value,
		search.value,
		reviewSession,
	).sort((a, b) =>
		sort.value === "oldest" ? a.date.localeCompare(b.date) : b.date.localeCompare(a.date),
	),
);
const itemGroups = computed(() =>
	groupMovements(movementRows.value).sort((a, b) =>
		sort.value === "oldest"
			? a.latest.localeCompare(b.latest)
			: b.latest.localeCompare(a.latest),
	),
);
const movementRecords = computed(() =>
	[...new Set(movementRows.value.map((row) => row.name))].map((name) => ({
		name,
		row: movementRows.value.find((row) => row.name === name)!,
		lines: movementRows.value.filter((row) => row.name === name),
		allLines: reviewMovementRows().filter((row) => row.name === name),
	})),
);
const loans = computed(() => {
	const drafts: ReviewLoan[] = reviewSession.drafts
		.filter((row) => row.kind === "Loan" && row.status === "draft")
		.map((row) => ({
			name: row.name,
			borrower: row.borrower,
			activity: row.activity,
			loanDate: row.postingDate,
			status: "draft",
			lines: row.lines.map((line) => ({
				code: line.code,
				qty: line.qty,
				returned: 0,
				damaged: 0,
				lost: 0,
				location: line.sourceLocation || line.location,
				batch: line.batch,
			})),
		}));
	const source =
		props.records && status.value === "draft"
			? drafts
			: reviewSession.loans.filter((loan) => loan.status !== "draft");
	// Document settlement is evaluated on the complete loan before item/location filtering.
	const selected = source.filter(
		(loan) =>
			!props.records ||
			status.value === "all" ||
			status.value === "draft" ||
			(status.value === "open"
				? loan.lines.some((line) => remaining(line) > 0)
				: !loan.lines.some((line) => remaining(line) > 0)),
	);
	return filterLoans(selected, scope.value, search.value, reviewSession).sort((a, b) =>
		reviewSession.filters.loanRecords.sort === "oldest"
			? a.loanDate.localeCompare(b.loanDate)
			: b.loanDate.localeCompare(a.loanDate),
	);
});
const loanGroups = computed(() =>
	groupLoans(loans.value, status.value, reviewSession).sort((a, b) =>
		reviewSession.filters.loanItems.sort === "quantity"
			? b.qty - a.qty
			: a.name.localeCompare(b.name, "zh-CN"),
	),
);
const count = computed(() =>
	props.family === "movement"
		? props.records
			? movementRecords.value.length
			: itemGroups.value.length
		: props.records
			? loans.value.length
			: loanGroups.value.length,
);
watch(
	() => [scope.value, search.value, props.records, status.value],
	() => {
		resultLimit.value = 20;
	},
	{ deep: true },
);
const activeFilters = computed(() => [
	...scope.value.kinds.map((value) => ({
		key: "kinds" as const,
		value,
		label: movementLabels[value],
	})),
	...(["warehouses", "categories", "sources", "destinations"] as const).flatMap((key) =>
		scope.value[key].map((value) => ({
			key,
			value,
			label: `${{ warehouses: "位置", categories: "类别", sources: "来源", destinations: "去向" }[key]}：${value}`,
		})),
	),
	...(["item", "activity"] as const).flatMap((key) =>
		scope.value[key] ? [{ key, value: scope.value[key], label: scope.value[key] }] : [],
	),
]);
function removeFilter(key: (typeof activeFilters.value)[number]["key"], value: string) {
	if (key === "item" || key === "activity") scope.value[key] = "";
	else scope.value[key] = scope.value[key].filter((row) => row !== value);
}
function clear() {
	scope.value = emptyScope();
	search.value = "";
}
function loanHistory() {
	reviewSession.filters.movementScope = {
		...JSON.parse(JSON.stringify(scope.value)),
		kinds: ["Loan", "Return"],
	};
	reviewSession.filters.movementItems.search = search.value;
	reviewSession.filters.movementRecords.status = "completed";
	emit("navigate", "movement-records", "completed");
}
function itemName(code: string) {
	return reviewSession.stock.find((item) => item.code === code)?.name || code;
}
function loanQuantity(loan: ReviewLoan) {
	return quantityText(
		loan.lines.map((line) => ({
			qty: remaining(line),
			uom: reviewSession.stock.find((item) => item.code === line.code)?.uom || "",
		})),
	);
}
function completeLoanStatus(loan: ReviewLoan) {
	return loanStatus(reviewSession.loans.find((row) => row.name === loan.name) || loan);
}
const exportRows = computed(() =>
	props.family === "movement"
		? props.records
			? movementRecords.value.map(
					(record) =>
						`${record.name} · ${record.row.date} · ${[...new Set(record.lines.map((row) => movementLabels[row.kind]))].join(" / ")} · ${record.row.docstatus === 1 ? "已提交" : record.row.docstatus === 0 ? "草稿" : "已取消"} · ${record.lines.map((row) => row.itemName).join("、")} · ${categoriesFor(record.lines.map((row) => row.code))} · ${quantityText(record.lines)} · ${[...new Set(record.lines.map((row) => `${row.from} → ${row.to}`))].join("；")}`,
				)
			: itemGroups.value.map(
					(group) =>
						`${group.code} · ${group.name} · ${categoriesFor([group.code])} · ${group.totals.map((total) => `${movementLabels[total.kind]} ${total.text}`).join(" / ")} · ${group.count} 笔`,
				)
		: props.records
			? loans.value.map(
					(loan) =>
						`${loan.name} · ${loan.loanDate} · ${loan.borrower} · ${loan.activity} · ${completeLoanStatus(loan)} · 未归还 ${loanQuantity(loan)}`,
				)
			: loanGroups.value.map(
					(group) =>
						`${group.name} · ${outcomes[group.outcome]} ${group.qty} ${group.uom} · ${group.count} 笔`,
				),
);
const exportDetails = computed(() =>
	props.family === "movement"
		? movementRows.value.map(
				(row) =>
					`${row.name} · ${row.date} · ${movementLabels[row.kind]} · ${row.itemName} · ${row.qty} ${row.uom} · ${row.from} → ${row.to} · 批次 ${row.batch || "无"}${row.entryUom ? ` · 输入 ${row.entryQty} ${row.entryUom} · 1 ${row.entryUom} = ${row.conversionFactor} ${row.uom}` : ""}`,
			)
		: props.records
			? loans.value.flatMap((loan) =>
					loan.lines.map(
						(line) =>
							`${loan.name} · ${loan.borrower} · ${loan.loanDate} · ${itemName(line.code)} · 借出 ${line.qty} · 未归还 ${remaining(line)} · 已归还 ${line.returned} · 损坏 ${line.damaged} · 遗失 ${line.lost} ${stockItem(line.code)?.uom || ""} · ${line.location || "未填写位置"} · 批次 ${line.batch || "无"}`,
					),
				)
			: loanGroups.value.flatMap((group) =>
					group.entries.map(
						(entry) =>
							`${entry.loan.name} · ${entry.loan.borrower} · ${entry.loan.loanDate} · ${group.name} · ${outcomes[group.outcome]} ${entry.qty} ${group.uom} · ${entry.line.location || "未填写位置"} · 批次 ${entry.line.batch || "无"}`,
					),
				),
);
</script>
<template>
	<div class="preview-activity-browse">
		<div class="preview-browse-controls">
			<nav
				class="browse-view-switch"
				:aria-label="family === 'movement' ? '货物流动视图' : '借用视图'"
			>
				<button :aria-current="!records ? 'page' : undefined" @click="switchView(false)">
					按物品</button
				><button :aria-current="records ? 'page' : undefined" @click="switchView(true)">
					按记录
				</button>
			</nav>
			<PreviewPeriodFilter
				v-model="scope.period"
				:label="family === 'movement' ? '流动日期' : '借出日期'"
			/>
			<div
				v-if="family === 'movement'"
				class="browse-tabs browse-kind-tabs"
				role="group"
				aria-label="流动类型快捷筛选"
			>
				<button :aria-pressed="!scope.kinds.length" @click="scope.kinds = []">全部</button
				><button
					v-for="[kind, label] in kinds.filter(([kind]) =>
						['Receive', 'Issue', 'Transfer'].includes(kind),
					)"
					:key="kind"
					:aria-pressed="scope.kinds.length === 1 && scope.kinds[0] === kind"
					@click="scope.kinds = [kind]"
				>
					{{ label }}</button
				><button
					v-if="scope.kinds.length > 1"
					aria-pressed="true"
					@click="filtersOpen = true"
				>
					多种类型 · {{ scope.kinds.length }}
				</button>
			</div>
			<div class="browse-toolbar">
				<label class="browse-search"
					><InventoryIcon name="search" /><input
						v-model="search"
						type="search"
						:aria-label="family === 'movement' ? '搜索货物流动' : '搜索借用'"
						:placeholder="
							family === 'movement'
								? '搜索物品、单号或活动'
								: '搜索借用人、活动或物品'
						"
				/></label>
				<label class="preview-inline-field" v-if="family === 'loan' || records"
					>状态<select
						:value="status"
						:aria-label="family === 'movement' ? '流动记录状态' : '借用状态'"
						@change="setStatus(($event.target as HTMLSelectElement).value)"
					>
						<option v-for="[key, label] in statusChoices" :key="key" :value="key">
							{{ label }}
						</option>
					</select></label
				>
				<select v-if="family === 'movement'" v-model="sort" aria-label="流动日期排序">
					<option value="newest">日期由新到旧</option>
					<option value="oldest">日期由旧到新</option>
				</select>
				<select
					v-if="family === 'loan' && records"
					v-model="reviewSession.filters.loanRecords.sort"
					aria-label="借用记录排序"
				>
					<option value="newest">借出日期由新到旧</option>
					<option value="oldest">借出日期由旧到新</option>
				</select>
				<select
					v-else-if="family === 'loan'"
					v-model="reviewSession.filters.loanItems.sort"
					aria-label="借用物品排序"
				>
					<option value="name">物品名称</option>
					<option value="quantity">数量由多到少</option>
				</select>
				<PreviewFilterButton
					:expanded="filtersOpen"
					:count="activeFilters.length"
					@click="filtersOpen = !filtersOpen"
				/>
				<PreviewUiButton icon="download" @click="openExport">导出</PreviewUiButton>
			</div>
			<div class="preview-active-filters">
				<button
					v-for="filter in activeFilters"
					:key="filter.key + filter.value"
					class="chip"
					@click="removeFilter(filter.key, filter.value)"
				>
					{{ filter.label }} ×</button
				><button
					v-if="activeFilters.length || search || scope.period.key !== 'all'"
					class="browse-link"
					@click="clear"
				>
					清空筛选</button
				><span class="browse-result-count"
					>筛选结果 {{ count }}
					{{ records ? "笔记录" : family === "loan" ? "组物品" : "种物品" }} · 已显示
					{{ Math.min(resultLimit, count) }}</span
				>
			</div>
			<p v-if="family === 'loan'" class="browse-note">
				按借出日期筛选，显示当前结清情况。<button class="browse-link" @click="loanHistory">
					查看期间借还流动
				</button>
			</p>
		</div>
		<section class="preview-activity-summary" aria-label="当前筛选汇总" aria-live="polite">
			<template v-if="family === 'movement'">
				<strong
					>{{ summary.records }}笔记录 · {{ summary.items }}种物品 ·
					{{ summary.categories }}个类别</strong
				>
				<span v-if="records && status !== 'completed'">{{
					status === "draft" ? "草稿数量" : "已取消数量"
				}}</span>
				<details>
					<summary>各类型数量</summary>
					<span v-for="total in summary.totals" :key="total.kind"
						>{{ movementLabels[total.kind] }} {{ total.text }}</span
					>
				</details>
			</template>
			<template v-else>
				<strong
					>{{
						records && status === "draft"
							? `${loans.length}笔草稿`
							: `${loanSummary.outstanding}笔未结清`
					}}
					· {{ loanSummary.items }}种物品</strong
				>
				<details>
					<summary>结清数量</summary>
					<span v-for="total in loanSummary.totals" :key="total.label"
						>{{ total.label }} {{ total.text }}</span
					>
				</details>
			</template>
		</section>
		<div class="preview-browse-body">
			<aside
				v-if="filtersOpen && !isMobile"
				class="preview-filter-rail"
				aria-label="详细筛选"
			>
				<PreviewBrowseFilters
					v-model="scope"
					:movement="family === 'movement'"
					:records="records"
				/><PreviewUiButton @click="clear">清空筛选</PreviewUiButton>
			</aside>
			<div class="preview-browse-results">
				<details class="form-section">
					<summary>分析当前结果</summary>
					<label class="preview-field"
						>分组<select v-model="analysisDimension">
							<option value="category">类别 / 单位</option>
							<option value="location">来源位置 / 单位</option>
							<option value="activity">活动</option>
							<option value="borrower">借用方</option>
							<option value="month">月份</option>
						</select></label
					>
					<p v-for="[key, value] in analysis" :key="key">
						{{ key }} · {{ value.items.size }} 种物品 · {{ value.records.size }} 笔记录
						· {{ value.qty }}
					</p>
					<p class="muted">
						基于完整筛选结果；一条记录涉及多个分组时，各组记录数不可相加。
					</p>
				</details>
				<PreviewResultState :total="count" v-model:limit="resultLimit">
					<template v-if="family === 'movement' && !records">
						<PreviewItemGroup
							v-for="group in itemGroups.slice(0, resultLimit)"
							:key="group.code"
							:item="stockItem(group.code)"
							:name="group.name"
							:context="`${group.code} · ${categoriesFor([group.code])} · ${group.count}笔记录 · 最近 ${group.latest}`"
						>
							<template #metrics
								><span v-for="total in group.totals" :key="total.kind"
									>{{ movementLabels[total.kind] }} {{ total.text }}　</span
								></template
							>
							<div
								v-for="(row, index) in group.lines"
								:key="row.name + index"
								class="preview-contribution"
							>
								<button
									class="browse-row-link"
									@click="emit('movement', row.name)"
								>
									{{ row.name }} · {{ row.date }} ·
									{{ movementLabels[row.kind] }}</button
								><span
									>{{ row.qty }} {{ row.uom }} · {{ row.from }} → {{ row.to }} ·
									批次 {{ row.batch || "无" }}</span
								>
							</div>
						</PreviewItemGroup>
					</template>
					<div v-else-if="family === 'movement'" class="browse-table-wrap">
						<table class="browse-table">
							<thead>
								<tr>
									<th>记录 / 物品 / 类别</th>
									<th>类型 / 日期</th>
									<th>流向</th>
									<th>数量</th>
									<th>状态</th>
								</tr>
							</thead>
							<tbody>
								<tr
									v-for="record in movementRecords.slice(0, resultLimit)"
									:key="record.name"
								>
									<td>
										<button
											class="browse-row-link"
											@click="emit('movement', record.name)"
										>
											{{ record.name
											}}<small
												>{{
													new Set(record.allLines.map((row) => row.code))
														.size
												}}
												种物品 · {{ record.lines.length }} 行匹配</small
											></button
										><small>{{
											[
												...new Set(
													record.lines.map((row) => row.itemName),
												),
											].join("、")
										}}</small
										><small>{{
											categoriesFor(record.lines.map((row) => row.code))
										}}</small
										><button
											v-if="record.row.loanName"
											class="browse-link"
											@click="emit('loan', record.row.loanName)"
										>
											查看借用
										</button>
									</td>
									<td>
										{{
											[
												...new Set(
													record.allLines.map(
														(row) => movementLabels[row.kind],
													),
												),
											].join(" / ")
										}}<small>{{ record.row.date }}</small>
									</td>
									<td>
										<div
											v-for="branch in [
												...new Set(
													record.allLines.map(
														(row) => `${row.from} → ${row.to}`,
													),
												),
											]"
											:key="branch"
										>
											{{ branch }}
										</div>
									</td>
									<td>
										{{ quantityText(record.lines)
										}}<small
											v-if="record.lines.length !== record.allLines.length"
											>匹配行数量 · 全单
											{{ quantityText(record.allLines) }}</small
										>
									</td>
									<td>
										{{
											record.row.docstatus === 1
												? "已提交"
												: record.row.docstatus === 0
													? "草稿"
													: "已取消"
										}}
									</td>
								</tr>
							</tbody>
						</table>
					</div>
					<template v-else-if="!records">
						<PreviewItemGroup
							v-for="group in loanGroups.slice(0, resultLimit)"
							:key="group.code + group.outcome"
							:item="stockItem(group.code)"
							:name="group.name"
							:context="`${group.code} · ${categoriesFor([group.code])} · ${group.count}笔借用`"
						>
							<template #metrics
								>{{ outcomes[group.outcome] }} · {{ group.qty }}
								{{ group.uom }}</template
							>
							<div
								v-for="(entry, index) in group.entries"
								:key="entry.loan.name + index"
								class="preview-contribution"
							>
								<button
									class="browse-row-link"
									@click="emit('loan', entry.loan.name)"
								>
									{{ entry.loan.borrower }} · {{ entry.loan.name }}</button
								><span
									>{{ entry.loan.loanDate }} · {{ entry.qty }} {{ group.uom }} ·
									{{ entry.line.location || "未填写位置" }} · 批次
									{{ entry.line.batch || "无" }}</span
								><PreviewUiButton
									v-if="group.outcome === 'outstanding'"
									@click="emit('return', entry.loan.name)"
									>登记归还</PreviewUiButton
								>
							</div>
						</PreviewItemGroup>
					</template>
					<div v-else class="browse-grid browse-grid--two">
						<article
							v-for="loan in loans.slice(0, resultLimit)"
							:key="loan.name"
							class="browse-card browse-loan-card"
						>
							<button class="browse-card-main" @click="emit('loan', loan.name)">
								<h2>{{ loan.borrower || "未填写借用方" }}</h2>
								<span class="browse-badge">{{ completeLoanStatus(loan) }}</span>
								<p>{{ loan.name }} · 借出日期 {{ loan.loanDate }}</p>
								<p>{{ loan.activity || "未填写活动" }}</p>
								<strong
									>{{ loan.status === "draft" ? "草稿物品" : "尚未归还" }}
									{{ loan.status === "draft" ? "" : loanQuantity(loan) }}</strong
								>
								<p v-for="(line, index) in loan.lines" :key="line.code + index">
									{{ itemName(line.code) }} · 借出 {{ line.qty }} · 已归还
									{{ line.returned }} · 损坏 {{ line.damaged }} · 遗失
									{{ line.lost
									}}<small
										>{{ line.location || "未填写位置" }} · 批次
										{{ line.batch || "无" }}</small
									>
								</p></button
							><PreviewUiButton
								v-if="
									loan.status !== 'draft' &&
									loan.lines.some((line) => remaining(line) > 0)
								"
								@click="emit('return', loan.name)"
								>登记归还</PreviewUiButton
							>
						</article>
					</div>
					<div v-if="!count" class="browse-empty">
						<h2>没有匹配的{{ family === "loan" ? "借用" : "流动" }}记录</h2>
						<p>调整日期或筛选条件后重试。</p>
						<PreviewUiButton @click="clear">清空筛选</PreviewUiButton>
					</div>
				</PreviewResultState>
			</div>
		</div>
		<PreviewOverlay
			v-if="filtersOpen && isMobile"
			title="筛选"
			drawer
			@close="filtersOpen = false"
			><PreviewBrowseFilters
				v-model="scope"
				:movement="family === 'movement'"
				:records="records"
			/><template #footer
				><PreviewUiButton @click="clear">清空</PreviewUiButton
				><PreviewUiButton variant="primary" @click="filtersOpen = false"
					>完成</PreviewUiButton
				></template
			></PreviewOverlay
		>
		<PreviewOverlay
			v-if="exportOpen"
			title="快速导出 · 当前筛选范围"
			@close="exportOpen = false"
			><p>{{ exportRows.length }} 条完整筛选结果 · 不受显示行数限制</p>
			<label class="preview-field"
				>格式<select v-model="exportFormat">
					<option>CSV</option>
					<option>XLSX</option>
				</select></label
			>
			<label class="preview-field"
				>导出内容<select v-model="exportDataset">
					<option value="summary">{{ records ? "操作记录" : "物品汇总" }}</option>
					<option value="details">逐行明细</option>
				</select></label
			>
			<p>
				{{ (exportDataset === "summary" ? exportRows : exportDetails).length }} 行 ·
				当前完整筛选范围
			</p>
			<ul>
				<li
					v-for="(row, index) in exportDataset === 'summary'
						? exportRows
						: exportDetails"
					:key="index"
				>
					{{ row }}
				</li>
			</ul>
			<p v-if="exportFailed" role="alert">模拟导出失败，筛选已保留。</p>
			<template #footer
				><PreviewUiButton @click="exportFailed = true">模拟失败</PreviewUiButton
				><PreviewUiButton
					variant="primary"
					@click="
						emit(
							'notify',
							`已模拟生成 ${(exportDataset === 'summary' ? exportRows : exportDetails).length} 条${exportFormat}记录，不下载文件`,
						);
						exportOpen = false;
						exportFailed = false;
					"
					>{{ exportFailed ? "重试导出" : "模拟导出" }}</PreviewUiButton
				></template
			></PreviewOverlay
		>
	</div>
</template>
