<script setup lang="ts">
import ItemImagePreview from "./ItemImagePreview.vue";

const props = withDefaults(
	defineProps<{
		rows: any[];
		loading?: boolean;
		loadingMore?: boolean;
		error?: string;
		selectionMode?: boolean;
		selectedKeys?: string[];
	}>(),
	{
		loading: false,
		loadingMore: false,
		error: "",
		selectionMode: false,
		selectedKeys: () => [],
	},
);
const emit = defineEmits<{ activate: [row: any]; toggle: [row: any] }>();

function activate(row: any, event: Event) {
	if (event.target instanceof Element && event.target.closest("[data-card-control]")) return;
	if (props.selectionMode) emit("toggle", row);
	else emit("activate", row);
}
function activateKey(row: any, event: KeyboardEvent) {
	if (event.key !== "Enter" && event.key !== " ") return;
	event.preventDefault();
	activate(row, event);
}
</script>

<template>
	<div v-if="loading" class="card-state" role="status">正在更新记录…</div>
	<div v-else-if="error" class="card-state error" role="alert">
		<slot name="error">{{ error }}</slot>
	</div>
	<div v-else-if="!rows.length" class="card-state">暂无符合条件的物品</div>
	<div v-else class="inventory-card-grid">
		<article
			v-for="row in rows"
			:key="row.item_code"
			class="inventory-visual-card"
			:class="{ selected: selectedKeys.includes(row.item_code) }"
			tabindex="0"
			@keydown="activateKey(row, $event)"
			@click="activate(row, $event)"
		>
			<div class="inventory-card-image" data-card-control>
				<ItemImagePreview v-if="row.image" :src="row.image" :alt="row.item_name" />
				<div v-else class="inventory-card-placeholder" aria-hidden="true">物</div>
			</div>
			<div class="inventory-card-body">
				<div class="inventory-card-heading">
					<div>
						<b>{{ row.item_name }}</b>
						<small>{{ row.item_code }} · {{ row.item_group }}</small>
					</div>
					<input
						v-if="selectionMode"
						data-card-control
						type="checkbox"
						:checked="selectedKeys.includes(row.item_code)"
						:aria-label="`选择 ${row.item_name}`"
						@change="emit('toggle', row)"
					/>
				</div>
				<strong class="inventory-card-available"
					>可用 {{ row.available_stock }} {{ row.stock_uom }}</strong
				>
				<div class="inventory-card-secondary">
					<span>总计 {{ row.total_stock }} {{ row.stock_uom }}</span>
					<span>借出 {{ row.on_loan_qty }} {{ row.stock_uom }}</span>
					<span>损坏 {{ row.damaged_qty }} {{ row.stock_uom }}</span>
				</div>
			</div>
		</article>
	</div>
	<div v-if="loadingMore" class="card-state" role="status">正在加载更多记录…</div>
</template>

<style scoped>
.inventory-card-grid {
	display: grid;
	grid-template-columns: repeat(auto-fill, minmax(230px, 1fr));
	gap: 14px;
	padding: 12px;
}
.inventory-visual-card {
	overflow: hidden;
	border: 1px solid #e4dccf;
	border-radius: 16px;
	background: white;
	box-shadow: 0 3px 14px rgb(67 48 26 / 8%);
	cursor: pointer;
}
.inventory-visual-card:focus-visible,
.inventory-visual-card.selected {
	outline: 3px solid #a66b35;
	outline-offset: 2px;
}
.inventory-card-image {
	display: grid;
	place-items: center;
	height: 170px;
	background: #f5efe5;
}
.inventory-card-image :deep(.image-preview),
.inventory-card-image :deep(.image-thumb-button) {
	display: block;
	width: 100%;
	height: 100%;
	padding: 0;
	border: 0;
	border-radius: 0;
}
.inventory-card-image :deep(.image-thumb-button img) {
	width: 100%;
	height: 170px;
	object-fit: cover;
}
.inventory-card-placeholder {
	display: grid;
	place-items: center;
	width: 72px;
	height: 72px;
	border-radius: 50%;
	background: #e4d5bf;
	color: #80684d;
	font-size: 30px;
}
.inventory-card-body {
	display: grid;
	gap: 10px;
	padding: 14px;
}
.inventory-card-heading {
	display: flex;
	justify-content: space-between;
	gap: 8px;
}
.inventory-card-heading b,
.inventory-card-heading small {
	display: block;
}
.inventory-card-heading small,
.inventory-card-secondary {
	color: #71675c;
}
.inventory-card-available {
	font-size: 1.15rem;
	color: #386641;
}
.inventory-card-secondary {
	display: flex;
	flex-wrap: wrap;
	gap: 5px 12px;
	font-size: 0.86rem;
}
.card-state {
	padding: 24px;
	text-align: center;
}
.error {
	color: #9a2d24;
}
@media (max-width: 640px) {
	.inventory-card-grid {
		grid-template-columns: 1fr;
		padding: 8px 0;
	}
	.inventory-card-image,
	.inventory-card-image :deep(.image-thumb-button img) {
		height: 190px;
	}
}
</style>
