<script setup lang="ts">
import { warehouseLabel } from "../../lib/warehouseLabel";
import { ref, useId } from "vue";
import { useResponsiveLayout } from "../../composables/useResponsiveLayout";
import DashboardSection from "../../components/DashboardSection.vue";
import QuickExport from "../../components/QuickExport.vue";
import FilterPanel from "../../components/ui/FilterPanel.vue";
import HierarchyFilter from "../../components/ui/HierarchyFilter.vue";
import PeriodFilter from "../../components/ui/PeriodFilter.vue";
import QuantitySummary from "../../components/ui/QuantitySummary.vue";
import UiButton from "../../components/ui/UiButton.vue";
import ReturnToTop from "../../components/ui/ReturnToTop.vue";
import { reportDefinitions, type ReportQuery } from "../../lib/reportContract";
import { movementLabels } from "../../lib/filterPresentation";
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
	distribution,
	maximum,
	loading,
	loanQuantity,
} = props.controller;
const showFilters = ref(false);
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
const { isMobile } = useResponsiveLayout();
</script>
<template>
	<div class="preview-dashboard">
		<h1 tabindex="-1">物资总览</h1>
		<div class="browse-toolbar">
			<label class="preview-field"
				>快速导出数据集<select v-model="reportDataset">
					<option v-for="(definition, id) in reportDefinitions" :key="id" :value="id">
						{{ definition.label }}
					</option>
				</select></label
			>
			<QuickExport
				:query="quickReportQuery"
				:active="active"
				@open-full="emit('openExport', $event)"
			/>
			<FilterPanel
				label="总览范围"
				:count="filters.warehouses.length + filters.categories.length"
				:active="active"
				@update:open="showFilters = $event"
			>
				<div class="preview-filter-fields">
					<HierarchyFilter
						v-model="filters.warehouses"
						:options="reference.warehouses"
						title="仓库 / 位置"
						placeholder="搜索位置"
					/>
					<HierarchyFilter
						v-model="filters.categories"
						:options="reference.categories"
						title="物品类别"
						placeholder="搜索类别"
					/>
				</div>
				<template #footer
					><span v-if="sections.inventory.hasResult" role="status"
						>{{ sections.inventory.result.item_count }} 种物品</span
					><UiButton
						:disabled="!filters.warehouses.length && !filters.categories.length"
						@click="
							filters.warehouses = [];
							filters.categories = [];
						"
						>清空范围</UiButton
					></template
				>
			</FilterPanel>
			<span>{{
				[...filters.warehouses, ...filters.categories]
					.map(
						(id) =>
							reference.warehouses.find((row) => row.name === id)?.label ||
							reference.categories.find((row) => row.name === id)?.label ||
							id,
					)
					.join(" · ") || "全部仓库 · 全部类别"
			}}</span>
			<UiButton @click="refresh">刷新</UiButton>
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
					<QuantitySummary :metrics="metrics" />
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
						><div class="browse-tabs">
							<button
								:aria-pressed="filters.distribution === 'location'"
								@click="filters.distribution = 'location'"
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
					<strong>物品种数 · {{ sections.distribution.result.item_count }} 种</strong>
					<p class="browse-note">
						按物品代码去重；同一物品可出现在多个仓库，分组数量不能相加为总数。
					</p>
					<div v-if="distribution.length" class="preview-distribution">
						<div class="preview-bar-axis">
							<span>0</span><span>{{ maximum }} 种</span>
						</div>
						<button
							v-for="bar in distribution"
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
					</div>
					<p v-else>当前范围没有库存分布。</p>
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
							<button
								class="browse-link"
								:disabled="blocked('expiry')"
								@click="drill('expiry')"
							>
								查看全部批次
							</button>
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
						class="browse-tabs"
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
								@click="drill('expiry')"
							>
								<span
									>{{ row.item_name
									}}<small
										>{{ row.batch_no }} · {{ row.expiry_date }} ·
										{{
											warehouseLabel(
												row.warehouse,
												reference.warehouses,
												row.warehouse_label,
											)
										}}</small
									></span
								><b>{{ row.available }} {{ row.stock_uom }}</b>
							</button>
						</div>
						<p v-if="!expiryPreview.length">
							{{
								filters.expiry === "expired"
									? "当前范围没有已过期批次。"
									: "当前范围没有未过期批次。"
							}}
						</p>
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
							><strong>{{ quantityText(row.quantities) }}</strong
							><small>{{ row.count }} 笔记录</small>
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
						>
							<span
								>{{
									row.item_names ||
									row.item_name ||
									movementLabels[row.kind || ""] ||
									"库存记录"
								}}<small
									>{{ movementLabels[row.kind || ""] || row.kind }} ·
									{{ row.document }} · {{ row.date }} ·
									{{ row.activity_title || "未关联活动" }}</small
								></span
							><b>{{ quantityText(row.quantities || []) }}</b>
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
