<script setup lang="ts">
import { activityLabel } from "./activityData";
import PreviewQuickReport from "./components/PreviewQuickReport.vue";
import { newReportQuery, reportDefinitions, type ReportDataset } from "./reportModel";
import { computed, onBeforeUnmount, ref, watch, reactive, onActivated } from "vue";
import PreviewDashboardSection from "./components/PreviewDashboardSection.vue";
import PreviewReturnToTop from "./components/PreviewReturnToTop.vue";
import PreviewFilterPanel from "./components/PreviewFilterPanel.vue";
import { useResponsiveLayout } from "../composables/useResponsiveLayout";
import PreviewUiButton from "./components/PreviewUiButton.vue";
import PreviewPeriodFilter from "./components/PreviewPeriodFilter.vue";
import PreviewHierarchyFilter from "./components/PreviewHierarchyFilter.vue";
import PreviewQuantitySummary from "./components/PreviewQuantitySummary.vue";
import { reviewSession, type PreviewPage } from "./reviewModel";
import {
	dashboardData,
	dashboardScope,
	dashboardSections,
	type DashboardSectionKey,
	type DashboardSectionState,
} from "./dashboardModel";
import { matchesWarehouse, quantityText, remaining } from "./browseModel";
import { previewDate } from "./model";
const { isMobile } = useResponsiveLayout();
const props = withDefaults(defineProps<{ active?: boolean }>(), { active: true });
const emit = defineEmits<{
	navigate: [page: PreviewPage, variant: string];
	movement: [name: string];
	loan: [name: string];
}>();
const reportDataset = ref<ReportDataset>("inventory");
const quickReportQuery = computed(() => {
	const query = newReportQuery(reportDataset.value);
	query.scope.warehouses = [...filters.value.warehouses];
	query.scope.categories = [...filters.value.categories];
	if (reportDataset.value === "movements") query.scope.period = { ...filters.value.period };
	return query;
});
const filters = computed(() => reviewSession.filters.dashboard);
const sections = reactive(
	Object.fromEntries(
		Object.keys(dashboardSections).map((key) => [
			key,
			{
				status: "ready",
				hasResult: true,
				result: dashboardData(reviewSession),
			},
		]),
	) as Record<DashboardSectionKey, DashboardSectionState>,
);
const data = computed(() => ({
	...sections.inventory.result,
	batches: sections.expiry.result.batches,
	buckets: sections.expiry.result.buckets,
	movements: sections.movement.result.movements,
	summaries: sections.movement.result.summaries,
	loans: sections.loans.result.loans,
	loanQuantities: sections.loans.result.loanQuantities,
	damaged: sections.reminders.result.damaged,
}));
const showFilters = ref(false);
const scopeResultCount = computed(() => dashboardData(reviewSession).stock.length);
const state = ref("ready");
const failedSection = ref("");
const withoutResult = ref(false);
const announcement = ref("");
const timers = new Map<DashboardSectionKey, ReturnType<typeof setTimeout>>();
const keys = Object.keys(dashboardSections) as DashboardSectionKey[];
function blocked(key: DashboardSectionKey) {
	return sections[key].status !== "ready";
}
function updateSection(key: DashboardSectionKey, retry = false) {
	clearTimeout(timers.get(key));
	sections[key].status = retry ? "retrying" : "loading";
	timers.set(
		key,
		setTimeout(() => {
			sections[key].result = dashboardData(reviewSession);
			sections[key].hasResult = true;
			sections[key].status = "ready";
			announcement.value = `${dashboardSections[key]}更新成功`;
			if (keys.every((key) => !["loading", "retrying"].includes(sections[key].status)))
				state.value = "ready";
		}, 500),
	);
}
function recover() {
	for (const key of keys) {
		clearTimeout(timers.get(key));
		sections[key].result = dashboardData(reviewSession);
		sections[key].hasResult = true;
		sections[key].status = "ready";
	}
	state.value = "ready";
	failedSection.value = "";
}
onActivated(() => {
	if (keys.every((key) => !blocked(key))) recover();
});
onBeforeUnmount(() => timers.forEach(clearTimeout));
function failSelectedSection(title = failedSection.value) {
	const key = keys.find((key) => dashboardSections[key] === title);
	if (!key) return;
	clearTimeout(timers.get(key));
	sections[key].status = "error";
	sections[key].hasResult = !withoutResult.value;
	announcement.value = `${title}更新失败`;
}
watch(failedSection, (title) => failSelectedSection(title));
watch(state, (value) => {
	if (value === "ready" || value === "empty") {
		for (const key of keys) {
			if (sections[key].status === "error" || sections[key].status === "retrying") continue;
			sections[key].status = "ready";
			sections[key].hasResult = true;
		}
	}
	if (value === "loading" || value === "refreshing")
		for (const key of keys) {
			sections[key].status = "loading";
			if (value === "loading") sections[key].hasResult = false;
		}
});
function refresh() {
	state.value = "refreshing";
	for (const key of keys) updateSection(key);
}
watch(() => [filters.value.warehouses, filters.value.categories], refresh, { deep: true });
watch(
	() => filters.value.period,
	() => {
		if (sections.movement.status !== "error") updateSection("movement");
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
const recentRecords = computed(() =>
	[...new Set(data.value.movements.map((row) => row.name))]
		.map((name) => {
			const lines = data.value.movements.filter((row) => row.name === name);
			return {
				name,
				date: lines[0].date,
				names: [...new Set(lines.map((row) => row.itemName))].join("、"),
				quantities: quantityText(lines),
			};
		})
		.sort((a, b) => b.date.localeCompare(a.date))
		.slice(0, 5),
);
const expiryPreview = computed(() => {
	const map = new Map<string, (typeof data.value.batches)[number]>();
	data.value.batches
		.filter((row) =>
			filters.value.expiry === "expired"
				? row.bucket.startsWith("expired")
				: row.bucket.startsWith("upcoming"),
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
					!sections.distribution.result.scope.categories.length ||
					sections.distribution.result.scope.categories.includes(category.name),
			)
			.map((row) => ({
				name: row.name,
				label: row.label,
				count: sections.distribution.result.stock.filter(
					(item) => item.category === row.name,
				).length,
			}));
	const selected = sections.distribution.result.scope.warehouses;
	const nodes = reviewSession.warehouses.filter((row) =>
		selected.length
			? selected.some((name) => row.parent === name || (row.name === name && !row.is_group))
			: !row.parent,
	);
	return nodes.map((row) => ({
		name: row.name,
		label: row.label,
		count: sections.distribution.result.stock.filter((item) =>
			item.locations.some((location) =>
				matchesWarehouse(location.location, [row.name], reviewSession),
			),
		).length,
	}));
});
const maximum = computed(() => Math.max(1, ...distribution.value.map((row) => row.count)));
const stale = computed(
	() =>
		(state.value === "loading" || state.value === "refreshing") &&
		keys.some((key) => ["loading", "retrying"].includes(sections[key].status)),
);
function drill(
	page: PreviewPage,
	variant: string,
	options: { kind?: string; bucket?: string; warehouse?: string; category?: string } = {},
	sourceSection?: DashboardSectionKey,
) {
	const section =
		page === "expiry"
			? "expiry"
			: page === "pending"
				? "reminders"
				: page.startsWith("movement")
					? "movement"
					: page.startsWith("loan")
						? "loans"
						: options.warehouse || options.category
							? "distribution"
							: "inventory";
	if (blocked(sourceSection || section)) return;
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
			<label class="preview-field"
				>快速报表数据集<select v-model="reportDataset">
					<option v-for="(definition, id) in reportDefinitions" :key="id" :value="id">
						{{ definition.label }}
					</option>
				</select></label
			><PreviewQuickReport
				:query="quickReportQuery"
				:active="active"
				@navigate="(page, variant) => emit('navigate', page as PreviewPage, variant)"
			/>
			<PreviewFilterPanel
				label="总览范围"
				:count="filters.warehouses.length + filters.categories.length"
				:active="active"
				@update:open="showFilters = $event"
			>
				<div class="preview-filter-fields">
					<PreviewHierarchyFilter
						v-model="filters.warehouses"
						:options="reviewSession.warehouses"
						title="仓库 / 位置"
						placeholder="搜索位置"
					/>
					<PreviewHierarchyFilter
						v-model="filters.categories"
						:options="categories"
						title="物品类别"
						placeholder="搜索类别"
					/>
				</div>
				<template #footer>
					<span role="status">{{ scopeResultCount }} 种物品</span>
					<PreviewUiButton
						:disabled="!filters.warehouses.length && !filters.categories.length"
						@click="
							filters.warehouses = [];
							filters.categories = [];
						"
						>清空范围</PreviewUiButton
					>
				</template> </PreviewFilterPanel
			><span>{{
				[...filters.warehouses, ...filters.categories].join(" · ") || "全部仓库 · 全部类别"
			}}</span
			><PreviewUiButton @click="refresh">刷新</PreviewUiButton
			><small>样本日期 {{ previewDate }}</small>
		</div>
		<details class="preview-state-controls">
			<summary>预览状态</summary>
			<label class="preview-field"
				>数据状态<select v-model="state">
					<option value="ready">正常</option>
					<option value="loading">首次加载</option>
					<option value="empty">空数据</option>
					<option value="refreshing">保留内容刷新</option>
				</select></label
			><label class="preview-field"
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
			><label class="preview-choice-label"
				><input type="checkbox" v-model="withoutResult" />失败时无上次结果</label
			><PreviewUiButton :disabled="!failedSection" @click="failSelectedSection()"
				>模拟失败</PreviewUiButton
			><PreviewUiButton @click="recover">恢复</PreviewUiButton>
		</details>
		<p class="sr-only" aria-live="polite">{{ announcement }}</p>
		<p v-if="stale" role="status">
			{{ state === "loading" ? "正在加载物资总览…" : "正在更新当前范围，已保留上次内容…" }}
		</p>
		<div
			v-if="state === 'loading' && keys.every((key) => sections[key].status === 'loading')"
			class="browse-skeleton"
			aria-hidden="true"
		>
			　
		</div>
		<div v-else class="preview-dashboard-grid" :aria-busy="stale">
			<div class="preview-dashboard-column">
				<PreviewDashboardSection
					:section="sections.inventory"
					title="库存概览"
					@retry="updateSection('inventory', true)"
					class="browse-card dashboard-inventory"
					data-section="inventory"
				>
					<template #heading
						><div class="browse-card-heading">
							<h2>库存概览</h2>
							<button
								class="browse-link"
								:disabled="blocked('inventory')"
								@click="drill('inventory', 'list')"
							>
								查看库存
							</button>
						</div></template
					>
					<PreviewQuantitySummary :metrics="metrics" />
				</PreviewDashboardSection>
				<PreviewDashboardSection
					:section="sections.distribution"
					title="库存分布"
					@retry="updateSection('distribution', true)"
					class="browse-card dashboard-distribution"
					data-section="distribution"
				>
					<template #heading><h2>库存分布</h2></template
					><template #controls
						><div class="browse-tabs">
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
						</div></template
					>

					<strong
						>物品种数 ·
						{{ state === "empty" ? 0 : sections.distribution.result.stock.length }}
						种</strong
					>
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
							:disabled="blocked('distribution')"
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
				</PreviewDashboardSection>
				<PreviewDashboardSection
					:section="sections.expiry"
					title="效期概览"
					@retry="updateSection('expiry', true)"
					class="browse-card dashboard-expiry"
					data-section="expiry"
				>
					<template #heading
						><div class="browse-card-heading">
							<h2>效期概览</h2>
							<button
								class="browse-link"
								:disabled="blocked('expiry')"
								@click="drill('expiry', 'all')"
							>
								查看全部批次
							</button>
						</div></template
					><template #controls
						><div class="browse-tabs">
							<button
								:aria-pressed="filters.expiry === 'expired'"
								@click="filters.expiry = 'expired'"
							>
								已过期</button
							><button
								:aria-pressed="filters.expiry === 'upcoming'"
								@click="filters.expiry = 'upcoming'"
							>
								未过期
							</button>
						</div></template
					>
					<div class="preview-expiry-grid">
						<button
							v-for="bucket in data.buckets"
							:key="bucket.key"
							:class="{ 'is-expired': bucket.key.startsWith('expired') }"
							:disabled="blocked('expiry')"
							@click="drill('expiry', 'all', { bucket: bucket.key })"
						>
							<span>{{ bucket.label }}</span
							><strong>{{ state === "empty" ? 0 : bucket.count }} 个批次</strong>
						</button>
					</div>

					<div v-if="state !== 'empty'" class="browse-rank-list">
						<button
							v-for="row in expiryPreview"
							:key="row.item.code + row.id"
							class="browse-rank-row"
							:disabled="blocked('expiry')"
							@click="
								drill(
									'expiry',
									filters.expiry === 'expired' ? 'expired' : 'unexpired',
								)
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
				</PreviewDashboardSection>
			</div>
			<div class="preview-dashboard-column">
				<PreviewDashboardSection
					:section="sections.movement"
					title="货物流动"
					@retry="updateSection('movement', true)"
					class="browse-card dashboard-movement"
					data-section="movement"
				>
					<template #heading
						><div class="browse-card-heading">
							<h2>货物流动</h2>
							<button
								class="browse-link"
								:disabled="blocked('movement')"
								@click="drill('movement-records', 'completed')"
							>
								查看记录
							</button>
						</div></template
					><template #controls
						><PreviewPeriodFilter v-model="filters.period" label="流动日期" /><small
							>日期仅影响本卡片</small
						>
					</template>
					<div class="preview-movement-summary">
						<button
							v-for="summary in data.summaries"
							:key="summary.kind"
							:disabled="blocked('movement')"
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
							v-for="(row, index) in recentRecords"
							:key="row.name + index"
							class="browse-rank-row"
							:disabled="blocked('movement')"
							@click="emit('movement', row.name)"
						>
							<span
								>{{ row.names
								}}<small>{{ row.date }} · {{ row.name }}</small></span
							><b>{{ row.quantities }}</b>
						</button>
					</div>
					<p v-if="state === 'empty' || !data.movements.length">期间没有流动记录。</p>
				</PreviewDashboardSection>
				<PreviewDashboardSection
					:section="sections.loans"
					title="借出中"
					@retry="updateSection('loans', true)"
					class="browse-card dashboard-loans"
					data-section="loans"
				>
					<template #heading
						><div class="browse-card-heading">
							<h2>借出中</h2>
							<button
								class="browse-link"
								:disabled="blocked('loans')"
								@click="drill('loan-records', 'open')"
							>
								查看借用
							</button>
						</div></template
					>
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
							:disabled="blocked('loans')"
							@click="emit('loan', loan.name)"
						>
							<span
								>{{ loan.borrower }} · {{ loan.statusLabel
								}}<small
									>{{ activityLabel(loan.activity) }} ·
									{{ loan.loanDate }}</small
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
				</PreviewDashboardSection>
				<PreviewDashboardSection
					:section="sections.reminders"
					title="提醒事项"
					@retry="updateSection('reminders', true)"
					class="browse-card dashboard-reminders"
					data-section="reminders"
				>
					<template #heading><h2>提醒事项</h2></template>
					<template v-if="state !== 'empty'"
						><button
							v-if="
								sections.reminders.result.buckets
									.slice(0, 3)
									.some((row) => row.count)
							"
							class="browse-rank-row"
							:disabled="blocked('reminders')"
							@click="drill('expiry', 'expired', {}, 'reminders')"
						>
							已过期批次
							<b
								>{{
									sections.reminders.result.buckets
										.slice(0, 3)
										.reduce((sum, row) => sum + row.count, 0)
								}}
								个</b
							></button
						><button
							v-if="sections.reminders.result.buckets[3].count"
							class="browse-rank-row"
							:disabled="blocked('reminders')"
							@click="drill('expiry', 'soon', {}, 'reminders')"
						>
							30 天内到期
							<b>{{ sections.reminders.result.buckets[3].count }} 个批次</b></button
						><button
							v-if="data.damaged"
							class="browse-rank-row"
							:disabled="blocked('reminders')"
							@click="drill('pending', 'actionable')"
						>
							损坏库存 <b>{{ data.damaged }} 种物品</b>
						</button></template
					>
					<p
						v-if="
							state === 'empty' ||
							(!data.damaged &&
								!sections.reminders.result.buckets
									.slice(0, 4)
									.some((row) => row.count))
						"
					>
						暂无需要处理的提醒。
					</p>
				</PreviewDashboardSection>
			</div>
		</div>
		<PreviewReturnToTop :active="props.active" :hidden="isMobile && showFilters" />
	</div>
</template>
