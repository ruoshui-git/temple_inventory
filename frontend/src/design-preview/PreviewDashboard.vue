<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch, shallowRef, onActivated } from "vue";
import PreviewUiButton from "./components/PreviewUiButton.vue";
import PreviewPeriodFilter from "./components/PreviewPeriodFilter.vue";
import PreviewHierarchyFilter from "./components/PreviewHierarchyFilter.vue";
import PreviewQuantitySummary from "./components/PreviewQuantitySummary.vue";
import { reviewSession, type PreviewPage } from "./reviewModel";
import { dashboardData, dashboardScope } from "./dashboardModel";
import { matchesWarehouse, quantityText, loanStatus, remaining } from "./browseModel";
import { previewDate } from "./model";
const emit = defineEmits<{
	navigate: [page: PreviewPage, variant: string];
	movement: [name: string];
	loan: [name: string];
}>();
const filters = computed(() => reviewSession.filters.dashboard);
const data = shallowRef(dashboardData(reviewSession));
onActivated(() => {
	data.value = dashboardData(reviewSession);
});
const showFilters = ref(false);
const state = ref("ready");
const failedSection = ref("");
let refreshTimer: ReturnType<typeof setTimeout> | undefined;
onBeforeUnmount(() => clearTimeout(refreshTimer));
function refresh() {
	state.value = "refreshing";
	clearTimeout(refreshTimer);
	refreshTimer = setTimeout(() => {
		data.value = dashboardData(reviewSession);
		state.value = "ready";
	}, 500);
}
watch(() => [filters.value.warehouses, filters.value.categories], refresh, { deep: true });
watch(
	() => filters.value.period,
	() => {
		const latest = dashboardData(reviewSession);
		data.value = { ...data.value, movements: latest.movements, summaries: latest.summaries };
	},
	{ deep: true },
);
const categories = computed(() =>
	[...new Set(reviewSession.stock.map((item) => item.category))].map((name) => ({
		name,
		label: name,
	})),
);
const metrics = computed(() =>
	(
		[
			["available", "可用库存"],
			["total", "库存总计"],
			["loaned", "借出"],
			["damaged", "损坏"],
		] as const
	).map(([key, label]) => ({
		key,
		label,
		quantities: state.value === "empty" ? [] : data.value.metric(key),
	})),
);
const expiryPreview = computed(() => {
	const map = new Map<string, (typeof data.value.batches)[number]>();
	data.value.batches
		.filter((row) =>
			filters.value.expiry === "expired"
				? row.bucket.startsWith("expired")
				: row.bucket === "upcoming_0_30",
		)
		.sort((a, b) => (a.expiry || "").localeCompare(b.expiry || ""))
		.forEach((row) => {
			const key = `${row.item.code}:${row.id}`;
			const previous = map.get(key);
			map.set(
				key,
				previous
					? {
							...previous,
							available: previous.available + row.available,
							location: `${previous.location}、${row.location}`,
						}
					: { ...row },
			);
		});
	return [...map.values()].slice(0, 5);
});
const distribution = computed(() => {
	if (filters.value.distribution === "category")
		return categories.value
			.filter(
				(category) =>
					!data.value.scope.categories.length ||
					data.value.scope.categories.includes(category.name),
			)
			.map((row) => ({
				name: row.name,
				label: row.label,
				count: data.value.stock.filter((item) => item.category === row.name).length,
			}));
	const selected = data.value.scope.warehouses;
	const nodes = reviewSession.warehouses.filter((row) =>
		selected.length
			? selected.some((name) => row.parent === name || (row.name === name && !row.is_group))
			: !row.parent,
	);
	return nodes.map((row) => ({
		name: row.name,
		label: row.label,
		count: data.value.stock.filter((item) =>
			item.locations.some((location) =>
				matchesWarehouse(location.location, [row.name], reviewSession),
			),
		).length,
	}));
});
const maximum = computed(() => Math.max(1, ...distribution.value.map((row) => row.count)));
const stale = computed(() => state.value === "loading" || state.value === "refreshing");
function drill(
	page: PreviewPage,
	variant: string,
	options: { kind?: string; bucket?: string; warehouse?: string; category?: string } = {},
) {
	if (stale.value) return;
	const scope = dashboardScope(reviewSession);
	if (options.warehouse) scope.warehouses = [options.warehouse];
	if (options.category) scope.categories = [options.category];
	if (page === "inventory") {
		reviewSession.filters.inventory.scope = scope;
		reviewSession.filters.inventory.search = "";
	}
	if (page === "expiry") {
		reviewSession.filters.expiry.scope = scope;
		reviewSession.filters.expiry.bucket = options.bucket || "";
		reviewSession.filters.expiry.search = "";
		reviewSession.filters.expiry.inStock = true;
	}
	if (page === "pending") {
		reviewSession.filters.pending.scope = scope;
		reviewSession.filters.pending.search = "";
	}
	if (page.startsWith("movement")) {
		reviewSession.filters.movementScope = {
			...scope,
			period: { ...filters.value.period },
			kinds: options.kind ? [options.kind] : [],
		};
		reviewSession.filters.movementItems.search = "";
	}
	if (page.startsWith("loan")) {
		reviewSession.filters.loanScope = scope;
		reviewSession.filters.loanItems.search = "";
	}
	emit("navigate", page, variant);
}
function loanQuantity(loan: (typeof data.value.loans)[number]) {
	return quantityText(
		loan.lines.map((line) => ({
			qty: remaining(line),
			uom: reviewSession.stock.find((item) => item.code === line.code)?.uom || "",
		})),
	);
}
</script>
<template>
	<div class="preview-dashboard">
		<div class="browse-toolbar">
			<PreviewUiButton :aria-expanded="showFilters" @click="showFilters = !showFilters"
				>总览范围 ·
				{{
					filters.warehouses.length + filters.categories.length || "全部"
				}}</PreviewUiButton
			><span>{{
				[...filters.warehouses, ...filters.categories].join(" · ") || "全部仓库 · 全部类别"
			}}</span
			><PreviewUiButton @click="refresh">刷新</PreviewUiButton
			><small>样本日期 {{ previewDate }}</small>
		</div>
		<div v-if="showFilters" class="preview-dashboard-scope">
			<PreviewHierarchyFilter
				v-model="filters.warehouses"
				:options="reviewSession.warehouses"
				title="仓库 / 位置"
				placeholder="搜索位置"
			/><PreviewHierarchyFilter
				v-model="filters.categories"
				:options="categories"
				title="物品类别"
				placeholder="搜索类别"
			/><PreviewUiButton
				@click="
					filters.warehouses = [];
					filters.categories = [];
				"
				>清空范围</PreviewUiButton
			>
		</div>
		<details class="preview-state-controls">
			<summary>预览状态</summary>
			<label
				>数据状态<select v-model="state">
					<option value="ready">正常</option>
					<option value="loading">首次加载</option>
					<option value="empty">空数据</option>
					<option value="refreshing">保留内容刷新</option>
				</select></label
			><label
				>单卡失败<select v-model="failedSection">
					<option value="">无</option>
					<option
						v-for="key in [
							'库存概览',
							'库存分布',
							'效期概览',
							'货物流动',
							'借出中',
							'提醒事项',
						]"
						:key="key"
					>
						{{ key }}
					</option>
				</select></label
			><PreviewUiButton
				@click="
					state = 'ready';
					failedSection = '';
				"
				>恢复</PreviewUiButton
			>
		</details>
		<p v-if="stale" role="status">
			{{ state === "loading" ? "正在加载物资总览…" : "正在更新当前范围，已保留上次内容…" }}
		</p>
		<div v-if="state === 'loading'" class="browse-skeleton" aria-hidden="true">　</div>
		<div
			v-else
			class="preview-dashboard-grid"
			:class="{ 'is-refreshing': stale }"
			:aria-busy="stale"
		>
			<div class="preview-dashboard-column">
				<article class="browse-card dashboard-inventory" data-section="inventory">
					<div class="browse-card-heading">
						<h2>库存概览</h2>
						<button
							class="browse-link"
							:disabled="stale || failedSection === '库存概览'"
							@click="drill('inventory', 'list')"
						>
							查看库存
						</button>
					</div>
					<PreviewQuantitySummary :metrics="metrics" />
					<p v-if="failedSection === '库存概览'" role="alert">
						库存概览更新失败，保留上次结果。<button @click="failedSection = ''">
							重试库存概览
						</button>
					</p>
				</article>
				<article class="browse-card dashboard-distribution" data-section="distribution">
					<h2>库存分布</h2>
					<div class="browse-tabs">
						<button
							:aria-pressed="filters.distribution === 'warehouse'"
							@click="filters.distribution = 'warehouse'"
						>
							按仓库</button
						><button
							:aria-pressed="filters.distribution === 'category'"
							@click="filters.distribution = 'category'"
						>
							按类别
						</button>
					</div>
					<strong>物品种数 · {{ state === "empty" ? 0 : data.stock.length }} 种</strong>
					<p class="browse-note">
						按物品代码去重；同一物品可出现在多个仓库，分组数量不能相加为总数。
					</p>
					<div v-if="state !== 'empty'" class="preview-distribution">
						<div class="preview-bar-axis">
							<span>0</span><span>{{ maximum }} 种</span>
						</div>
						<button
							v-for="bar in distribution"
							:key="bar.name"
							class="preview-bar"
							:disabled="stale || failedSection === '库存分布'"
							@click="
								drill(
									'inventory',
									'list',
									filters.distribution === 'warehouse'
										? { warehouse: bar.name }
										: { category: bar.name },
								)
							"
						>
							<span>{{ bar.label }}</span
							><span class="preview-bar-track"
								><span
									:style="{ width: `${(bar.count / maximum) * 100}%` }" /></span
							><b>{{ bar.count }}</b>
						</button>
					</div>
					<p v-else>当前范围没有库存分布。</p>
					<p v-if="failedSection === '库存分布'" role="alert">
						库存分布更新失败。<button @click="failedSection = ''">重试库存分布</button>
					</p>
				</article>
				<article class="browse-card dashboard-expiry" data-section="expiry">
					<div class="browse-card-heading">
						<h2>效期概览</h2>
						<button
							class="browse-link"
							:disabled="stale || failedSection === '效期概览'"
							@click="drill('expiry', 'all')"
						>
							查看全部批次
						</button>
					</div>
					<div class="preview-expiry-grid">
						<button
							v-for="bucket in data.buckets"
							:key="bucket.key"
							:class="{ 'is-expired': bucket.key.startsWith('expired') }"
							:disabled="stale || failedSection === '效期概览'"
							@click="drill('expiry', 'all', { bucket: bucket.key })"
						>
							<span>{{ bucket.label }}</span
							><strong>{{ state === "empty" ? 0 : bucket.count }} 个批次</strong>
						</button>
					</div>
					<div class="browse-tabs">
						<button
							:aria-pressed="filters.expiry === 'expired'"
							@click="filters.expiry = 'expired'"
						>
							已过期</button
						><button
							:aria-pressed="filters.expiry === 'upcoming'"
							@click="filters.expiry = 'upcoming'"
						>
							即将过期
						</button>
					</div>
					<div v-if="state !== 'empty'" class="browse-rank-list">
						<button
							v-for="row in expiryPreview"
							:key="row.item.code + row.id"
							class="browse-rank-row"
							:disabled="stale || failedSection === '效期概览'"
							@click="
								drill('expiry', filters.expiry === 'expired' ? 'expired' : 'soon')
							"
						>
							<span
								>{{ row.item.name
								}}<small
									>{{ row.id }} · {{ row.expiry }} · {{ row.location }}</small
								></span
							><b>{{ row.available }} {{ row.item.uom }}</b>
						</button>
					</div>
					<p v-if="state === 'empty' || !expiryPreview.length">
						当前范围没有需要关注的批次。
					</p>
					<p v-if="failedSection === '效期概览'" role="alert">
						效期更新失败。<button @click="failedSection = ''">重试效期概览</button>
					</p>
				</article>
			</div>
			<div class="preview-dashboard-column">
				<article class="browse-card dashboard-movement" data-section="movement">
					<div class="browse-card-heading">
						<h2>货物流动</h2>
						<button
							class="browse-link"
							:disabled="stale || failedSection === '货物流动'"
							@click="drill('movement-records', 'completed')"
						>
							查看记录
						</button>
					</div>
					<PreviewPeriodFilter v-model="filters.period" label="流动日期" /><small
						>日期仅影响本卡片</small
					>
					<div class="preview-movement-summary">
						<button
							v-for="summary in data.summaries"
							:key="summary.kind"
							:disabled="stale || failedSection === '货物流动'"
							@click="drill('movement-records', 'completed', { kind: summary.kind })"
						>
							<span>{{ summary.label }}</span
							><strong>{{
								state === "empty" ? "0" : quantityText(summary.quantity)
							}}</strong
							><small>{{ state === "empty" ? 0 : summary.count }} 笔记录</small>
						</button>
					</div>
					<h3>最近记录</h3>
					<div v-if="state !== 'empty'" class="browse-rank-list">
						<button
							v-for="(row, index) in [...data.movements]
								.sort((a, b) => b.date.localeCompare(a.date))
								.slice(0, 5)"
							:key="row.name + index"
							class="browse-rank-row"
							:disabled="stale || failedSection === '货物流动'"
							@click="emit('movement', row.name)"
						>
							<span
								>{{ row.itemName
								}}<small>{{ row.date }} · {{ row.name }}</small></span
							><b>{{ row.qty }} {{ row.uom }}</b>
						</button>
					</div>
					<p v-if="state === 'empty' || !data.movements.length">期间没有流动记录。</p>
					<p v-if="failedSection === '货物流动'" role="alert">
						货物流动更新失败。<button @click="failedSection = ''">重试货物流动</button>
					</p>
				</article>
				<article class="browse-card dashboard-loans" data-section="loans">
					<div class="browse-card-heading">
						<h2>借出中</h2>
						<button
							class="browse-link"
							:disabled="stale || failedSection === '借出中'"
							@click="drill('loan-records', 'open')"
						>
							查看借用
						</button>
					</div>
					<p>
						未归还记录数
						<strong>{{ state === "empty" ? 0 : data.loans.length }} 笔</strong>
					</p>
					<p>
						尚未归还数量
						<strong>{{
							state === "empty" ? "0" : quantityText(data.loanQuantities)
						}}</strong>
					</p>
					<div v-if="state !== 'empty'" class="browse-rank-list">
						<button
							v-for="loan in data.loans.slice(0, 5)"
							:key="loan.name"
							class="browse-rank-row"
							:disabled="stale || failedSection === '借出中'"
							@click="emit('loan', loan.name)"
						>
							<span
								>{{ loan.borrower }} ·
								{{
									loanStatus(
										reviewSession.loans.find(
											(row) => row.name === loan.name,
										) || loan,
									)
								}}<small>{{ loan.activity }} · {{ loan.loanDate }}</small
								><small
									v-for="(line, index) in loan.lines"
									:key="line.code + index"
									>{{
										reviewSession.stock.find((item) => item.code === line.code)
											?.name
									}}
									· {{ line.location }}</small
								></span
							><b>{{ loanQuantity(loan) }}</b>
						</button>
					</div>
					<p v-if="state === 'empty' || !data.loans.length">当前没有未归还借用。</p>
					<p v-if="failedSection === '借出中'" role="alert">
						借用更新失败。<button @click="failedSection = ''">重试借出中</button>
					</p>
				</article>
				<article class="browse-card dashboard-reminders" data-section="reminders">
					<h2>提醒事项</h2>
					<template v-if="state !== 'empty'"
						><button
							v-if="data.buckets.slice(0, 3).some((row) => row.count)"
							class="browse-rank-row"
							:disabled="stale || failedSection === '提醒事项'"
							@click="drill('expiry', 'expired')"
						>
							已过期批次
							<b
								>{{
									data.buckets
										.slice(0, 3)
										.reduce((sum, row) => sum + row.count, 0)
								}}
								个</b
							></button
						><button
							v-if="data.buckets[3].count"
							class="browse-rank-row"
							:disabled="stale || failedSection === '提醒事项'"
							@click="drill('expiry', 'soon')"
						>
							30 天内到期 <b>{{ data.buckets[3].count }} 个批次</b></button
						><button
							v-if="data.damaged"
							class="browse-rank-row"
							:disabled="stale || failedSection === '提醒事项'"
							@click="drill('pending', 'actionable')"
						>
							损坏库存 <b>{{ data.damaged }} 种物品</b>
						</button></template
					>
					<p
						v-if="
							state === 'empty' ||
							(!data.damaged && !data.buckets.slice(0, 4).some((row) => row.count))
						"
					>
						暂无需要处理的提醒。
					</p>
					<p v-if="failedSection === '提醒事项'" role="alert">
						提醒更新失败。<button @click="failedSection = ''">重试提醒事项</button>
					</p>
				</article>
			</div>
		</div>
	</div>
</template>
