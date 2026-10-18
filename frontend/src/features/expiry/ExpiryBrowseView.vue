<script setup lang="ts">
import { formatExpiryDuration } from "../../lib/expiryDuration";
import { warehouseLabel } from "../../lib/warehouseLabel";
import { computed, ref, watch } from "vue";
import type { ExpiryBrowse } from "./useExpiryBrowse";
import type { ReportQuery, ReportRow } from "../../lib/reportContract";
import { useResponsiveLayout } from "../../composables/useResponsiveLayout";
import UiButton from "../../components/ui/UiButton.vue";
import PeriodFilter from "../../components/ui/PeriodFilter.vue";
import FilterButton from "../../components/ui/FilterButton.vue";
import Overlay from "../../components/ui/Overlay.vue";
import ExpiryBrowseFilters from "./ExpiryBrowseFilters.vue";
import ItemImage from "../../components/ItemImage.vue";
import QuickExport from "../../components/QuickExport.vue";
import QuantitySummary from "../../components/ui/QuantitySummary.vue";
import ReportTable from "../../components/ui/ReportTable.vue";
import ScanPanel from "../scanner/ScanPanel.vue";
const props = withDefaults(defineProps<{ controller: ExpiryBrowse; active?: boolean }>(), {
	active: true,
});
const emit = defineEmits<{
	item: [code: string];
	newOperation: [kind: string];
	openExport: [query: ReportQuery];
}>();
const c = props.controller,
	{ query, scope, routeError, result, reference, chips, metrics, dimension, analysis } = c;
const { isMobile } = useResponsiveLayout();
const filterOpen = ref(false),
	analysisOpen = ref(false);
const batchDetail = ref<ReportRow>();
watch(
	() => props.active,
	(active) => {
		if (active === false) filterOpen.value = false;
	},
);
const choices = [
	["period", "全部", "all"],
	["expired", "已过期", "expired"],
	["unexpired", "未过期", "unexpired"],
	["undated", "无效期", "undated"],
] as const;
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
</script>
<template>
	<section class="browse-page">
		<header class="browse-heading">
			<h1>效期批次</h1>
			<div class="browse-heading-actions">
				<QuickExport
					v-if="!routeError"
					:query="query"
					:active="active"
					@open-full="emit('openExport', $event)"
				/>
				<UiButton
					v-if="reference.operations.Receive"
					@click="emit('newOperation', 'Receive')"
					>入库</UiButton
				>
			</div>
		</header>
		<p v-if="routeError" role="alert">{{ routeError }}</p>
		<nav class="browse-tabs expiry-browse-tabs" aria-label="效期筛选">
			<button
				v-for="[key, label, facet] in choices"
				:key="key"
				:aria-current="query.expiryWindow === key ? 'page' : undefined"
				@click="query.expiryWindow = key"
			>
				{{ label }} <small>{{ result.facets[facet] ?? "…" }}</small>
			</button>
		</nav>
		<p v-if="query.expiryWindow.startsWith('next_')" class="browse-note">
			今日至未来 {{ query.expiryWindow.slice(5) }} 天到期，包含端点。
		</p>
		<div class="browse-toolbar">
			<label class="browse-search"
				><span>搜索</span
				><input v-model="query.search" type="search" placeholder="搜索物品、批次或位置"
			/></label>
			<PeriodFilter
				v-model="scope.period"
				label="到期日期"
				:today="reference.siteDate"
				:active="active"
			/>
			<FilterButton
				:expanded="filterOpen"
				:count="c.scopeChips.value.length + chips.filter((chip) => !chip.fixed).length"
				@click="filterOpen = !filterOpen"
			/>
			<details class="preview-expiry-tools">
				<summary>浏览工具</summary>
				<label class="preview-field"
					>排序<select v-model="query.sortBy">
						<option value="date">到期日</option>
						<option value="identity">物品 / 批次编号</option>
						<option value="quantity">库存数量</option>
						<option value="name">物品名称</option>
					</select></label
				>
				<UiButton @click="query.sort = query.sort === 'asc' ? 'desc' : 'asc'">{{
					query.sort === "asc" ? "升序" : "降序"
				}}</UiButton>
			</details>
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
		<ScanPanel
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
		<p v-if="result.initialized" class="browse-result-count">
			{{ result.batchCount }} 个批次 · {{ result.itemCount }} 种物品 ·
			{{ result.total }} 条库位分配 · 已读取 {{ result.rows.length }} 条
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
			<div class="preview-browse-results">
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
								><small>{{ row.category }} · {{ row.batch_no }}</small>
							</button>
						</div>
						<p>
							{{ row.expiry_date || "无效期" }} · 可用 {{ row.available }}
							{{ row.stock_uom }}
							<small v-if="typeof row.remaining_days === 'number'">
								· {{ formatExpiryDuration(row.remaining_days) }}</small
							>
						</p>
						<UiButton @click="batchDetail = row">查看批次明细</UiButton>
					</article>
				</div>
				<div v-else class="browse-table-wrap">
					<table class="browse-table">
						<thead>
							<tr>
								<th>物品 / 批次</th>
								<th>效期</th>
								<th>剩余时间</th>
								<th>可用量</th>
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
									<button
										class="browse-row-link"
										:disabled="result.stale"
										@click="openItem(row)"
									>
										<strong>{{ row.item_name }}</strong
										><small
											>{{ row.batch_no }} · {{ row.item_code }} ·
											{{ row.category }}</small
										>
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
											: "—"
									}}
								</td>
								<td>{{ row.available }} {{ row.stock_uom }}</td>
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
									<UiButton @click="batchDetail = row">查看批次明细</UiButton>
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
				<UiButton v-if="result.initialized" @click="analysisOpen = true"
					>分析结果</UiButton
				>
				<Overlay
					v-if="analysisOpen"
					title="分析当前结果"
					adaptive-creation
					@close="analysisOpen = false"
				>
					<QuantitySummary :metrics="metrics" />
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
		<Overlay
			v-if="batchDetail"
			title="批次明细"
			adaptive-creation
			@close="batchDetail = undefined"
		>
			<h3>{{ batchDetail.item_name }} · {{ batchDetail.batch_no }}</h3>
			<p>
				{{
					warehouseLabel(
						batchDetail.warehouse,
						reference.warehouses,
						batchDetail.warehouse_label,
					)
				}}
				·
				{{ batchDetail.expiry_date || "无效期" }}
			</p>
			<p>
				可用 {{ batchDetail.available }} · 借出 {{ batchDetail.loaned }} · 损坏
				{{ batchDetail.damaged }} {{ batchDetail.stock_uom }}
			</p>
			<p>生产日期 {{ batchDetail.manufacturing_date || "未填写" }}</p>
			<QuickExport
				:query="c.batchQuery(batchDetail)"
				:active="active"
				@open-full="emit('openExport', $event)"
			/>
		</Overlay>
	</section>
</template>

<style scoped>
.expiry-browse-tabs button {
	min-width: 0;
	flex: 1;
	padding-inline: var(--p-space-1);
	white-space: normal;
}
</style>
