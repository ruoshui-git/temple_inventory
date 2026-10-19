<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onDeactivated, onMounted, ref, watch } from "vue";
import { ScannerService, cameraError } from "../lib/scanner";
import { sessionExpired } from "../lib/sessionState";
import Overlay from "./ui/Overlay.vue";
import UiButton from "./ui/UiButton.vue";
export type ScannerPresentation = "inline" | "modal" | "continuous" | "camera";
const props = withDefaults(
	defineProps<{ paused?: boolean; presentation?: ScannerPresentation; submitLabel?: string }>(),
	{ presentation: "inline", submitLabel: "查找" },
);
const emit = defineEmits<{ scan: [value: string]; close: [] }>();
const area = ref<HTMLElement>(),
	error = ref(""),
	manual = ref(""),
	starting = ref(false);
const service = new ScannerService();
const hidden = ref(typeof document !== "undefined" && document.hidden);
const paused = computed(() => props.paused || sessionExpired.value || hidden.value);
function visibilityChanged() {
	hidden.value = document.hidden;
}
let disposed = false,
	last = "",
	lastTime = 0;
function decoded(value: string, explicit = false) {
	value = value.trim();
	if (!value || paused.value || disposed) return;
	if (!explicit && value === last && Date.now() - lastTime < 2000) return;
	last = value;
	lastTime = Date.now();
	notifyScan();
	emit("scan", value);
}
function notifyScan() {
	const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
	if (!AudioContextClass) return;
	try {
		const context = new AudioContextClass();
		const oscillator = context.createOscillator();
		const gain = context.createGain();
		oscillator.type = "sine";
		oscillator.frequency.value = 880;
		gain.gain.setValueAtTime(0.08, context.currentTime);
		gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.12);
		oscillator.connect(gain);
		gain.connect(context.destination);
		oscillator.start();
		oscillator.stop(context.currentTime + 0.12);
		oscillator.addEventListener(
			"ended",
			() => {
				void context.close();
			},
			{ once: true },
		);
	} catch {
		/* Audio notification is optional. */
	}
}

async function start() {
	if (starting.value || disposed || paused.value || !area.value) return;
	starting.value = true;
	error.value = "";
	try {
		await service.start(area.value, decoded, (reason) => {
			if (!disposed) error.value = cameraError(reason);
		});
	} catch (reason) {
		if (!disposed) error.value = cameraError(reason);
	} finally {
		if (!disposed) starting.value = false;
	}
}
function close() {
	disposed = true;
	void service.stop();
	emit("close");
}
watch(paused, (value) => {
	if (value) void service.stop();
	else void start();
});
watch(
	() => props.presentation,
	async () => {
		await service.stop();
		await nextTick();
		if (!disposed) void start();
	},
);
onMounted(() => {
	document.addEventListener("visibilitychange", visibilityChanged);
	void start();
});
onDeactivated(() => {
	void service.stop();
});
onBeforeUnmount(() => {
	document.removeEventListener("visibilitychange", visibilityChanged);
	disposed = true;
	void service.stop();
});
defineExpose({
	clear: () => {
		manual.value = "";
	},
	start,
});
</script>
<template>
	<component
		:is="presentation === 'modal' ? Overlay : 'section'"
		:title="presentation === 'modal' ? '扫描条码' : undefined"
		class="inventory-scanner"
		@close="close"
	>
		<div
			v-if="presentation === 'inline' || presentation === 'continuous'"
			class="section-title-row"
		>
			<h3>{{ presentation === "continuous" ? "连续扫码" : "扫描条码" }}</h3>
			<UiButton @click="close">关闭相机</UiButton>
		</div>
		<p v-if="paused" role="status">
			{{
				sessionExpired
					? "登录已过期，相机已暂停；输入已保留。"
					: "请确认数量与位置后继续扫描"
			}}
		</p>
		<div ref="area" class="scanner-camera" :aria-busy="starting" />
		<p v-if="starting" role="status">正在打开相机…</p>
		<p v-if="error" role="alert">{{ error }}</p>
		<UiButton v-if="error" :disabled="starting || paused" @click="start">重试相机</UiButton>
		<form
			v-if="presentation !== 'camera'"
			class="scanner-manual"
			@submit.prevent="decoded(manual, true)"
		>
			<label class="preview-field"
				>条码 / 编号 / 扫码枪<input
					v-model="manual"
					:disabled="paused"
					placeholder="输入后按回车"
					autocomplete="off" /></label
			><UiButton type="submit" :disabled="paused || !manual.trim()">{{
				submitLabel
			}}</UiButton>
		</form>

		<template v-if="presentation === 'modal'" #footer
			><UiButton @click="close">关闭相机</UiButton></template
		>
	</component>
</template>
<style scoped>
.inventory-scanner {
	min-width: 0;
}
.scanner-camera {
	width: 100%;
	overflow: hidden;
	border-radius: var(--p-radius-control);
	background: var(--p-soft);
}
.scanner-camera :deep(video) {
	display: block;
	width: 100%;
	max-height: 45dvh;
	object-fit: contain;
}
.scanner-manual {
	display: flex;
	align-items: end;
	flex-wrap: wrap;
	gap: var(--p-space-2);
	margin-block: var(--p-space-4);
}
.scanner-manual label {
	flex: 1;
	min-width: min(100%, 15rem);
}
</style>
