<script setup lang="ts">
import DetailPopover from "../../components/DetailPopover.vue";
import { warehousePresentation } from "../../lib/warehousePresenter";
import { expiryStatus, warehouses, type InventoryItem } from "./fixtures";
withDefaults(defineProps<{ item: InventoryItem; card?: boolean }>(), { card: false });
</script>
<template>
	<div class="item-details" :class="{ 'card-item-details': card }">
		<DetailPopover
			:label="`${item.name}的仓库位置`"
			:trigger-text="`${item.locations.length} 个库位${card ? '' : ' ›'}`"
		>
			<p v-for="location in item.locations" :key="location">
				{{ warehousePresentation(location, warehouses).breadcrumb }}
			</p>
		</DetailPopover>
		<DetailPopover
			v-if="item.batches.length"
			:label="`${item.name}的批次明细`"
			:trigger-text="`${item.batches.length} 批次${card ? '' : ' ›'}`"
		>
			<p v-for="batch in item.batches" :key="batch.code">
				{{ batch.code }}<br />{{ batch.quantity.toLocaleString("zh-CN") }} {{ item.uom }} ·
				{{ batch.expiry ? `效期 ${batch.expiry}` : "无到期日" }}
			</p>
		</DetailPopover>
		<span
			v-if="expiryStatus(item)?.soon"
			class="expiry-badge"
			:class="{ expired: expiryStatus(item)?.expired }"
			>{{ expiryStatus(item)?.expired ? "含过期批次" : "即将到期" }}</span
		>
	</div>
</template>
<style scoped>
.item-details {
	display: flex;
	align-items: center;
	flex-wrap: wrap;
	gap: 5px;
	font-size: 11px;
}
.item-details :deep(.detail-popover-trigger) {
	color: #476b88;
	background: #f2f7fb;
	border-color: #dfebf4;
	min-height: 26px;
	font-size: 11px;
	padding: 2px 7px;
}
.expiry-badge {
	color: #9a541b;
	background: #fff3e6;
	border-radius: 20px;
	padding: 3px 7px;
	white-space: nowrap;
}
.expired {
	color: #a63e33;
	background: #fff0ed;
}
@media (pointer: coarse) {
	.item-details :deep(.detail-popover-trigger) {
		min-height: 44px;
	}
}
</style>
