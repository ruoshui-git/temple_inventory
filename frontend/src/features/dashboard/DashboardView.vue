<script setup lang="ts">
import PageHeader from "../../components/ui/PageHeader.vue";
import { warehouseLabel } from "../../lib/warehouseLabel";
import { computed, ref, useId } from "vue";
import { useResponsiveLayout } from "../../composables/useResponsiveLayout";
import DashboardSection from "../../components/DashboardSection.vue";
import QuickExport from "../../components/QuickExport.vue";
import BrowseFilters from "../../components/filters/BrowseFilters.vue";
import FilterPanel from "../../components/ui/FilterPanel.vue";
import PeriodFilter from "../../components/ui/PeriodFilter.vue";
import QuantitySummary from "../../components/ui/QuantitySummary.vue";
import UiButton from "../../components/ui/UiButton.vue";
import ItemLine from "../../components/ui/ItemLine.vue";
import ReturnToTop from "../../components/ui/ReturnToTop.vue";
import PopupMenu from "../../components/ui/PopupMenu.vue";
import DisclosureIcon from "../../components/ui/DisclosureIcon.vue";
import { summarizeItems } from "../../lib/itemSummary";
import { formatQuantity } from "../../lib/formatQuantity";
import {
	browseDestination,
	countDestination,
	operationDestination,
} from "../../lib/nativeNavigation";
import { newReportQuery, type ReportDataset, type ReportQuery } from "../../lib/reportContract";
import { emptyScope, type BrowseScope } from "../../lib/browseQuery";
import type { AppRouteTarget } from "../../lib/routeRegistry";
import { movementLabels } from "../../lib/filterPresentation";
import { kindIcons } from "../../lib/kindIcons";
import { quantityText, type useDashboardController } from "./useDashboardController";
const props = withDefaults(
	defineProps<{
		controller: ReturnType<typeof useDashboardController>;
		active?: boolean;
	}>(),
	{ active: true },
);
const emit = defineEmits<{
	openDocument: [doctype: string, name: string];
	openExport: [query: ReportQuery];
	navigate: [route: AppRouteTarget];
}>();
const {
	reference,
	filters,
	sections,
	announcement,
	reportDataset,
	quickReportQuery,
	metrics,
	buckets,
	expiryPreview,
	movementSummary,
	refresh,
	updateSection,
	blocked,
	drill,
	distributionDrill,
	expiryDrill,
	expiryPreviewDrill,
	distribution,
	maximum,
	expiryCount,
	loading,
	loanQuantity,
	queryForDataset,
} = props.controller;
const distributionTop = computed(() => distribution.value.slice(0, 8));
const distributionRest = computed(() => distribution.value.slice(8));
const inventoryTopMetrics = computed(() =>
	metrics.value.map((metric) => ({ ...metric, quantities: metric.quantities.slice(0, 3) })),
);
const inventoryMoreMetrics = computed(() =>
	metrics.value.flatMap((metric) => {
		const rest = metric.quantities.slice(3);
		return rest.length ? [{ key: metric.key, label: metric.label, quantities: rest }] : [];
	}),
);
const showFilters = ref(false);
function effectLabel(effect: number, uom: string) {
	return effect > 0
		? `可用库存增加 ${effect} ${uom}`
		: effect < 0
			? `可用库存减少 ${Math.abs(effect)} ${uom}`
			: `可用库存不变 · ${uom}`;
}
const distributionId = useId();
const expiryId = useId();
function expiryKey(event: KeyboardEvent) {
	if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
	event.preventDefault();
	filters.expiry =
		event.key === "Home"
			? "expired"
			: event.key === "End"
				? "upcoming"
				: filters.expiry === "expired"
					? "upcoming"
					: "expired";
	(event.currentTarget as HTMLElement)
		.querySelector<HTMLElement>(`[data-expiry-tab="${filters.expiry}"]`)
		?.focus();
}
function distributionKey(event: KeyboardEvent) {
	if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
	event.preventDefault();
	filters.distribution =
		event.key === "Home"
			? "location"
			: event.key === "End"
				? "category"
				: filters.distribution === "location"
					? "category"
					: "location";
	(event.currentTarget as HTMLElement)
		.querySelector<HTMLElement>(`[data-distribution-tab="${filters.distribution}"]`)
		?.focus();
}
const { isMobile } = useResponsiveLayout();
const dashboardScope = computed<BrowseScope>({
	get: () => ({
		...emptyScope(),
		categories: [...filters.categories],
		warehouses: [...filters.warehouses],
		uncategorized: filters.uncategorized,
	}),
	set: (scope: BrowseScope) => {
		filters.categories = [...scope.categories];
		filters.warehouses = [...scope.warehouses];
		filters.uncategorized = scope.uncategorized;
	},
});
const scopeLabel = computed(() => {
	const values = [...filters.warehouses, ...filters.categories].map(
		(id) =>
			reference.warehouses.find((row) => row.name === id)?.label ||
			reference.categories.find((row) => row.name === id)?.label ||
			id,
	);
	if (filters.uncategorized) values.push("无分类");
	return values.join(" · ") || "全部仓库 · 全部类别";
});
const hasMoreActions = computed(
	() =>
		reference.operations.Reconcile === true ||
		["Damage", "Loss", "Repair", "Disposal"].some(canCreate) ||
		reference.operations.Return === true,
);
function canCreate(kind: string) {
	return reference.operations[kind] === true;
}
function quickAction(kind: string) {
	emit("navigate", operationDestination(kind));
}
function navigateMore(route: AppRouteTarget) {
	emit("navigate", route);
}
function chooseOutstandingLoan() {
	const query = newReportQuery("loans");
	query.view = "items";
	query.groupBy = ["item"];
	query.statuses = [1];
	query.outstandingOnly = true;
	emit("navigate", browseDestination(query));
}
function datasetChanged(dataset: ReportDataset) {
	reportDataset.value = dataset;
}
</script>
<template>
	<div class="preview-dashboard">
		<PageHeader title="物资总览">
			<template v-if="!isMobile" #actions>
				<UiButton icon="refresh" @click="refresh">刷新</UiButton>
				<QuickExport
					:query="quickReportQuery"
					:query-for-dataset="queryForDataset"
					:initial-dataset="reportDataset"
					allow-dataset-selection
					:active="active"
					@commit-dataset="datasetChanged"
					@open-full="emit('openExport', $event)"
				/>
			</template>
			<template #trailing>
				<div class="dashboard-scope-control">
					<FilterPanel
						label="总览范围"
						:count="
							filters.warehouses.length +
							filters.categories.length +
							Number(filters.uncategorized)
						"
						:active="active"
						@update:open="showFilters = $event"
					>
						<BrowseFilters
							v-model="dashboardScope"
							:fields="['warehouses', 'categories']"
						/>
						<template #footer>
							<span v-if="sections.inventory.hasResult" role="status"
								>{{ sections.inventory.result.item_count }} 种物品</span
							>
							<UiButton
								:disabled="
									!filters.warehouses.length &&
									!filters.categories.length &&
									!filters.uncategorized
								"
								@click="
									filters.warehouses = [];
									filters.categories = [];
									filters.uncategorized = false;
								"
								>清空范围</UiButton
							>
						</template>
					</FilterPanel>
					<span class="dashboard-scope-summary"
						><strong>范围</strong> {{ scopeLabel }}</span
					>
				</div>
			</template>
		</PageHeader>
		<div class="dashboard-quick-actions" aria-label="快速操作">
			<UiButton
				v-if="canCreate('Receive')"
				:icon="kindIcons.Receive.icon"
				@click="quickAction('Receive')"
				>{{ kindIcons.Receive.label }}</UiButton
			>
			<UiButton
				v-if="canCreate('Issue')"
				:icon="kindIcons.Issue.icon"
				@click="quickAction('Issue')"
				>{{ kindIcons.Issue.label }}</UiButton
			>
			<UiButton
				v-if="canCreate('Loan')"
				:icon="kindIcons.Loan.icon"
				@click="quickAction('Loan')"
				>{{ kindIcons.Loan.label }}</UiButton
			>
			<UiButton
				v-if="canCreate('Transfer')"
				:icon="kindIcons.Transfer.icon"
				@click="quickAction('Transfer')"
				>{{ kindIcons.Transfer.label }}</UiButton
			>
			<PopupMenu
				v-if="!isMobile && hasMoreActions"
				label="更多"
				variant="labeled"
				align="end"
				class="dashboard-more-actions"
			>
				<template #trigger>更多<DisclosureIcon variant="popup" /></template>
				<div class="dashboard-more-actions-menu">
					<UiButton
						v-if="reference.operations.Reconcile === true"
						:icon="kindIcons.Reconcile.icon"
						@click="navigateMore(countDestination())"
						>{{ kindIcons.Reconcile.label }}</UiButton
					>
					<UiButton
						v-if="canCreate('Damage')"
						:icon="kindIcons.Damage.icon"
						@click="quickAction('Damage')"
						>{{ kindIcons.Damage.label }}</UiButton
					>
					<UiButton
						v-if="canCreate('Loss')"
						:icon="kindIcons.Loss.icon"
						@click="quickAction('Loss')"
						>{{ kindIcons.Loss.label }}</UiButton
					>
					<UiButton
						v-if="canCreate('Repair')"
						:icon="kindIcons.Repair.icon"
						@click="quickAction('Repair')"
						>{{ kindIcons.Repair.label }}</UiButton
					>
					<UiButton
						v-if="canCreate('Disposal')"
						:icon="kindIcons.Disposal.icon"
						@click="quickAction('Disposal')"
						>{{ kindIcons.Disposal.label }}</UiButton
					>
					<UiButton
						v-if="reference.operations.Return === true"
						:icon="kindIcons.Return.icon"
						@click="chooseOutstandingLoan"
						>{{ kindIcons.Return.label }} · 选择未结清借用</UiButton
					>
				</div>
			</PopupMenu>
		</div>
		<div v-if="isMobile" class="dashboard-secondary-actions" aria-label="总览其他操作">
			<PopupMenu
				v-if="hasMoreActions"
				label="更多"
				variant="labeled"
				align="end"
				class="dashboard-more-actions"
			>
				<template #trigger>更多<DisclosureIcon variant="popup" /></template>
				<div class="dashboard-more-actions-menu">
					<UiButton
						v-if="reference.operations.Reconcile === true"
						:icon="kindIcons.Reconcile.icon"
						@click="navigateMore(countDestination())"
						>{{ kindIcons.Reconcile.label }}</UiButton
					>
					<UiButton
						v-if="canCreate('Damage')"
						:icon="kindIcons.Damage.icon"
						@click="quickAction('Damage')"
						>{{ kindIcons.Damage.label }}</UiButton
					>
					<UiButton
						v-if="canCreate('Loss')"
						:icon="kindIcons.Loss.icon"
						@click="quickAction('Loss')"
						>{{ kindIcons.Loss.label }}</UiButton
					>
					<UiButton
						v-if="canCreate('Repair')"
						:icon="kindIcons.Repair.icon"
						@click="quickAction('Repair')"
						>{{ kindIcons.Repair.label }}</UiButton
					>
					<UiButton
						v-if="canCreate('Disposal')"
						:icon="kindIcons.Disposal.icon"
						@click="quickAction('Disposal')"
						>{{ kindIcons.Disposal.label }}</UiButton
					>
					<UiButton
						v-if="reference.operations.Return === true"
						:icon="kindIcons.Return.icon"
						@click="chooseOutstandingLoan"
						>{{ kindIcons.Return.label }} · 选择未结清借用</UiButton
					>
				</div>
			</PopupMenu>
			<UiButton icon="refresh" variant="ghost" size="compact" @click="refresh"
				>刷新</UiButton
			>
			<QuickExport
				:query="quickReportQuery"
				:query-for-dataset="queryForDataset"
				:initial-dataset="reportDataset"
				allow-dataset-selection
				:active="active"
				@commit-dataset="datasetChanged"
				@open-full="emit('openExport', $event)"
			/>
		</div>
		<p class="sr-only" aria-live="polite">{{ announcement }}</p>
		<div class="preview-dashboard-grid" :aria-busy="loading">
			<div class="preview-dashboard-column">
				<DashboardSection
					:section="sections.inventory"
					:snapshot="sections.inventory.result.snapshot"
					title="库存概览"
					class="dashboard-inventory"
					data-section="inventory"
					@retry="updateSection('inventory', true)"
				>
					<template #heading
						><div class="browse-card-heading">
							<h2>库存概览</h2>
							<button
								class="browse-link"
								:disabled="blocked('inventory')"
								@click="drill('inventory')"
							>
								查看库存
							</button>
						</div></template
					>
					<QuantitySummary :metrics="inventoryTopMetrics" />
					<details
						v-if="inventoryMoreMetrics.length"
						class="ti-disclosure dashboard-unit-disclosure"
					>
						<summary>
							<DisclosureIcon variant="inline" />+{{
								inventoryMoreMetrics.reduce(
									(count, metric) => count + metric.quantities.length,
									0,
								)
							}}
							单位
						</summary>
						<p
							v-for="metric in inventoryMoreMetrics"
							:key="metric.key"
							class="dashboard-unit-rest"
						>
							<strong>{{ metric.label }}：</strong
							>{{
								metric.quantities
									.map(
										(quantity) =>
											`${formatQuantity(quantity.qty)} ${quantity.uom}`,
									)
									.join(" · ")
							}}
						</p>
					</details>
				</DashboardSection>
				<DashboardSection
					:section="sections.distribution"
					:snapshot="sections.distribution.result.snapshot"
					title="库存分布"
					class="dashboard-distribution"
					data-section="distribution"
					@retry="updateSection('distribution', true)"
				>
					<template #heading><h2>库存分布</h2></template>
					<template #controls
						><div
							class="segmented dashboard-segmented"
							role="tablist"
							aria-label="库存分布方式"
							@keydown="distributionKey"
						>
							<button
								role="tab"
								:id="`${distributionId}-location`"
								:data-distribution-tab="'location'"
								:aria-selected="filters.distribution === 'location'"
								:tabindex="filters.distribution === 'location' ? 0 : -1"
								:aria-controls="`${distributionId}-panel`"
								@click="filters.distribution = 'location'"
							>
								按仓库</button
							><button
								role="tab"
								:id="`${distributionId}-category`"
								:data-distribution-tab="'category'"
								:aria-selected="filters.distribution === 'category'"
								:tabindex="filters.distribution === 'category' ? 0 : -1"
								:aria-controls="`${distributionId}-panel`"
								@click="filters.distribution = 'category'"
							>
								按类别
							</button>
						</div></template
					>
					<div
						:id="`${distributionId}-panel`"
						role="tabpanel"
						:aria-labelledby="`${distributionId}-${filters.distribution}`"
						tabindex="0"
					>
						<strong
							>物品种数 · {{ sections.distribution.result.item_count }} 种</strong
						>
						<p class="browse-note">
							按物品代码去重；同一物品可出现在多个仓库，分组数量不能相加为总数。
						</p>
						<div v-if="distribution.length" class="preview-distribution">
							<button
								v-for="bar in distributionTop"
								:key="bar.id"
								class="preview-bar"
								:disabled="blocked('distribution')"
								@click="distributionDrill(bar)"
							>
								<span>{{ bar.label }}</span
								><span class="preview-bar-track"
									><span
										:style="{
											width: `${((bar.item_count || 0) / maximum) * 100}%`,
										}" /></span
								><b>{{ bar.item_count }}</b>
							</button>
							<details
								v-if="distributionRest.length"
								class="ti-disclosure dashboard-inline-disclosure"
							>
								<summary>
									<DisclosureIcon variant="inline" />其余
									{{ distributionRest.length }} 个{{
										filters.distribution === "location" ? "位置" : "类别"
									}}
								</summary>
								<button
									v-for="bar in distributionRest"
									:key="bar.id"
									class="preview-bar"
									:disabled="blocked('distribution')"
									@click="distributionDrill(bar)"
								>
									<span>{{ bar.label }}</span
									><span class="preview-bar-track"
										><span
											:style="{
												width: `${((bar.item_count || 0) / maximum) * 100}%`,
											}" /></span
									><b>{{ bar.item_count }}</b>
								</button>
							</details>
						</div>
						<p v-if="!distribution.length">当前范围没有库存分布。</p>
						<details
							v-if="
								filters.distribution === 'location' &&
								sections.distribution.result.empty_count
							"
							class="ti-disclosure dashboard-empty-locations"
						>
							<summary>
								<DisclosureIcon variant="inline" />另有
								{{ sections.distribution.result.empty_count }} 个位置当前无可用库存
							</summary>
							<ul>
								<li
									v-for="(label, index) in sections.distribution.result
										.empty_labels"
									:key="`${label}-${index}`"
								>
									<span>{{ label }}</span
									><b>0</b>
								</li>
							</ul>
						</details>
					</div>
				</DashboardSection>
				<DashboardSection
					:section="sections.expiry"
					:snapshot="sections.expiry.result.snapshot"
					title="效期概览"
					class="dashboard-expiry"
					data-section="expiry"
					@retry="updateSection('expiry', true)"
				>
					<template #heading
						><div class="browse-card-heading">
							<h2>效期概览</h2>
						</div></template
					>

					<div class="preview-expiry-grid">
						<button
							v-for="bucket in buckets"
							:key="bucket.id"
							:class="{ 'is-expired': bucket.id.startsWith('expired') }"
							:disabled="blocked('expiry')"
							@click="expiryDrill(bucket.id)"
						>
							<span>{{ bucket.label }}</span
							><strong>{{ bucket.count }} 个批次</strong>
						</button>
					</div>
					<div
						class="segmented dashboard-segmented"
						role="tablist"
						aria-label="批次列表范围"
						@keydown="expiryKey"
					>
						<button
							v-for="[key, label] in [
								['expired', '已过期'],
								['upcoming', '未过期'],
							]"
							:key="key"
							:id="`${expiryId}-${key}`"
							:data-expiry-tab="key"
							role="tab"
							:aria-selected="filters.expiry === key"
							:tabindex="filters.expiry === key ? 0 : -1"
							:aria-controls="`${expiryId}-panel`"
							@click="filters.expiry = key!"
						>
							{{ label }}
						</button>
					</div>
					<p class="dashboard-expiry-caption">
						最早到期的 {{ sections.expiry.result.expiry_preview_limit }} 个批次 · 共
						{{ expiryCount }} 个
					</p>
					<div
						:id="`${expiryId}-panel`"
						role="tabpanel"
						:aria-labelledby="`${expiryId}-${filters.expiry}`"
						tabindex="0"
					>
						<div class="browse-rank-list">
							<button
								v-for="row in expiryPreview"
								:key="`${row.item_name}/${row.batch_no}/${row.warehouse}`"
								class="browse-rank-row"
								:disabled="blocked('expiry')"
								@click="expiryPreviewDrill(filters.expiry)"
							>
								<div class="browse-grow">
									<ItemLine
										:item="{
											code: String(row.item_code || ''),
											name: String(row.item_name || row.item_code || ''),
											image: String(row.image || ''),
										}"
									/>
									<dl class="ti-fields">
										<div>
											<dt>批次</dt>
											<dd :title="row.batch_no">{{ row.batch_no }}</dd>
										</div>
										<div>
											<dt>到期</dt>
											<dd>{{ row.expiry_date }}</dd>
										</div>
										<div>
											<dt>库位</dt>
											<dd>
												{{
													warehouseLabel(
														row.warehouse,
														reference.warehouses,
														row.warehouse_label,
													)
												}}
											</dd>
										</div>
									</dl>
								</div>
								<b>{{ row.available }} {{ row.stock_uom }}</b>
							</button>
						</div>
						<p v-if="!expiryPreview.length">
							{{
								filters.expiry === "expired"
									? "当前范围没有已过期批次。"
									: "当前范围没有未过期批次。"
							}}
						</p>
						<button
							class="browse-link dashboard-expiry-all"
							:disabled="blocked('expiry')"
							@click="expiryPreviewDrill(filters.expiry)"
						>
							查看全部 {{ expiryCount }} 个
						</button>
					</div>
				</DashboardSection>
			</div>
			<div class="preview-dashboard-column">
				<DashboardSection
					:section="sections.movement"
					:snapshot="sections.movement.result.snapshot"
					title="货物流动"
					class="dashboard-movement"
					data-section="movement"
					@retry="updateSection('movement', true)"
				>
					<template #heading
						><div class="browse-card-heading">
							<h2>货物流动</h2>
							<button
								class="browse-link"
								:disabled="blocked('movement')"
								@click="drill('movement')"
							>
								查看记录
							</button>
						</div></template
					>
					<template #controls
						><PeriodFilter
							v-model="filters.period"
							:today="reference.siteDate"
							label="流动日期"
						/><small>日期仅影响本卡片</small></template
					>
					<div class="preview-movement-summary">
						<button
							v-for="row in movementSummary"
							:key="row.kind"
							class="dashboard-movement-tile"
							:title="
								row.quantities
									.map((quantity) => `${quantity.qty} ${quantity.uom}`)
									.join(' · ') || row.label
							"
							:disabled="blocked('movement')"
							@click="
								drill('movement', {
									scope: {
										...sections.movement.result.query.scope,
										kinds: [row.kind],
									},
								})
							"
						>
							<span>{{ row.label }}</span
							><strong
								v-for="quantity in row.quantities.slice(0, 2)"
								:key="quantity.uom"
								class="stock-effect"
								:class="
									quantity.effect > 0
										? 'is-increase'
										: quantity.effect < 0
											? 'is-decrease'
											: 'is-neutral'
								"
								>{{ quantity.qty }} {{ quantity.uom
								}}<span class="sr-only">{{
									effectLabel(quantity.effect, quantity.uom)
								}}</span></strong
							><small v-if="row.quantities.length > 2"
								>+{{ row.quantities.length - 2 }} 单位</small
							>
							<small>{{ row.count }} 笔记录</small>
						</button>
					</div>
					<h3>最近记录</h3>
					<div class="browse-rank-list">
						<button
							v-for="row in sections.movement.result.rows"
							:key="`${row.doctype}/${row.document}`"
							class="browse-rank-row"
							:disabled="blocked('movement')"
							@click="emit('openDocument', row.doctype!, row.document!)"
							:title="
								row.item_names?.join('、') ||
								row.item_name ||
								movementLabels[row.kind || ''] ||
								'库存记录'
							"
							:aria-label="`${row.item_names?.join('、') || row.item_name || movementLabels[row.kind || ''] || '库存记录'}，${row.document}`"
						>
							<span
								>{{
									summarizeItems(
										row.item_names || (row.item_name ? [row.item_name] : []),
										Number(row.item_count || 0) || (row.item_name ? 1 : 0),
									)
								}}<small
									>{{ movementLabels[row.kind || ""] || "其他类型" }} ·
									{{ row.document }} · {{ row.date }} ·
									{{ row.activity_title || "未关联活动" }}</small
								></span
							>
							<b
								v-for="quantity in row.quantities || []"
								:key="quantity.uom"
								class="stock-effect"
								:class="
									Number(quantity.effect || 0) > 0
										? 'is-increase'
										: Number(quantity.effect || 0) < 0
											? 'is-decrease'
											: 'is-neutral'
								"
								:title="effectLabel(Number(quantity.effect || 0), quantity.uom)"
								>{{ quantity.qty }} {{ quantity.uom
								}}<span class="sr-only">{{
									effectLabel(Number(quantity.effect || 0), quantity.uom)
								}}</span></b
							>
						</button>
					</div>
					<p v-if="!sections.movement.result.rows.length">期间没有流动记录。</p>
				</DashboardSection>
				<DashboardSection
					:section="sections.loans"
					:snapshot="sections.loans.result.snapshot"
					title="借出中"
					class="dashboard-loans"
					data-section="loans"
					@retry="updateSection('loans', true)"
				>
					<template #heading
						><div class="browse-card-heading">
							<h2>借出中</h2>
							<button
								class="browse-link"
								:disabled="blocked('loans')"
								@click="drill('loans')"
							>
								查看借用
							</button>
						</div></template
					>
					<p>
						未归还记录数 <strong>{{ sections.loans.result.matched_count }} 笔</strong>
					</p>
					<p>
						尚未归还数量 <strong>{{ loanQuantity }}</strong>
					</p>
					<div class="browse-rank-list">
						<button
							v-for="row in sections.loans.result.rows"
							:key="`${row.doctype}/${row.document}`"
							class="browse-rank-row"
							:disabled="blocked('loans')"
							@click="emit('openDocument', row.doctype!, row.document!)"
						>
							<span
								>{{ row.borrower }} · 未归还<small
									>{{ row.activity_title || "未关联活动" }} ·
									{{ row.date }}</small
								><small>{{ row.document }}</small></span
							><b>{{ quantityText(row.quantities || []) }}</b>
						</button>
					</div>
					<p v-if="!sections.loans.result.rows.length">当前没有未归还借用。</p>
				</DashboardSection>
				<DashboardSection
					:section="sections.reminders"
					:snapshot="sections.reminders.result.snapshot"
					title="提醒事项"
					class="dashboard-reminders"
					data-section="reminders"
					@retry="updateSection('reminders', true)"
				>
					<template #heading><h2>提醒事项</h2></template>
					<button
						v-if="sections.reminders.result.expired_count"
						class="browse-rank-row"
						:disabled="blocked('reminders')"
						@click="drill('reminders', { expiryWindow: 'expired' })"
					>
						已过期批次 <b>{{ sections.reminders.result.expired_count }} 个批次</b>
					</button>
					<button
						v-if="
							sections.reminders.result.buckets.find(
								(row) => row.id === 'upcoming_0_30',
							)?.count
						"
						class="browse-rank-row"
						:disabled="blocked('reminders')"
						@click="drill('reminders', { expiryWindow: 'next_30' })"
					>
						30 天内到期
						<b
							>{{
								sections.reminders.result.buckets.find(
									(row) => row.id === "upcoming_0_30",
								)?.count
							}}
							个批次</b
						>
					</button>
					<button
						v-if="sections.reminders.result.damaged_item_count"
						class="browse-rank-row"
						:disabled="blocked('reminders')"
						@click="
							drill('reminders', {
								dataset: 'inventory',
								view: 'summary',
								damageOnly: true,
							})
						"
					>
						损坏库存 <b>{{ sections.reminders.result.damaged_item_count }} 种物品</b>
					</button>
					<p
						v-if="
							!sections.reminders.result.expired_count &&
							!sections.reminders.result.damaged_item_count &&
							!sections.reminders.result.buckets.find(
								(row) => row.id === 'upcoming_0_30',
							)?.count
						"
					>
						暂无需要处理的提醒。
					</p>
				</DashboardSection>
			</div>
		</div>
		<ReturnToTop :active="active" :hidden="isMobile && showFilters" />
	</div>
</template>

<style scoped>
@media (max-width: 1023px) {
	.dashboard-quick-actions {
		display: grid;
		grid-template-columns: repeat(4, minmax(0, 1fr));
		gap: 8px;
	}
	.dashboard-quick-actions > :deep(.ui-button),
	.dashboard-quick-actions > :deep(.popup-menu-trigger) {
		min-width: 0;
		min-height: 68px;
		padding: 7px 2px;
		flex-direction: column;
		gap: 4px;
		font-size: 0.78rem;
	}
	.dashboard-quick-actions > :deep(.ui-button svg) {
		width: 20px;
		height: 20px;
	}
	.dashboard-secondary-actions {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: 8px;
		margin-top: -4px;
	}
	.dashboard-secondary-actions :deep(.ui-button),
	.dashboard-secondary-actions :deep(.popup-menu-trigger) {
		min-height: 36px;
		padding: 4px 8px;
		border-color: transparent;
		background: transparent;
		box-shadow: none;
		color: var(--p-muted);
		font-size: 0.84rem;
	}
	.dashboard-inventory :deep(.browse-card-heading) {
		justify-content: flex-start;
		align-items: center;
		gap: 8px;
	}
	.dashboard-inventory :deep(.browse-card-heading h2) {
		margin: 0;
	}
	.dashboard-inventory :deep(.browse-card-heading > :first-child) {
		flex: 0 1 auto;
	}
	.dashboard-inventory :deep(.browse-card-heading .browse-link) {
		margin-inline-start: 0;
		white-space: nowrap;
	}
}
</style>
