<script setup lang="ts">
import { ref, computed } from "vue";
import { reviewSession } from "../reviewModel";
import PreviewUiButton from "./PreviewUiButton.vue";
const props = defineProps<{ allowCreate?: boolean; paused?: boolean }>();
const emit = defineEmits<{
	item: [code: string, batch?: string];
	location: [name: string];
	create: [barcode: string];
}>();
const stopped = ref(false);
const value = ref(""),
	result = ref(""),
	camera = ref("ready"),
	continuous = ref(true),
	recent = ref<string[]>([]);
const item = computed(() =>
	reviewSession.stock.find(
		(row) =>
			row.code === result.value ||
			row.barcode?.split(/\s+/).includes(result.value) ||
			row.locations.some((place) =>
				place.batches?.some((batch) => batch.id === result.value),
			),
	),
);
const warehouse = computed(() =>
	reviewSession.warehouses.find((row) => row.name === result.value),
);
function scan() {
	if (props.paused || stopped.value) return;
	result.value = value.value.trim();
	if (result.value)
		recent.value = [result.value, ...recent.value.filter((row) => row !== result.value)].slice(
			0,
			5,
		);
}
function choose() {
	if (item.value)
		emit(
			"item",
			item.value.code,
			item.value.locations.some((place) =>
				place.batches?.some((batch) => batch.id === result.value),
			)
				? result.value
				: undefined,
		);
	else if (warehouse.value && !warehouse.value.is_group) emit("location", warehouse.value.name);
	else return;
	stopped.value = !continuous.value;
	result.value = "";
	value.value = "";
}
</script>
<template>
	<details class="form-section">
		<summary>扫描物品 / 批次 / 库位</summary>
		<label><input type="checkbox" v-model="continuous" />连续扫描</label>
		<p role="status">
			{{
				paused
					? "请先完成当前数量与库位配置，再继续扫描"
					: camera === "denied"
						? "无法使用相机，请手动输入或使用扫码枪"
						: "预览扫码：输入样本物品编号、条码、批次或库位"
			}}
		</p>
		<label
			>扫描值<input
				v-model="value"
				:disabled="paused || stopped"
				@keydown.enter.prevent="scan" /></label
		><PreviewUiButton :disabled="paused || stopped || !value.trim()" @click="scan"
			>查找</PreviewUiButton
		><PreviewUiButton v-if="stopped" @click="stopped = false">扫描下一项</PreviewUiButton>
		<div v-if="result">
			<template v-if="item || warehouse"
				><p>
					{{ item?.name || warehouse?.label
					}}<span v-if="item"> · 可用 {{ item.available }} {{ item.uom }}</span>
				</p>
				<p v-if="warehouse?.is_group">这是分组节点，请选择具体库位。</p>
				<PreviewUiButton :disabled="!!warehouse?.is_group && !item" @click="choose">{{
					item ? "配置数量与库位" : "使用库位"
				}}</PreviewUiButton></template
			><template v-else
				><p>未找到 {{ result }}</p>
				<PreviewUiButton
					v-if="allowCreate"
					@click="
						emit('create', result);
						result = '';
					"
					>新建物品</PreviewUiButton
				>
				<p v-else>请检查条码或在入库时新建物品。</p></template
			>
		</div>
		<p v-if="recent.length">最近扫描：{{ recent.join("、") }}</p>
		<details>
			<summary>预览相机状态</summary>
			<PreviewUiButton @click="camera = camera === 'denied' ? 'ready' : 'denied'"
				>切换相机不可用</PreviewUiButton
			>
		</details>
	</details>
</template>
