<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onDeactivated, onMounted, ref, watch } from "vue";
import {
	ScannerService,
	cameraError,
	cameraListPresentation,
	type ScannerCamera,
	type ScannerFramePresence,
} from "../lib/scanner";
import { sessionExpired } from "../lib/sessionState";
import Overlay from "./ui/Overlay.vue";
import UiButton from "./ui/UiButton.vue";
import ImageCrop from "./ui/ImageCrop.vue";
export type ScannerPresentation = "inline" | "modal" | "continuous" | "camera";
const props = withDefaults(
	defineProps<{
		paused?: boolean;
		presentation?: ScannerPresentation;
		submitLabel?: string;
		beepOnDecode?: boolean;
	}>(),
	{ presentation: "inline", submitLabel: "查找", beepOnDecode: true },
);
const emit = defineEmits<{ scan: [value: string]; close: [] }>();
const area = ref<HTMLElement>(),
	error = ref(""),
	manual = ref(""),
	starting = ref(false),
	torchAvailable = ref(false),
	torchOn = ref(false),
	successFlash = ref(false);
const service = new ScannerService();
const imageBusy = ref(false),
	imageError = ref(""),
	imageChoices = ref<{ text: string; format: string }[]>([]),
	imageInput = ref<HTMLInputElement>();
const imageForCrop = ref<File>();
let imageAbort: AbortController | undefined;
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
	emptySince: number | undefined,
	seenBarcodes = new Set<string>();
let flashTimer: ReturnType<typeof setTimeout> | undefined;
function flashSuccess() {
	successFlash.value = true;
	if (flashTimer) clearTimeout(flashTimer);
	flashTimer = setTimeout(() => (successFlash.value = false), 300);
	try {
		navigator.vibrate?.(30);
	} catch {
		/* Vibration is optional. */
	}
}
function decoded(value: string, explicit = false) {
	value = value.trim();
	if (!value || paused.value || disposed) return;
	if (!explicit) {
		if (seenBarcodes.has(value)) return;
		seenBarcodes.add(value);
		flashSuccess();
	}
	if (props.beepOnDecode) notifyScan();
	emit("scan", value);
}
function framePresence(presence: ScannerFramePresence) {
	if (presence !== false) {
		emptySince = undefined;
		return;
	}
	if (seenBarcodes.size && emptySince === undefined) {
		emptySince = Date.now();
		return;
	}
	if (emptySince !== undefined && Date.now() - emptySince >= 500) {
		seenBarcodes.clear();
		emptySince = undefined;
	}
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
	await refreshCameras(generation);
	await openCamera(generation, selectedCameraId.value || service.cameraDeviceId, "reconnect");
}
async function decodeImage(file: File) {
	imageForCrop.value = file;
	imageAbort?.abort();
	imageAbort = new AbortController();
	imageBusy.value = true;
	imageError.value = "";
	imageChoices.value = [];
	try {
		const { decodeBarcodeImage } = await import("../lib/scanner");
		imageChoices.value = await decodeBarcodeImage(file, { signal: imageAbort.signal });
		if (imageChoices.value.length) imageForCrop.value = undefined;
		if (!imageChoices.value.length)
			imageError.value = "未识别到条码。请框选条码区域、旋转或换一张更清晰的图片。";
	} catch (reason) {
		if ((reason as Error).name !== "AbortError")
			imageError.value = "图片读取失败，请换一张图片重试。";
	} finally {
		imageBusy.value = false;
	}
}
function retryCroppedImage(files: File[]) {
	imageForCrop.value = undefined;
	if (files[0]) void decodeImage(files[0]);
}
function onImageFile(event: Event) {
	const input = event.target as HTMLInputElement;
	const file = input.files?.[0];
	if (file) void decodeImage(file);
	input.value = "";
}
function pasteImage(event: ClipboardEvent) {
	const file = Array.from(event.clipboardData?.files || []).find((entry) =>
		entry.type.startsWith("image/"),
	);
	if (file && props.presentation !== "camera") {
		event.preventDefault();
		void decodeImage(file);
	}
}
function dropImage(event: DragEvent) {
	const file = Array.from(event.dataTransfer?.files || []).find((entry) =>
		entry.type.startsWith("image/"),
	);
	if (file) {
		event.preventDefault();
		void decodeImage(file);
	}
}
function acceptImageChoice(choice: { text: string }) {
	imageAbort?.abort();
	imageChoices.value = [];
	imageError.value = "";
	decoded(choice.text, true);
}
function cancelImageDecode() {
	imageAbort?.abort();
	imageBusy.value = false;
}
async function openCamera(
	generation: number,
	deviceId: string,
	missingRecovery: "reconnect" | "fallback" | "none",
) {
	if (disposed || paused.value || !area.value || generation !== startGeneration) return;
	torchAvailable.value = false;
	torchOn.value = false;
	starting.value = true;
	error.value = "";
	try {
		await service.start(
			area.value,
			decoded,
			(reason) => {
				if (!disposed && generation === startGeneration) {
					error.value = cameraError(reason);
					emptySince = undefined;
				}
			},
			deviceId,
			framePresence,
		);
		if (disposed || generation !== startGeneration) return;
		cameraActive = true;
		torchAvailable.value = service.torchAvailable;
		torchOn.value = false;
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
			await refreshCameras(generation);
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
	torchAvailable.value = false;
	torchOn.value = false;
	// Release the presentation-level lock immediately. A getUserMedia request
	// may still be pending, and its stale finally block must not be responsible
	// for making a later resume retry possible.
	starting.value = false;
	void service.stop();
}
async function toggleTorch() {
	if (!torchAvailable.value || starting.value) return;
	const next = !torchOn.value;
	try {
		await service.setTorch(next);
		torchOn.value = next;
	} catch {
		torchAvailable.value = false;
		torchOn.value = false;
	}
}
function close() {
	disposed = true;
	if (flashTimer) clearTimeout(flashTimer);
	seenBarcodes.clear();
	emptySince = undefined;
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
	document.addEventListener("paste", pasteImage);
	navigator.mediaDevices?.addEventListener?.("devicechange", devicesChanged);
	void start();
});
onDeactivated(() => {
	seenBarcodes.clear();
	emptySince = undefined;
	stopCamera();
});
onBeforeUnmount(() => {
	imageAbort?.abort();
	document.removeEventListener("visibilitychange", visibilityChanged);
	document.removeEventListener("paste", pasteImage);
	navigator.mediaDevices?.removeEventListener?.("devicechange", devicesChanged);
	disposed = true;
	seenBarcodes.clear();
	emptySince = undefined;
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
		v-bind="
			presentation === 'modal'
				? {
						title: '扫描条码',
						drawer: false,
						size: 'small',
						panelClass: 'inventory-scanner',
					}
				: { class: 'inventory-scanner' }
		"
		@close="close"
	>
		<div
			v-if="presentation === 'inline' || presentation === 'continuous'"
			class="section-title-row"
		>
			<h3>{{ presentation === "continuous" ? "连续扫码" : "扫描条码" }}</h3>
		</div>
		<label
			v-if="cameraListPresentation(cameras) === 'select'"
			class="preview-field scanner-camera-select"
		>
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
		<p v-else-if="cameras.length === 1" class="scanner-camera-name" role="status">
			相机：{{ cameras[0]?.label }}
		</p>
		<p v-if="deviceNotice" role="status">{{ deviceNotice }}</p>
		<p v-if="paused" role="status">
			{{
				sessionExpired
					? "登录已过期，相机已暂停；输入已保留。"
					: "请确认数量与位置后继续扫描"
			}}
		</p>
		<div
			ref="area"
			class="scanner-camera"
			:aria-busy="starting"
			@dragover.prevent
			@drop="dropImage"
		>
			<div
				class="scanner-aim"
				:class="{ 'scanner-aim--success': successFlash }"
				aria-hidden="true"
			>
				<span class="scanner-aim__hint">将条码或二维码对准取景框</span>
			</div>
		</div>
		<UiButton
			v-if="torchAvailable"
			class="scanner-torch"
			:aria-pressed="torchOn"
			@click="toggleTorch"
			>{{ torchOn ? "关闭手电筒" : "手电筒" }}</UiButton
		>
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
		<div v-if="presentation !== 'camera'" class="scanner-image-tools">
			<input
				ref="imageInput"
				hidden
				style="display: none"
				type="file"
				accept="image/*"
				@change="onImageFile"
			/>
			<UiButton :disabled="imageBusy || paused" @click="imageInput?.click()"
				>从图片识别</UiButton
			>
			<p v-if="imageBusy" role="status">
				正在识别… <UiButton @click="cancelImageDecode">取消</UiButton>
			</p>
			<p
				v-if="imageError && !(imageForCrop && imageError.startsWith('未识别到条码'))"
				role="status"
			>
				{{ imageError }}
			</p>
			<ul v-if="imageChoices.length" aria-label="识别结果">
				<li v-for="choice in imageChoices" :key="choice.text + choice.format">
					<UiButton @click="acceptImageChoice(choice)"
						>{{ choice.text }} · {{ choice.format }}</UiButton
					>
				</li>
			</ul>
		</div>
		<ImageCrop
			v-if="imageForCrop && imageError.startsWith('未识别到条码')"
			:file="imageForCrop"
			free-aspect
			@choose="retryCroppedImage"
			@cancel="imageForCrop = undefined"
		/>
	</component>
</template>
<style scoped>
.inventory-scanner {
	min-width: 0;
}
.scanner-camera {
	position: relative;
	width: min(100%, 34dvh, 360px);
	aspect-ratio: 1;
	margin-inline: auto;
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
	height: 100%;
	object-fit: cover;
}
.scanner-aim {
	position: absolute;
	left: 50%;
	top: 50%;
	width: min(76%, 76%);
	height: auto;
	aspect-ratio: 1;
	transform: translate(-50%, -50%);
	box-sizing: border-box;
	box-shadow: 0 0 0 999px color-mix(in srgb, var(--p-ink) 42%, transparent);
	color: var(--p-surface);
	pointer-events: none;
	transition:
		border-color 120ms ease,
		color 120ms ease;
}
.scanner-aim::before {
	position: absolute;
	inset: 0;
	content: "";
	background:
		linear-gradient(currentColor, currentColor) left top / 22px 3px no-repeat,
		linear-gradient(currentColor, currentColor) left top / 3px 22px no-repeat,
		linear-gradient(currentColor, currentColor) right top / 22px 3px no-repeat,
		linear-gradient(currentColor, currentColor) right top / 3px 22px no-repeat,
		linear-gradient(currentColor, currentColor) left bottom / 22px 3px no-repeat,
		linear-gradient(currentColor, currentColor) left bottom / 3px 22px no-repeat,
		linear-gradient(currentColor, currentColor) right bottom / 22px 3px no-repeat,
		linear-gradient(currentColor, currentColor) right bottom / 3px 22px no-repeat;
}
.scanner-aim__hint {
	position: absolute;
	left: 50%;
	bottom: -2rem;
	transform: translateX(-50%);
	white-space: nowrap;
	font-size: var(--p-small);
	text-shadow: 0 1px 3px var(--p-ink);
}
.scanner-aim--success {
	border-color: var(--p-success);
	color: var(--p-success);
}
.scanner-torch {
	margin-top: var(--p-space-2);
}
@media (prefers-reduced-motion: reduce) {
	.scanner-aim {
		transition: none;
	}
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
