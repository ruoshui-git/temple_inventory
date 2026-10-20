<script setup lang="ts">
import BrowseToolbar from "../../components/ui/BrowseToolbar.vue";
import { formatExpiryDuration } from "../../lib/expiryDuration";
import { warehouseLabel } from "../../lib/warehouseLabel";
import { computed, ref, watch } from "vue";
import type { ExpiryBrowse } from "./useExpiryBrowse";
import type { ReportQuery, ReportRow } from "../../lib/reportContract";
import { useResponsiveLayout } from "../../composables/useResponsiveLayout";
import UiButton from "../../components/ui/UiButton.vue";
import FilterButton from "../../components/ui/FilterButton.vue";
import Overlay from "../../components/ui/Overlay.vue";
import ExpiryBrowseFilters from "./ExpiryBrowseFilters.vue";
import ItemImage from "../../components/ItemImage.vue";
import QuickExport from "../../components/QuickExport.vue";
import QuantitySummary from "../../components/ui/QuantitySummary.vue";
import ReportTable from "../../components/ui/ReportTable.vue";
import SortControl from "../../components/ui/SortControl.vue";
import ScanPanel from "../scanner/ScanPanel.vue";
import ReturnToTop from "../../components/ui/ReturnToTop.vue";
const props = withDefaults(defineProps<{ controller: ExpiryBrowse; active?: boolean }>(), {
	active: true,
});
const emit = defineEmits<{
	item: [code: string];
	openBatch: [name: string];
	newOperation: [kind: string];
	openExport: [query: ReportQuery];
}>();
const c = props.controller,
	{ query, scope, routeError, result, reference, chips, metrics, dimension, analysis } = c;
const { isMobile } = useResponsiveLayout();
const filterOpen = ref(false),
	analysisOpen = ref(false);
const scan = ref<InstanceType<typeof ScanPanel>>();
watch([() => props.active, isMobile], () => {
	if (props.active === false) filterOpen.value = false;
	analysisOpen.value = false;
});
const choices = [
	["period", "全部", "all"],
	["expired", "已过期", "expired"],
	["unexpired", "未过期", "unexpired"],
	["undated", "无效期", "undated"],
] as const;
function expiryKey(event: KeyboardEvent) {
	if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
	event.preventDefault();
	const index = choices.findIndex(([key]) => key === query.value.expiryWindow);
	const next =
		event.key === "Home"
			? 0
			: event.key === "End"
				? choices.length - 1
				: (index + (event.key === "ArrowRight" ? 1 : -1) + choices.length) %
					choices.length;
	query.value.expiryWindow = choices[next]![0];
	requestAnimationFrame(() =>
		document
			.querySelector<HTMLElement>(`[data-expiry-choice="${choices[next]![0]}"]`)
			?.focus(),
	);
}
const analysisTable = computed(() => ({
	id: "expiry-analysis",
	label: "分析当前结果",
	columns: [
		dimension.value,
		"stock_uom",
		"item_count",
		"allocation_count",
		"available",
		"loaned",
		"damaged",
	],
	rows: analysis.value?.rows || [],
}));
function openItem(row: ReportRow) {
	if (!result.stale) emit("item", String(row.item_code));
}
function openBatch(row: ReportRow) {
	if (!result.stale) emit("openBatch", String(row.batch_no));
}
function sortBy(field: ReportQuery["sortBy"]) {
	if (query.value.sortBy === field)
		query.value.sort = query.value.sort === "asc" ? "desc" : "asc";
	else {
		query.value.sortBy = field;
		query.value.sort = "asc";
	}
}
function sortState(field: string) {
	return query.value.sortBy === field
		? query.value.sort === "asc"
			? "ascending"
			: "descending"
		: "none";
}
const sortFields = [
	{ value: "date", label: "到期日" },
	{ value: "name", label: "物品名称" },
	{ value: "batch", label: "批次编号" },
	{ value: "quantity", label: "库存数量" },
];
function sortGlyph(field: ReportQuery["sortBy"]) {
	return query.value.sortBy === field ? (query.value.sort === "asc" ? "↑" : "↓") : "↕";
}
</script>
<template>
	<section class="browse-page">
		<ReturnToTop :active="active" :hidden="isMobile && filterOpen" />
		<BrowseToolbar
			title="效期批次"
			:summary="`效期批次 · ${result.initialized ? result.batchCount + ' 个批次' : '读取中'}`"
			v-model:search="query.search"
			search-label="搜索物品、批次或位置"
			:active="active"
			:filters-open="filterOpen"
			:filter-count="c.scopeChips.value.length + chips.filter((chip) => !chip.fixed).length"
			scannable
			@scan="scan?.show()"
			@filters="filterOpen = !filterOpen"
			><template #actions
				><QuickExport
					v-if="!routeError"
					:query="query"
					:active="active"
					@open-full="emit('openExport', $event)"
			/></template>
			<p v-if="routeError" role="alert">{{ routeError }}</p>
			<nav class="browse-tabs" role="tablist" aria-label="效期筛选" @keydown="expiryKey">
				<button
					v-for="[key, label, facet] in choices"
					:key="key"
					role="tab"
					:data-expiry-choice="key"
					:aria-selected="query.expiryWindow === key"
					:tabindex="query.expiryWindow === key ? 0 : -1"
					aria-controls="expiry-results-panel"
					@click="query.expiryWindow = key"
				>
					{{ label }} <small>{{ result.facets[facet] ?? "…" }}</small>
				</button>
			</nav>
			<div class="browse-toolbar">
				<label class="browse-search"
					><span>搜索</span
					><input
						v-model="query.search"
						type="search"
						placeholder="搜索物品、批次或位置"
				/></label>
				<UiButton icon="scan" @click="scan?.show()">扫码</UiButton>
				<FilterButton
					:expanded="filterOpen"
					:count="c.scopeChips.value.length + chips.filter((chip) => !chip.fixed).length"
					@click="filterOpen = !filterOpen"
				/>
				<SortControl
					v-model:field="query.sortBy"
					v-model:direction="query.sort"
					:fields="sortFields"
					label="效期排序"
				/>
			</div>
			<div class="preview-active-filters">
				<UiButton
					v-for="chip in c.scopeChips.value"
					:key="chip.key"
					variant="ghost"
					:aria-label="'移除' + chip.label"
					@click="c.removeScope(chip.field, chip.value)"
					>{{ chip.label }} ×</UiButton
				>
				<UiButton
					v-for="chip in chips"
					:key="chip.key"
					variant="ghost"
					:aria-label="'移除' + chip.label"
					:disabled="chip.fixed"
					@click="Object.assign(query, chip.reset)"
					>{{ chip.summary || chip.label }} {{ chip.fixed ? "" : "×" }}</UiButton
				>
			</div>
			<template #result-tools
				><UiButton v-if="result.initialized" @click="analysisOpen = true"
					>分析结果</UiButton
				></template
			></BrowseToolbar
		>
		<ScanPanel
			ref="scan"
			hide-trigger
			@item="(code, batch) => (query.search = batch || code)"
			@location="(name) => (scope.warehouses = [name])"
		/>
		<p v-if="result.loading" role="status">
			{{ result.rows.length ? "正在更新批次…" : "正在读取批次…" }}
		</p>
		<p v-if="result.error" role="alert">
			{{ result.error }} <UiButton @click="c.retry">重试</UiButton>
		</p>
		<p v-if="result.stale" role="status">结果正在更新，更新完成后可打开详情。</p>
		<section
			v-if="result.initialized"
			class="preview-activity-summary"
			aria-label="当前效期汇总"
			aria-live="polite"
		>
			<p class="browse-result-count">
				筛选结果：{{ result.batchCount }} 个批次 · {{ result.itemCount }} 种物品 ·
				{{ result.total }} 条存放明细
			</p>
			<QuantitySummary :metrics="metrics" :loading="result.loading || result.stale" />
		</section>
		<p v-if="query.expiryWindow.startsWith('next_')" class="browse-note">
			今日至未来 {{ query.expiryWindow.slice(5) }} 天到期，包含端点。
		</p>
		<div class="preview-browse-body">
			<aside v-if="filterOpen && !isMobile" class="preview-filter-rail">
				<ExpiryBrowseFilters :controller="c" />
			</aside>
			<Overlay
				v-if="filterOpen && isMobile"
				title="筛选效期"
				drawer
				@close="filterOpen = false"
				><ExpiryBrowseFilters :controller="c"
			/></Overlay>
			<div id="expiry-results-panel" role="tabpanel" class="preview-browse-results">
				<div v-if="isMobile" class="preview-expiry-mobile">
					<article
						v-for="row in result.rows"
						:key="String(row.id)"
						:data-browse-row="String(row.id)"
						class="browse-card"
					>
						<div class="preview-group-heading">
							<div class="preview-group-thumbnail">
								<ItemImage :item="c.item(row)" />
							</div>
							<button
								class="browse-row-link"
								:disabled="result.stale"
								@click="openItem(row)"
							>
								<strong>{{ row.item_name }}</strong
								><small>{{ row.category }}</small>
							</button>
							<button
								class="browse-row-link"
								:disabled="result.stale"
								@click="openBatch(row)"
							>
								{{ row.batch_no }} · 批次资料
							</button>
						</div>
						<p>
							{{ row.expiry_date || "无效期" }} · {{ row.stock_qty }}
							{{ row.stock_uom }}
							<span v-if="Number(row.loaned) > 0" class="browse-badge is-warning"
								>借出</span
							>
							<span
								v-else-if="Number(row.damaged) > 0"
								class="browse-badge is-danger"
								>损坏</span
							>
							<small v-if="typeof row.remaining_days === 'number'">
								· {{ formatExpiryDuration(row.remaining_days) }}</small
							>
						</p>
					</article>
				</div>
				<div v-else class="browse-table-wrap">
					<table class="browse-table">
						<thead>
							<tr>
								<th :aria-sort="sortState('name')">
									<button @click="sortBy('name')">
										物品名称 {{ sortGlyph("name") }}
									</button>
								</th>
								<th :aria-sort="sortState('batch')">
									<button @click="sortBy('batch')">
										批次编号 {{ sortGlyph("batch") }}
									</button>
								</th>
								<th :aria-sort="sortState('date')">
									<button @click="sortBy('date')">
										效期 {{ sortGlyph("date") }}
									</button>
								</th>
								<th>剩余时间</th>
								<th :aria-sort="sortState('quantity')">
									<button @click="sortBy('quantity')">
										库存数量 {{ sortGlyph("quantity") }}
									</button>
								</th>
								<th>位置</th>
							</tr>
						</thead>
						<tbody>
							<tr
								v-for="row in result.rows"
								:key="String(row.id)"
								:data-browse-row="String(row.id)"
							>
								<td>
									<div class="expiry-item-identity">
										<ItemImage :item="c.item(row)" />
										<div>
											<button
												class="browse-row-link"
												:disabled="result.stale"
												@click="openItem(row)"
											>
												<strong>{{ row.item_name }}</strong>
											</button>
											<small
												>{{ row.item_code
												}}<template v-if="row.category">
													· {{ row.category }}</template
												></small
											>
										</div>
									</div>
								</td>
								<td>
									<button
										class="browse-row-link"
										:disabled="result.stale"
										@click="openBatch(row)"
									>
										{{ row.batch_no }} · 批次资料
									</button>
								</td>
								<td>
									<span
										class="browse-badge"
										:class="
											!row.expiry_date
												? 'is-neutral'
												: String(row.expiry_date) < reference.siteDate
													? 'is-danger'
													: 'is-success'
										"
										>{{ row.expiry_date || "无效期" }}</span
									>
								</td>
								<td>
									{{
										typeof row.remaining_days === "number"
											? formatExpiryDuration(row.remaining_days)
											: ""
									}}
								</td>
								<td>
									{{ row.stock_qty }} {{ row.stock_uom }}
									<span
										v-if="Number(row.loaned) > 0"
										class="browse-badge is-warning"
										>借出</span
									>
									<span
										v-else-if="Number(row.damaged) > 0"
										class="browse-badge is-danger"
										>损坏</span
									>
								</td>
								<td>
									<p>
										{{
											warehouseLabel(
												row.warehouse,
												reference.warehouses,
												row.warehouse_label,
											)
										}}
									</p>
								</td>
							</tr>
						</tbody>
					</table>
				</div>
				<p
					v-if="
						result.initialized &&
						!result.loading &&
						!result.error &&
						!result.rows.length
					"
				>
					没有符合条件的批次
				</p>
				<UiButton
					v-if="result.next !== null"
					:loading="result.loading"
					@click="c.load(true)"
					>加载更多</UiButton
				>

				<Overlay
					v-if="analysisOpen"
					title="分析当前结果"
					adaptive-creation
					@close="analysisOpen = false"
				>
					<label class="preview-field"
						>分析维度<select v-model="dimension">
							<option value="category">类别</option>
							<option value="warehouse">位置</option>
						</select></label
					>
					<ReportTable
						v-if="analysis"
						:table="analysisTable"
						:total="analysis.matched_count"
						:loading="analysis.loading"
						:initialized="result.initialized"
						:error="analysis.error"
						@load-more="c.moreAnalysis"
						@retry="c.moreAnalysis"
					/>
				</Overlay>
			</div>
		</div>
	</section>
</template>
