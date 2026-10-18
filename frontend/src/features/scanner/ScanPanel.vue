<script setup lang="ts">
import { ref, watch, onDeactivated } from "vue";
import Overlay from "../../components/ui/Overlay.vue";
import Scanner from "../../components/Scanner.vue";
import UiButton from "../../components/ui/UiButton.vue";
import { useScanController } from "./useScanController";
const props = defineProps<{ allowCreate?: boolean; paused?: boolean; hideTrigger?: boolean }>();
const emit = defineEmits<{
	item: [code: string, batch?: string];
	location: [name: string];
	create: [barcode: string];
}>();
const {
	value,
	result,
	loading,
	error,
	camera,
	continuous,
	stopped,
	recent,
	paused,
	scan,
	choose,
} = useScanController(
	props,
	(code, batch) => emit("item", code, batch),
	(name) => emit("location", name),
);
const open = ref(false);
defineExpose({
	show: () => {
		open.value = true;
	},
});
watch(open, (value) => {
	if (!value) camera.value = false;
});
const resumeAfterConfiguration = ref(false);
let resumeCamera = false;
function closeScan() {
	resumeAfterConfiguration.value = false;
	open.value = false;
}
function finishItem(code: string) {
	resumeCamera = camera.value;
	resumeAfterConfiguration.value = continuous.value;
	choose(code);
	open.value = false;
}
watch(
	() => props.paused,
	(value, previous) => {
		if (previous && !value && resumeAfterConfiguration.value && continuous.value) {
			resumeAfterConfiguration.value = false;
			open.value = true;
			camera.value = resumeCamera;
		}
	},
);
onDeactivated(closeScan);
function finishLocation() {
	choose();
	if (!continuous.value) open.value = false;
}
</script>
<template>
	<UiButton v-if="!hideTrigger" icon="scan" @click="open = true"
		>扫描物品 / 批次 / 库位</UiButton
	>
	<Overlay v-if="open" title="扫描物品 / 批次 / 库位" adaptive-creation @close="closeScan">
		<label class="preview-choice-label"
			><input type="checkbox" v-model="continuous" />连续扫描</label
		><UiButton @click="camera = !camera">{{ camera ? "关闭相机" : "打开相机" }}</UiButton>
		<Scanner
			v-if="camera"
			presentation="camera"
			:paused="paused"
			@scan="scan"
			@close="camera = false"
		/>
		<p v-if="props.paused" role="status">请先完成当前数量与库位配置，再继续扫描</p>
		<label class="preview-field"
			>扫描值<input
				v-model="value"
				:disabled="paused"
				@keydown.enter.prevent="scan()" /></label
		><UiButton :disabled="paused || !value.trim()" @click="scan()">查找</UiButton
		><UiButton v-if="stopped" @click="stopped = false">扫描下一项</UiButton>
		<p v-if="loading" role="status">正在读取条码…</p>
		<p v-if="error" role="alert">{{ error }} <UiButton @click="scan()">重试查找</UiButton></p>
		<div v-if="result">
			<p v-if="result.matches.length > 1">此条码对应多个物品，请选择并核对编号。</p>
			<article v-for="item in result.matches" :key="item.item_code">
				<p>{{ item.item_name }} · {{ item.item_code }}</p>
				<UiButton @click="finishItem(item.item_code)">配置数量与库位</UiButton>
			</article>
			<template v-if="result.warehouse"
				><p>{{ result.warehouse.label }}</p>
				<p v-if="result.warehouse.is_group">这是分组节点，请选择具体库位。</p>
				<UiButton v-else @click="finishLocation()">使用库位</UiButton></template
			><template v-if="result.unknown"
				><p>未找到 {{ result.barcode }}</p>
				<UiButton
					v-if="allowCreate"
					@click="
						closeScan();
						emit('create', result.barcode);
					"
					>新建物品</UiButton
				>
				<p v-else>请检查条码或在入库时新建物品。</p></template
			>
		</div>
		<p v-if="recent.length">最近扫描：{{ recent.join("、") }}</p>
	</Overlay>
</template>
