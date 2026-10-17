<script setup lang="ts">
import { useOptionalReferenceData } from "../../services/contracts";
import { warehouseLabel } from "../../lib/warehouseLabel";
import Overlay from "../../components/ui/Overlay.vue";
import { ref, computed } from "vue";
import type { ProductDetail } from "./useProductDetail";
import type { ReportQuery } from "../../lib/reportContract";
import InventoryIcon from "../../components/InventoryIcon.vue";
import ItemImage from "../../components/ItemImage.vue";
import Attachments from "../../components/Attachments.vue";
import QuickExport from "../../components/QuickExport.vue";
import UiButton from "../../components/ui/UiButton.vue";
import QuantitySummary from "../../components/ui/QuantitySummary.vue";
import ReportTable from "../../components/ui/ReportTable.vue";
import ItemConversions from "./ItemConversions.vue";
const props = withDefaults(defineProps<{ controller: ProductDetail; active?: boolean }>(), {
	active: true,
});
const emit = defineEmits<{
	edit: [code: string];
	back: [];
	tab: [value: string];
	browse: [query: ReportQuery];
	openDocument: [doctype: string, name: string];
	openExport: [query: ReportQuery];
}>();
const c = props.controller;
const { stockItem: item, loading, error, tab, batches, files } = c;
const movementTable = c.movements.mainTable,
	loanTable = c.loans.mainTable;
const metrics = computed(() =>
	item.value
		? (
				[
					["available", "可用", "success"],
					["loaned", "借出", "warning"],
					["damaged", "损坏", "danger"],
				] as const
			).map(([key, label, tone]) => ({
				key,
				label,
				tone,
				quantities: [{ uom: item.value!.uom, qty: item.value![key] }],
			}))
		: [],
);
const batchDetail = ref<(typeof batches.value)[number]>();
const warehouseReference = useOptionalReferenceData();
</script>
<template>
	<section class="preview-browse-page">
		<div class="browse-page-heading">
			<div>
				<h1>物品详情</h1>
			</div>
			<UiButton @click="emit('back')">返回</UiButton
			><QuickExport
				v-if="item"
				:query="c.exportQuery.value"
				:active="active"
				@open-full="emit('openExport', $event)"
			/>
		</div>
		<p v-if="loading" role="status">正在读取物品…</p>
		<p v-if="error" class="notice-bar danger" role="alert">
			{{ error }} <UiButton @click="c.load">重新读取</UiButton>
		</p>
		<article v-if="item" class="browse-detail-card">
			<div class="browse-item-detail-head">
				<span class="browse-item-illustration"><InventoryIcon name="box" /></span>
				<div class="browse-detail-image"><ItemImage :item="item" /></div>
				<div class="browse-grow">
					<span class="eyebrow">{{ item.category }} · {{ item.code }}</span>
					<h2>{{ item.name }}</h2>
					<p class="muted">按物品代码汇总的库存、借用与损坏情况</p>
				</div>
				<UiButton v-if="item.canEdit" @click="emit('edit', item.code)"
					>编辑物品资料</UiButton
				>
			</div>
			<ItemConversions
				:item="item"
				@updated="c.conversionsUpdated"
				@dirty-change="c.conversionDirty.value = $event"
			/>
			<details>
				<summary>物品资料与图片（{{ files.files.length }}）</summary>
				<dl class="browse-detail-grid">
					<div
						v-for="(value, label) in {
							物品编号: item.code,
							单位: item.uom,
							批次管理: item.tracksBatch ? '启用' : '不启用',
							记录效期: item.tracksExpiry ? '启用' : '不启用',
							条码: item.barcode || '未设置',
							说明: item.description || '无',
						}"
						:key="label"
					>
						<dt>{{ label }}</dt>
						<dd class="preview-long-text">{{ value }}</dd>
					</div>
				</dl>
				<h2>物品图片</h2>
				<Attachments :controller="files" images-only mode="display" />
			</details>
			<QuantitySummary :metrics="metrics" />
			<nav class="browse-tabs" aria-label="物品库存视图">
				<button
					:aria-current="tab === 'overview' ? 'page' : undefined"
					@click="emit('tab', 'overview')"
				>
					库存分布</button
				><button
					v-if="item.tracksBatch"
					:aria-current="tab === 'batches' ? 'page' : undefined"
					@click="emit('tab', 'batches')"
				>
					批次信息
				</button>
			</nav>
			<div v-if="tab === 'batches'" class="browse-table-wrap">
				<table class="browse-table">
					<thead>
						<tr>
							<th>批次</th>
							<th>效期</th>
							<th>位置</th>
							<th>可用量</th>
							<th>借出</th>
							<th>损坏</th>
						</tr>
					</thead>
					<tbody>
						<tr
							v-for="batch in batches"
							:key="JSON.stringify([batch.id, batch.location])"
						>
							<td>
								<UiButton @click="batchDetail = batch"
									>{{ batch.id }} · 查看明细</UiButton
								>
							</td>
							<td>{{ batch.expiry || "未设置" }}</td>
							<td>{{ batch.location }}</td>
							<td>{{ batch.available }} {{ item.uom }}</td>
							<td>{{ batch.loaned || 0 }} {{ item.uom }}</td>
							<td>{{ batch.damaged || 0 }} {{ item.uom }}</td>
						</tr>
					</tbody>
				</table>
				<p v-if="!batches.length" class="browse-note">当前没有可显示的批次库存。</p>
			</div>
			<div v-else class="browse-table-wrap">
				<table class="browse-table">
					<thead>
						<tr>
							<th>存放位置</th>
							<th>可用</th>
							<th>借出</th>
							<th>损坏</th>
						</tr>
					</thead>
					<tbody>
						<tr v-for="place in item.locations" :key="place.location">
							<td>
								{{
									warehouseLabel(
										place.location,
										warehouseReference?.warehouses || [],
										place.label,
									)
								}}
							</td>
							<td>{{ place.available }} {{ item.uom }}</td>
							<td>{{ place.loaned }} {{ item.uom }}</td>
							<td>{{ place.damaged }} {{ item.uom }}</td>
						</tr>
					</tbody>
				</table>
				<p v-if="!item.locations.length" class="browse-note">此物品暂无库存。</p>
			</div>
			<details>
				<summary>
					流动与借用历史（{{ c.movements.result.total }} / {{ c.loans.result.total }}）
				</summary>
				<div class="browse-card-heading">
					<h2>最近流动</h2>
					<UiButton @click="emit('browse', c.movementQuery.value)"
						>查看物品流动</UiButton
					>
				</div>
				<p v-if="c.movements.result.error" role="alert">
					{{ c.movements.result.error }}
					<UiButton @click="c.movements.refresh">重试</UiButton>
				</p>
				<p v-if="c.movements.result.loading" role="status">正在读取流动…</p>
				<ReportTable
					v-if="movementTable && !c.movements.result.stale"
					:table="{ ...movementTable }"
					:total="movementTable.total"
					:loading="movementTable.loading"
					:initialized="movementTable.initialized"
					:error="movementTable.error"
					@load-more="c.movements.loadTable(movementTable, true)"
					@retry="c.movements.loadTable(movementTable, true)"
					@open-document="(doctype, name) => emit('openDocument', doctype, name)"
				/>
				<div class="browse-card-heading">
					<h2>借用记录</h2>
					<UiButton @click="emit('browse', c.loanQuery.value)">查看物品借用</UiButton>
				</div>
				<p v-if="c.loans.result.error" role="alert">
					{{ c.loans.result.error }} <UiButton @click="c.loans.refresh">重试</UiButton>
				</p>
				<p v-if="c.loans.result.loading" role="status">正在读取借用…</p>
				<ReportTable
					v-if="loanTable && !c.loans.result.stale"
					:table="{ ...loanTable }"
					:total="loanTable.total"
					:loading="loanTable.loading"
					:initialized="loanTable.initialized"
					:error="loanTable.error"
					@load-more="c.loans.loadTable(loanTable, true)"
					@retry="c.loans.loadTable(loanTable, true)"
					@open-document="(doctype, name) => emit('openDocument', doctype, name)"
				/>
			</details>
		</article>
		<Overlay
			v-if="batchDetail"
			title="批次明细"
			adaptive-creation
			@close="batchDetail = undefined"
		>
			<p>
				位置
				{{ warehouseLabel(batchDetail.location, warehouseReference?.warehouses || []) }} ·
				到期
				{{ batchDetail.expiry || "无效期" }}
			</p>
			<UiButton
				@click="
					emit('browse', {
						...c.movementQuery.value,
						search: batchDetail.id,
					})
				"
				>搜索此批次编号的流动</UiButton
			><UiButton
				@click="
					emit('browse', {
						...c.loanQuery.value,
						search: batchDetail.id,
					})
				"
				>搜索此批次编号的借用</UiButton
			>
		</Overlay>
	</section>
</template>
