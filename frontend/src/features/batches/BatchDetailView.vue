<script setup lang="ts">
import { computed } from "vue";
import type { BatchDetailController } from "./useBatchDetailController";
import PageHeader from "../../components/ui/PageHeader.vue";
import UiButton from "../../components/ui/UiButton.vue";
import QuantitySummary from "../../components/ui/QuantitySummary.vue";
import ItemImage from "../../components/ItemImage.vue";
import { documentDestination } from "../../lib/nativeNavigation";
import { movementLabels } from "../../lib/filterPresentation";
import { nativeStatusLabel } from "../../lib/nativeLabels";
import { useReferenceData } from "../../services/contracts";
import { warehouseLabel } from "../../lib/warehouseLabel";
const props = defineProps<{ controller: BatchDetailController }>();
const emit = defineEmits<{ back: []; openItem: [string]; openDocument: [string] }>();
const c = props.controller,
	reference = useReferenceData();
const quantities = computed(() => {
	const values = new Map<string, { uom: string; stock: number; available: number }>();
	for (const row of c.batch.value?.locations.summary || []) {
		const uom = String(row.stock_uom || "");
		const value = values.get(uom) || { uom, stock: 0, available: 0 };
		value.stock += Number(row.stock_qty || 0);
		value.available += Number(row.available || 0);
		values.set(uom, value);
	}
	return [...values.values()];
});
const batchMetrics = computed(() => [
	{
		key: "batch-stock",
		label: "批次数量",
		quantities: quantities.value.map((quantity) => ({
			uom: quantity.uom,
			qty: quantity.stock,
		})),
	},
	{
		key: "batch-available",
		label: "可用库存",
		quantities: quantities.value.map((quantity) => ({
			uom: quantity.uom,
			qty: quantity.available,
		})),
	},
]);
function endpoint(row: Record<string, unknown>, source: boolean) {
	if (row.kind === "Reconcile" || row.kind === "Opening") {
		const location = String(row.warehouse || "");
		const positive =
			row.kind === "Opening" || Number(row.difference ?? row.stock_qty ?? 0) >= 0;
		const selected = warehouseLabel(
			location,
			reference.warehouses,
			String(row.warehouse_label || ""),
		);
		return source ? (positive ? "外部" : selected) : positive ? selected : "外部";
	}
	const key = source ? "source_warehouse" : "destination_warehouse";
	return row[key]
		? warehouseLabel(String(row[key]), reference.warehouses, String(row[`${key}_label`] || ""))
		: "外部";
}
function openDocument(row: Record<string, unknown>) {
	emit("openDocument", documentDestination(String(row.doctype), String(row.document)).path);
}
</script>
<template>
	<section class="browse-page batch-detail-page">
		<PageHeader :title="c.batch.value?.name || '批次资料'">
			<template #back
				><UiButton variant="ghost" @click="emit('back')">返回</UiButton></template
			>
			<template #actions>
				<UiButton
					v-if="c.batch.value?.can_edit && !c.editing.value"
					variant="primary"
					@click="c.beginEdit"
					>编辑</UiButton
				>
				<template v-else-if="c.editing.value">
					<UiButton variant="ghost" :disabled="c.saving.value" @click="c.cancelEdit"
						>取消</UiButton
					>
					<UiButton
						variant="primary"
						:loading="c.saving.value"
						:disabled="!c.dirty.value"
						@click="c.save"
						>保存资料</UiButton
					>
				</template>
			</template>
			<template #subtitle
				><p v-if="c.batch.value">批次资料 · {{ c.batch.value.item_code }}</p></template
			>
		</PageHeader>
		<p v-if="c.loading.value" role="status">正在读取批次…</p>
		<div v-if="c.error.value" role="alert" class="utility-error">
			{{ c.error.value }} <UiButton @click="c.reload">重新读取</UiButton>
		</div>
		<p v-if="c.success.value" role="status">{{ c.success.value }}</p>
		<section v-if="c.batch.value" class="batch-detail-card">
			<div class="batch-detail-identity">
				<ItemImage
					:item="{
						code: c.batch.value.item.item_code,
						name: c.batch.value.item.item_name,
						image: c.batch.value.item.image,
						files: [],
					}"
				/>
				<div>
					<h2>{{ c.batch.value.item.item_name }}</h2>
					<button
						class="browse-row-link"
						@click="emit('openItem', c.batch.value!.item_code)"
					>
						物品资料 · {{ c.batch.value.item_code }}
					</button>
				</div>
			</div>
			<p class="batch-state">
				<span
					class="browse-badge"
					:class="c.batch.value.disabled ? 'is-neutral' : 'is-success'"
				>
					{{ c.batch.value.disabled ? "已停用" : "正常使用" }}
				</span>
			</p>
			<QuantitySummary :metrics="batchMetrics" label="批次数量汇总" />
			<dl v-if="!c.editing.value" class="batch-detail-meta">
				<div>
					<dt>生产日期</dt>
					<dd>{{ c.batch.value.manufacturing_date || "未填写" }}</dd>
				</div>
				<div>
					<dt>到期日期</dt>
					<dd>{{ c.batch.value.expiry_date || "无效期" }}</dd>
				</div>
			</dl>
			<template v-if="c.editing.value">
				<form class="batch-edit-form" @submit.prevent="c.save">
					<label
						>生产日期<input v-model="c.manufacturingDate.value" type="date"
					/></label>
					<label>到期日期<input v-model="c.expiryDate.value" type="date" /></label>
					<label class="batch-description"
						>批次说明<textarea
							v-model="c.description.value"
							rows="3"
							maxlength="2000"
						/>
					</label>
				</form>
			</template>
			<p v-else-if="c.batch.value.description" class="batch-description-preview">
				{{ c.batch.value.description }}
			</p>
		</section>
		<section v-if="c.batch.value" class="batch-detail-card">
			<h2>存放位置 · {{ c.batch.value.locations.matched_count }} 处</h2>
			<div class="browse-table-wrap">
				<table class="browse-table">
					<thead>
						<tr>
							<th>位置</th>
							<th>批次数量</th>
							<th>可用数量</th>
						</tr>
					</thead>
					<tbody>
						<tr v-for="row in c.batch.value.locations.rows" :key="String(row.id)">
							<td>
								{{
									warehouseLabel(
										String(row.warehouse || ""),
										reference.warehouses,
										String(row.warehouse_label || ""),
									)
								}}
							</td>
							<td>{{ row.stock_qty }} {{ row.stock_uom }}</td>
							<td>{{ row.available }} {{ row.stock_uom }}</td>
						</tr>
						<tr v-if="!c.batch.value.locations.rows.length">
							<td colspan="3">此批次当前没有位置余额</td>
						</tr>
					</tbody>
				</table>
			</div>
			<p v-if="c.locationError.value" role="alert">
				{{ c.locationError.value }} <UiButton @click="c.moreLocations">重试</UiButton>
			</p>
			<UiButton
				v-if="c.batch.value.locations.next_start !== null"
				:loading="c.locationsLoading.value"
				@click="c.moreLocations"
				>加载更多位置</UiButton
			>
		</section>
		<section v-if="c.batch.value" class="batch-detail-card">
			<h2>批次流动记录 · {{ c.batch.value.history.matched_count }} 条</h2>
			<div class="browse-table-wrap">
				<table class="browse-table">
					<thead>
						<tr>
							<th>记录</th>
							<th>日期</th>
							<th>类型</th>
							<th>来源</th>
							<th>去向</th>
							<th>数量</th>
							<th>状态</th>
						</tr>
					</thead>
					<tbody>
						<tr v-for="row in c.batch.value.history.rows" :key="String(row.id)">
							<td>
								<button class="browse-row-link" @click="openDocument(row)">
									{{ row.document }}
								</button>
							</td>
							<td>{{ row.date }}</td>
							<td>{{ movementLabels[String(row.kind)] || row.kind }}</td>
							<td>{{ endpoint(row, true) }}</td>
							<td>{{ endpoint(row, false) }}</td>
							<td>{{ row.stock_qty }} {{ row.stock_uom }}</td>
							<td>{{ nativeStatusLabel(row.docstatus) }}</td>
						</tr>
						<tr v-if="!c.batch.value.history.rows.length">
							<td colspan="7">暂无流动记录</td>
						</tr>
					</tbody>
				</table>
			</div>
			<p v-if="c.historyError.value" role="alert">
				{{ c.historyError.value }} <UiButton @click="c.moreHistory">重试</UiButton>
			</p>
			<UiButton
				v-if="c.batch.value.history.next_start !== null"
				:loading="c.historyLoading.value"
				@click="c.moreHistory"
				>加载更多记录</UiButton
			>
		</section>
	</section>
</template>
