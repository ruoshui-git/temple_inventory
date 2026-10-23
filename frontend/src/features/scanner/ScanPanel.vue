<script setup lang="ts">
import { computed, onDeactivated, ref, watch } from "vue";
import Overlay from "../../components/ui/Overlay.vue";
import Scanner from "../../components/Scanner.vue";
import SearchSelect from "../../components/ui/SearchSelect.vue";
import UiButton from "../../components/ui/UiButton.vue";
import { useReferenceData } from "../../services/contracts";
import { useScanController } from "./useScanController";

const props = defineProps<{
	allowCreate?: boolean;
	paused?: boolean;
	hideTrigger?: boolean;
	autoUnique?: boolean;
	inline?: boolean;
	hideFinishAction?: boolean;
	captureContext?: () => unknown;
	acceptItem?: (code: string, batch?: string, context?: unknown) => void | Promise<void>;
	acceptLocation?: (name: string, context?: unknown) => void | Promise<void>;
}>();
const emit = defineEmits<{
	item: [code: string, batch?: string, context?: unknown];
	location: [name: string, context?: unknown];
	create: [barcode: string, context?: unknown];
	close: [];
	finish: [];
}>();
const reference = useReferenceData();
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
	pendingCount,
	scan,
	choose,
	chooseGroupLocation,
	skipResult,
	retry,
	cancelPending,
	hold,
	resume,
} = useScanController(
	props,
	(code, batch, context) =>
		props.acceptItem
			? props.acceptItem(code, batch, context)
			: emit("item", code, batch, context),
	(name, context) =>
		props.acceptLocation
			? props.acceptLocation(name, context)
			: emit("location", name, context),
	props.captureContext,
);
const open = ref(false);
const selectedBatch = ref("");
const selectedWarehouse = ref("");
const resumeAfterConfiguration = ref(false);
let resumeCamera = false;
const warehouseOptions = computed(() => {
	const group = result.value?.warehouse;
	if (!group?.is_group) return [];
	const groupNode = reference.warehouses.find((row) => row.name === group.name);
	if (groupNode?.kind === "room" || groupNode?.kind === "shelf") {
		const direct = reference.warehouses.find(
			(row) => row.direct && row.owner === group.name && row.storable,
		);
		return direct ? [{ value: direct.name, label: direct.label, detail: direct.path }] : [];
	}
	const byName = new Map(reference.warehouses.map((row) => [row.name, row]));
	const contains = (name: string) => {
		let current = byName.get(name);
		const seen = new Set<string>();
		while (current && !seen.has(current.name)) {
			if (current.name === group.name) return true;
			seen.add(current.name);
			current = byName.get(current.parent || "");
		}
		return false;
	};
	return reference.warehouses
		.filter((row) => !row.is_group && row.storable && contains(row.name))
		.map((row) => ({ value: row.name, label: row.label, detail: row.path }));
});

function closeScan() {
	resumeAfterConfiguration.value = false;
	cancelPending();
	open.value = false;
	emit("close");
}
async function finishItem(code: string) {
	await choose(code, selectedBatch.value);
	if (!continuous.value && !result.value) open.value = false;
}
async function finishLocation() {
	await choose();
	if (!continuous.value && !result.value) open.value = false;
}
async function finishGroupLocation() {
	if (!selectedWarehouse.value) return;
	await chooseGroupLocation(selectedWarehouse.value);
	if (!continuous.value && !result.value) open.value = false;
}
function createUnknown(barcode: string) {
	if (!result.value) return;
	resumeAfterConfiguration.value = continuous.value;
	resumeCamera = camera.value;
	if (props.inline && props.autoUnique && continuous.value) hold();
	emit("create", result.value.barcode || barcode, result.value.scanContext);
	skipResult();
	open.value = false;
	emit("close");
}
function finishScanning() {
	cancelPending();
	resumeAfterConfiguration.value = false;
	open.value = false;
	emit("finish");
	emit("close");
}
function resumeAfterCreate() {
	const shouldResume = resumeAfterConfiguration.value && continuous.value;
	resumeAfterConfiguration.value = false;
	open.value = true;
	if (shouldResume) {
		resume();
		camera.value = resumeCamera;
	} else camera.value = false;
}
watch(
	() => [result.value?.barcode, result.value?.batches.join("|")],
	() => {
		selectedBatch.value = result.value?.batches.length === 1 ? result.value.batches[0]! : "";
		selectedWarehouse.value =
			warehouseOptions.value.length === 1 ? warehouseOptions.value[0]!.value : "";
	},
);
watch([() => result.value?.warehouse?.name, warehouseOptions], () => {
	const node = reference.warehouses.find((row) => row.name === result.value?.warehouse?.name);
	if (node?.kind === "room" && warehouseOptions.value.length === 1)
		void chooseGroupLocation(warehouseOptions.value[0]!.value);
});
watch(open, (value) => {
	if (!value) camera.value = false;
});
watch(
	() => props.paused,
	(value, previous) => {
		if (previous && !value && resumeAfterConfiguration.value && continuous.value) {
			resumeAfterConfiguration.value = false;
			open.value = true;
			camera.value = resumeCamera;
		}
		if (value && continuous.value) {
			resumeAfterConfiguration.value = true;
			resumeCamera = resumeCamera || camera.value;
		}
	},
);
onDeactivated(closeScan);
defineExpose({
	show: () => {
		open.value = true;
	},
	resumeAfterCreate,
	finishScanning,
	pendingCount,
});
</script>

<template>
	<UiButton v-if="!hideTrigger" icon="scan" @click="open = true">
		扫描物品 / 批次 / 库位
	</UiButton>
	<component
		:is="inline ? 'section' : Overlay"
		v-if="open"
		class="scan-panel"
		v-bind="inline ? {} : { title: '扫描物品 / 批次 / 库位', adaptiveCreation: true }"
		v-on="inline ? {} : { close: closeScan }"
	>
		<div class="scan-panel-content">
			<div v-if="inline" class="scan-panel-heading">
				<h2>快速扫描</h2>
				<UiButton v-if="!hideFinishAction" variant="primary" @click="finishScanning"
					>完成扫描</UiButton
				>
			</div>
			<label class="preview-choice-label"
				><input type="checkbox" v-model="continuous" />连续扫描</label
			>
			<UiButton @click="camera = !camera">{{ camera ? "关闭相机" : "打开相机" }}</UiButton>
			<Scanner
				v-if="camera"
				presentation="camera"
				:paused="paused"
				:beep-on-decode="!autoUnique"
				@scan="scan"
				@close="camera = false"
			/>
			<p v-if="props.paused" role="status">请先完成当前物品解析，再继续扫描</p>
			<label class="preview-field"
				>扫描值<input v-model="value" :disabled="paused" @keydown.enter.prevent="scan()"
			/></label>
			<UiButton :disabled="paused || !value.trim()" @click="scan()">查找</UiButton>
			<UiButton v-if="stopped" @click="stopped = false">扫描下一项</UiButton>
			<p v-if="pendingCount" role="status">待处理条码 {{ pendingCount }} 个</p>
			<p v-if="loading" role="status">正在读取条码…</p>
			<p v-if="error" role="alert">
				{{ error }} <UiButton @click="retry()">重试查找</UiButton>
			</p>
			<div v-if="result">
				<p v-if="result.matches.length > 1">此条码对应多个物品，请选择并核对编号。</p>
				<label v-if="result.batches.length > 1" class="preview-field">
					选择批次
					<SearchSelect
						label="扫描批次"
						v-model="selectedBatch"
						:options="result.batches.map((batch) => ({ value: batch, label: batch }))"
					/>
				</label>
				<article v-for="item in result.matches" :key="item.item_code">
					<p>{{ item.item_name }} · {{ item.item_code }}</p>
					<UiButton
						:disabled="
							item.has_batch_no && result.batches.length > 1 && !selectedBatch
						"
						@click="finishItem(item.item_code)"
						>选择物品</UiButton
					>
				</article>
				<template v-if="result.warehouse">
					<p>{{ result.warehouse.label }}</p>
					<template v-if="result.warehouse.is_group">
						<p>这是分组节点，请选择具体库位。</p>
						<SearchSelect
							label="具体库位"
							v-model="selectedWarehouse"
							:options="warehouseOptions"
						/>
						<UiButton :disabled="!selectedWarehouse" @click="finishGroupLocation"
							>使用库位</UiButton
						>
					</template>
					<UiButton v-else @click="finishLocation">使用库位</UiButton>
				</template>
				<template v-if="result.unknown">
					<p>未找到 {{ result.barcode }}</p>
					<UiButton v-if="allowCreate" @click="createUnknown(result.barcode)"
						>新建物品</UiButton
					>
					<p v-else>请检查条码或在入库时新建物品。</p>
				</template>
			</div>
			<p v-if="recent.length">最近扫描：{{ recent.join("、") }}</p>
		</div>
	</component>
</template>
