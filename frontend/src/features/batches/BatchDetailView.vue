<script setup lang="ts">
import { computed } from "vue";
import type { BatchDetailController } from "./useBatchDetailController";
import PageHeader from "../../components/ui/PageHeader.vue";
import BackButton from "../../components/ui/BackButton.vue";
import UiButton from "../../components/ui/UiButton.vue";
import SkeletonBlock from "../../components/ui/SkeletonBlock.vue";
import QuantitySummary from "../../components/ui/QuantitySummary.vue";
import ItemImage from "../../components/ItemImage.vue";
import { documentDestination } from "../../lib/nativeNavigation";
import type { AppRouteTarget } from "../../lib/routeRegistry";
import { movementLabels } from "../../lib/filterPresentation";
import { useReferenceData } from "../../services/contracts";
import { warehouseLabel } from "../../lib/warehouseLabel";
import MovementHistoryTable from "../../components/ui/MovementHistoryTable.vue";
import DataTable from "../../components/ui/DataTable.vue";
import type { DataColumn, DataTableRecord } from "../../lib/dataTable";
import { useColumnPreferences } from "../../composables/useColumnPreferences";
import { useOptionalInventoryServices } from "../../services/contracts";
import FormField from "../../components/ui/FormField.vue";
import { sortByUnit, unitLabel } from "../../lib/units";
const props = defineProps<{ controller: BatchDetailController }>();
const emit = defineEmits<{
	back: [];
	openItem: [string];
	openDocument: [AppRouteTarget];
	openLoan: [string];
}>();
const c = props.controller,
	reference = useReferenceData();
const services = useOptionalInventoryServices();
const locationColumns = computed<DataColumn[]>(() => [
	{
		id: "warehouse",
		label: "位置",
		required: true,
		defaultVisible: true,
		sortable: true,
		sortField: "warehouse_label",
	},
	{ id: "stock_qty", label: "批次数量", defaultVisible: true, sortable: true },
	{ id: "available", label: "可用数量", defaultVisible: true, sortable: true },
	{ id: "stock_uom", label: "单位", defaultVisible: true, sortable: true },
]);
const locationRows = computed<DataTableRecord[]>(() =>
	(c.batch.value?.locations.rows || []).map((row) => ({
		kind: "record",
		id: String(row.id),
		value: row as unknown as Record<string, unknown>,
	})),
);
const locationPrefs = services
	? useColumnPreferences("batch-detail.locations", locationColumns, reference, services)
	: undefined;
const quantities = computed(() => {
	const values = new Map<string, { uom: string; stock: number; available: number }>();
	for (const row of c.batch.value?.locations.summary || []) {
		const uom = String(row.stock_uom || "");
		const value = values.get(uom) || { uom, stock: 0, available: 0 };
		value.stock += Number(row.stock_qty || 0);
		value.available += Number(row.available || 0);
		values.set(uom, value);
	}
	return sortByUnit([...values.values()], (quantity) => quantity.uom);
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
function openDocument(row: Record<string, unknown>) {
	emit("openDocument", documentDestination(String(row.doctype), String(row.document)));
}
</script>
<template>
	<section class="browse-page batch-detail-page">
		<PageHeader :title="c.batch.value?.name || '批次资料'">
			<template #back><BackButton @click="emit('back')" /></template>
			<template #actions>
				<UiButton
					v-if="c.batch.value && !c.editing.value"
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
		<SkeletonBlock
			v-if="c.loading.value && !c.batch.value"
			variant="detail"
			:count="3"
			:rows="3"
		/>
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
				<form class="batch-edit-form" novalidate @submit.prevent="c.save">
					<FormField
						for="batch-manufacturing-date"
						label="生产日期"
						:error="c.validation.errors['batch-manufacturing-date']"
						><template #default="{ fieldAttrs }"
							><input
								v-model="c.manufacturingDate.value"
								type="date"
								v-bind="fieldAttrs" /></template
					></FormField>
					<FormField
						for="batch-expiry-date"
						label="到期日期"
						:error="c.validation.errors['batch-expiry-date']"
						><template #default="{ fieldAttrs }"
							><input
								v-model="c.expiryDate.value"
								type="date"
								v-bind="fieldAttrs" /></template
					></FormField>
					<FormField class="batch-description" label="批次说明"
						><template #default="{ fieldAttrs }">
							<textarea
								v-model="c.description.value"
								rows="3"
								maxlength="2000"
								v-bind="fieldAttrs"
							/></template
					></FormField>
				</form>
			</template>
			<p v-else-if="c.batch.value.description" class="batch-description-preview">
				{{ c.batch.value.description }}
			</p>
		</section>
		<section v-if="c.batch.value" class="batch-detail-card">
			<h2>存放位置 · {{ c.batch.value.locations.matched_count }} 处</h2>
			<DataTable
				ariaLabel="批次各库位余额"
				table-class="browse-table"
				:columns="locationColumns"
				:rows="locationRows"
				:loading="c.loading.value"
				:initialized="Boolean(c.batch.value)"
				:sort-by="c.locationsSortBy.value"
				:sort-direction="c.locationsSortDirection.value"
				:column-preferences="locationPrefs"
				@sort="c.sortLocations"
				empty-text="此批次当前没有位置余额"
			>
				<template #cell="{ column, row }">
					<template v-if="column.id === 'warehouse'">{{
						warehouseLabel(
							String(row.warehouse || ""),
							reference.warehouses,
							String(row.warehouse_label || ""),
						)
					}}</template>
					<template v-else-if="column.id === 'stock_uom'">{{
						unitLabel(String(row.stock_uom || ""))
					}}</template>
					<template v-else>{{ row[column.id] }}</template>
				</template>
			</DataTable>
			<p v-if="c.locationError.value" role="alert">
				{{ c.locationError.value }} <UiButton @click="c.moreLocations">重试</UiButton>
			</p>
			<UiButton
				v-if="c.batch.value.locations.next_start !== null"
				:loading="c.locationsLoading.value"
				@click="c.moreLocations"
				>加载更多位置 · {{ c.batch.value.locations.rows.length }} /
				{{ c.batch.value.locations.matched_count }}</UiButton
			>
		</section>
		<section v-if="c.batch.value" class="batch-detail-card">
			<h2>批次流动记录 · {{ c.batch.value.history.matched_count }} 条</h2>
			<MovementHistoryTable
				:show-status="false"
				:rows="c.batch.value.history.rows"
				:total="c.batch.value.history.matched_count"
				:next="c.batch.value.history.next_start"
				:loading="c.historyLoading.value"
				:error="c.historyError.value"
				:initialized="true"
				@load-more="c.moreHistory"
				@retry="c.moreHistory"
				@open-document="
					(doctype, name) => emit('openDocument', documentDestination(doctype, name))
				"
				@open-loan="emit('openLoan', $event)"
				@open-item="emit('openItem', $event)"
			/>
		</section>
	</section>
</template>
