<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onDeactivated, onMounted, ref, watch } from "vue";
import { ScannerService, cameraError, type ScannerCamera } from "../lib/scanner";
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
const cameras = ref<ScannerCamera[]>([]),
	selectedCameraId = ref(service.cameraDeviceId),
	deviceNotice = ref("");
const hidden = ref(typeof document !== "undefined" && document.hidden);
const paused = computed(() => props.paused || sessionExpired.value || hidden.value);
function visibilityChanged() {
	hidden.value = document.hidden;
}
let disposed = false,
	startGeneration = 0,
	cameraActive = false,
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
	const generation = ++startGeneration;
	await openCamera(generation, selectedCameraId.value || service.cameraDeviceId, "reconnect");
}
async function openCamera(
	generation: number,
	deviceId: string,
	missingRecovery: "reconnect" | "fallback" | "none",
) {
	if (disposed || paused.value || !area.value || generation !== startGeneration) return;
	starting.value = true;
	error.value = "";
	try {
		await service.start(
			area.value,
			decoded,
			(reason) => {
				if (!disposed && generation === startGeneration) error.value = cameraError(reason);
			},
			deviceId,
		);
		if (disposed || generation !== startGeneration) return;
		cameraActive = true;
		selectedCameraId.value = service.cameraDeviceId;
		await refreshCameras(generation);
	} catch (reason) {
		if (disposed || generation !== startGeneration) return;
		if (missingRecovery === "reconnect" && deviceId && isMissingDevice(reason)) {
			const available = await refreshCameras(generation);
			if (disposed || generation !== startGeneration) return;
			const matching = uniqueLabeledCamera(available, deviceId);
			if (matching) {
				selectedCameraId.value = matching.deviceId;
				deviceNotice.value = "浏览器更新了相机标识，已按相机名称恢复上次选择。";
				starting.value = false;
				await openCamera(generation, matching.deviceId, "fallback");
				return;
			}
		}
		if (
			isMissingDevice(reason) &&
			(missingRecovery === "fallback" || (missingRecovery === "reconnect" && deviceId))
		) {
			selectedCameraId.value = "";
			deviceNotice.value = "上次选择的相机已不可用，已尝试切换到后置相机。";
			starting.value = false;
			await openCamera(generation, "", "none");
		} else {
			cameraActive = false;
			error.value = cameraError(reason);
		}
	} finally {
		if (!disposed && generation === startGeneration) starting.value = false;
	}
}
function isMissingDevice(reason: unknown) {
	const name = String((reason as { name?: string })?.name || "");
	return /NotFound|DevicesNotFound|Overconstrained|ConstraintNotSatisfied/i.test(name);
}
function uniqueLabeledCamera(candidates: ScannerCamera[], missingDeviceId: string) {
	const preferredLabel = service.cameraLabel.trim();
	if (!preferredLabel) return;
	const matches = candidates.filter(
		(camera) =>
			camera.deviceId !== missingDeviceId && camera.stableLabel?.trim() === preferredLabel,
	);
	return matches.length === 1 ? matches[0] : undefined;
}
async function refreshCameras(generation = startGeneration): Promise<ScannerCamera[]> {
	try {
		const rows = await service.enumerateCameras();
		if (!disposed && generation === startGeneration) cameras.value = rows;
		return rows;
	} catch {
		/* Camera listing is optional; manual entry remains available. */
		return [];
	}
}
async function devicesChanged() {
	const generation = startGeneration;
	const previous = selectedCameraId.value || service.cameraDeviceId;
	const available = await refreshCameras(generation);
	if (disposed || generation !== startGeneration) return;
	if (
		previous &&
		!available.some((camera) => camera.deviceId === previous) &&
		cameraActive &&
		!paused.value
	) {
		const matching = uniqueLabeledCamera(available, previous);
		if (matching) {
			selectedCameraId.value = matching.deviceId;
			deviceNotice.value = "浏览器更新了相机标识，已按相机名称恢复上次选择。";
			await openCamera(generation, matching.deviceId, "fallback");
		} else {
			selectedCameraId.value = "";
			deviceNotice.value = "当前相机已断开，已切换到后置相机。";
			await openCamera(generation, "", "fallback");
		}
	}
}
function changeCamera() {
	deviceNotice.value = "";
	const generation = ++startGeneration;
	void openCamera(generation, selectedCameraId.value, "fallback");
}
function stopCamera() {
	startGeneration++;
	cameraActive = false;
	// Release the presentation-level lock immediately. A getUserMedia request
	// may still be pending, and its stale finally block must not be responsible
	// for making a later resume retry possible.
	starting.value = false;
	void service.stop();
}
function close() {
	disposed = true;
	stopCamera();
	emit("close");
}
watch(paused, (value) => {
	if (value) stopCamera();
	else void start();
});
watch(
	() => props.presentation,
	async () => {
		stopCamera();
		await nextTick();
		if (!disposed) void start();
	},
);
onMounted(() => {
	document.addEventListener("visibilitychange", visibilityChanged);
	navigator.mediaDevices?.addEventListener?.("devicechange", devicesChanged);
	void start();
});
onDeactivated(() => {
	stopCamera();
});
onBeforeUnmount(() => {
	document.removeEventListener("visibilitychange", visibilityChanged);
	navigator.mediaDevices?.removeEventListener?.("devicechange", devicesChanged);
	disposed = true;
	stopCamera();
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
		:class="presentation === 'modal' ? undefined : 'inventory-scanner'"
		@close="close"
	>
		<div
			v-if="presentation === 'inline' || presentation === 'continuous'"
			class="section-title-row"
		>
			<h3>{{ presentation === "continuous" ? "连续扫码" : "扫描条码" }}</h3>
			<UiButton @click="close">关闭相机</UiButton>
		</div>
		<label v-if="cameras.length > 1" class="preview-field scanner-camera-select">
			相机
			<select
				v-model="selectedCameraId"
				:disabled="starting || paused"
				@change="changeCamera"
			>
				<option v-for="camera in cameras" :key="camera.deviceId" :value="camera.deviceId">
					{{ camera.label }}
				</option>
			</select>
		</label>
		<p v-if="deviceNotice" role="status">{{ deviceNotice }}</p>
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
.scanner-camera-select {
	margin-top: var(--p-space-3);
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
