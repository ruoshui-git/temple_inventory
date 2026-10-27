<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { createCropper, type Cropper } from "cropperjs";
import Overlay from "./Overlay.vue";
import UiButton from "./UiButton.vue";
import {
	clampSquareSelection,
	cropBoundsInset,
	imageBoundsInCanvas,
	largestCenteredSquare,
} from "../../lib/imageCropBounds";

const props = defineProps<{ file: File; index?: number; total?: number; freeAspect?: boolean }>();
const emit = defineEmits<{ choose: [files: File[]]; cancel: [] }>();
const host = ref<HTMLElement>();
const image = ref<HTMLImageElement>();
const ready = ref(false);
const busy = ref(false);
const pendingAction = ref<"cancel" | "original" | "">("");
const retain = ref(false);
const error = ref("");
let cropper: Cropper | undefined;
let cropImageElement: HTMLElement | undefined;
let transformListener: (() => void) | undefined;
let updateBoundsQueued = false;
let objectUrl = "";
let disposed = false;
let initialSelection = { x: 0, y: 0, width: 0, height: 0 };
let initialSelectionSet = false;

const title = computed(
	() => `裁剪图片${props.total && props.total > 1 ? `（${props.index} / ${props.total}）` : ""}`,
);
function chooseAction(action: "cancel" | "original") {
	if (busy.value) return;
	pendingAction.value = action;
	if (action === "cancel") emit("cancel");
	else emit("choose", [props.file]);
}

onMounted(async () => {
	try {
		objectUrl = URL.createObjectURL(props.file);
		image.value!.src = objectUrl;
		cropper = createCropper(image.value!, { container: host.value! });
		const cropImage = cropper.getCropperImage();
		const selection = cropper.getCropperSelection();
		if (!cropImage || !selection) throw new Error("cropper elements unavailable");
		selection.aspectRatio = props.freeAspect ? NaN : 1;
		selection.initialAspectRatio = props.freeAspect ? NaN : 1;
		selection.initialCoverage = 1;
		selection.keyboard = true;
		selection.maxInset = "auto";
		await cropImage.$ready();
		if (!disposed) {
			const canvas = cropper.getCropperCanvas();
			if (!canvas) throw new Error("cropper canvas unavailable");
			const updateBounds = () => {
				if (disposed || !cropImage?.$image || !selection || !canvas) return;
				const canvasRect = canvas.getBoundingClientRect();
				const imageRect = cropImage.$image.getBoundingClientRect();
				if (
					!canvasRect.width ||
					!canvasRect.height ||
					!imageRect.width ||
					!imageRect.height
				)
					return;
				const bounds = imageBoundsInCanvas(imageRect, canvasRect);
				if (!initialSelectionSet) {
					const initial = props.freeAspect
						? {
								x: bounds.left + (bounds.right - bounds.left) * 0.05,
								y: bounds.top + (bounds.bottom - bounds.top) * 0.05,
								width: (bounds.right - bounds.left) * 0.9,
								height: (bounds.bottom - bounds.top) * 0.9,
							}
						: largestCenteredSquare(bounds);
					if (initial.width)
						selection.$change(
							initial.x,
							initial.y,
							initial.width,
							initial.height,
							props.freeAspect ? NaN : 1,
							true,
						);
					initialSelection = { ...initial };
					initialSelectionSet = Boolean(initial.width && initial.height);
				}
				selection.minInset = cropBoundsInset(bounds, canvasRect.width, canvasRect.height);
				const bounded = props.freeAspect
					? {
							x: Math.max(
								bounds.left,
								Math.min(selection.x, bounds.right - selection.width),
							),
							y: Math.max(
								bounds.top,
								Math.min(selection.y, bounds.bottom - selection.height),
							),
							width: Math.min(selection.width, bounds.right - bounds.left),
							height: Math.min(selection.height, bounds.bottom - bounds.top),
						}
					: clampSquareSelection(
							{
								x: selection.x,
								y: selection.y,
								width: selection.width,
								height: selection.height,
							},
							bounds,
						);
				if (
					Math.abs(bounded.x - selection.x) > 0.01 ||
					Math.abs(bounded.y - selection.y) > 0.01 ||
					Math.abs(bounded.width - selection.width) > 0.01 ||
					Math.abs(bounded.height - selection.height) > 0.01
				)
					selection.$change(
						bounded.x,
						bounded.y,
						bounded.width,
						bounded.height,
						1,
						true,
					);
			};
			const queueBoundsUpdate = () => {
				if (updateBoundsQueued) return;
				updateBoundsQueued = true;
				queueMicrotask(() => {
					updateBoundsQueued = false;
					updateBounds();
				});
			};
			if (
				typeof canvas.getBoundingClientRect === "function" &&
				typeof cropImage.$image?.getBoundingClientRect === "function" &&
				typeof cropImage.addEventListener === "function"
			) {
				cropImageElement = cropImage;
				transformListener = queueBoundsUpdate;
				cropImage.addEventListener("transform", transformListener);
				updateBounds();
				const observer =
					typeof ResizeObserver === "undefined"
						? undefined
						: new ResizeObserver(() => updateBounds());
				observer?.observe(canvas);
				observer?.observe(cropImage.$image);
				const waitForLayout = () => {
					if (disposed) {
						observer?.disconnect();
						return;
					}
					const rect = cropImage.$image.getBoundingClientRect();
					if (!rect.width || !rect.height) requestAnimationFrame(waitForLayout);
					else {
						updateBounds();
						observer?.disconnect();
					}
				};
				requestAnimationFrame(waitForLayout);
			}
			ready.value = true;
		}
	} catch {
		if (!disposed) error.value = "无法预览此图片格式。可使用原图，或取消后选择其它图片。";
	}
});

async function crop() {
	if (!ready.value || busy.value || disposed) return;
	busy.value = true;
	error.value = "";
	try {
		const selection = cropper?.getCropperSelection();
		const cropImage = cropper?.getCropperImage();
		if (!selection || !selection.width || !selection.height)
			throw new Error("selection unavailable");
		const sourceImage = cropImage?.$image;
		if (!cropImage || !sourceImage?.naturalWidth || !sourceImage.naturalHeight)
			throw new Error("image dimensions unavailable");
		const transform = cropImage.$getTransform();
		const scale = Math.hypot(transform[0] || 0, transform[1] || 0);
		if (!scale) throw new Error("image scale unavailable");
		const sourceWidth = Math.min(selection.width / scale, sourceImage.naturalWidth);
		const sourceHeight = Math.min(selection.height / scale, sourceImage.naturalHeight);
		const outputScale = Math.min(1, 800 / Math.max(sourceWidth, sourceHeight));
		const sourceSquare = Math.floor(Math.min(sourceWidth, sourceHeight));
		const outputWidth = props.freeAspect
			? Math.max(1, Math.round(sourceWidth * outputScale))
			: Math.min(800, sourceSquare);
		const outputHeight = props.freeAspect
			? Math.max(1, Math.round(sourceHeight * outputScale))
			: outputWidth;
		const selectedCanvas = await selection.$toCanvas({
			width: outputWidth,
			height: outputHeight,
		});
		if (disposed) return;
		const output = document.createElement("canvas");
		output.width = outputWidth;
		output.height = outputHeight;
		const context = output.getContext("2d");
		if (!context) throw new Error("canvas unavailable");
		context.drawImage(selectedCanvas, 0, 0, outputWidth, outputHeight);
		const blob = await new Promise<Blob>((resolve, reject) =>
			output.toBlob(
				(value) => (value ? resolve(value) : reject(new Error("无法生成裁剪图片"))),
				"image/webp",
				0.85,
			),
		);
		if (disposed) return;
		const webp = blob.type === "image/webp";
		const cropped = new File(
			[blob],
			props.file.name.replace(/\.[^.]+$/, "") + (webp ? "-裁剪.webp" : "-裁剪.png"),
			{ type: webp ? "image/webp" : "image/png" },
		);
		const original = new File([props.file], `原图-${props.file.name}`, {
			type: props.file.type,
			lastModified: props.file.lastModified,
		});
		emit("choose", retain.value ? [cropped, original] : [cropped]);
	} catch {
		if (!disposed) error.value = "裁剪失败，原文件仍保留，请重试或使用原图。";
	} finally {
		busy.value = false;
	}
}

function reset() {
	const selection = cropper?.getCropperSelection();
	if (selection && initialSelection.width)
		selection.$change(
			initialSelection.x,
			initialSelection.y,
			initialSelection.width,
			initialSelection.height,
			props.freeAspect ? NaN : 1,
			true,
		);
	cropper?.getCropperImage()?.$center();
}
function rotate() {
	cropper?.getCropperImage()?.$rotate(90);
}
function zoom(factor: number) {
	cropper?.getCropperImage()?.$zoom(factor);
}

onBeforeUnmount(() => {
	disposed = true;
	cropper?.destroy();
	if (
		cropImageElement &&
		transformListener &&
		typeof cropImageElement.removeEventListener === "function"
	)
		cropImageElement.removeEventListener("transform", transformListener);
	if (objectUrl) URL.revokeObjectURL(objectUrl);
});
</script>

<template>
	<Overlay
		:title="title"
		panel-class="image-crop-dialog"
		adaptive-creation
		@close="emit('cancel')"
	>
		<p>
			{{ file.name }} ·
			{{
				freeAspect ? "拖动选区框定条码区域。" : "拖动方形选区调整范围；方向键可微调位置。"
			}}
		</p>
		<p v-if="freeAspect">未识别到条码。请框选条码区域、旋转或换一张更清晰的图片。</p>
		<p v-if="!ready && !error" role="status">正在读取图片方向与尺寸…</p>
		<p v-if="error" role="alert">{{ error }}</p>
		<div ref="host" class="cropper-host" :class="{ 'cropper-host--free': freeAspect }">
			<img ref="image" :alt="file.name" />
		</div>
		<div v-if="ready" class="preview-form-grid">
			<template v-if="!freeAspect">
				<UiButton @click="zoom(-0.1)">缩小图片</UiButton>
				<UiButton @click="zoom(0.1)">放大图片</UiButton>
				<label class="preview-choice-label">
					<input v-model="retain" type="checkbox" />另存原图为附件
				</label>
			</template>
		</div>
		<template #footer>
			<UiButton v-if="freeAspect" @click="rotate">旋转 90°</UiButton>
			<UiButton
				v-if="!freeAspect"
				:disabled="busy || (!!pendingAction && pendingAction !== 'cancel')"
				:loading="pendingAction === 'cancel'"
				loading-label="正在取消…"
				@click="chooseAction('cancel')"
				>取消此图片</UiButton
			>
			<UiButton
				v-if="!freeAspect"
				:disabled="busy || (!!pendingAction && pendingAction !== 'original')"
				:loading="pendingAction === 'original'"
				loading-label="正在使用原图…"
				@click="chooseAction('original')"
				>使用原图作为主图</UiButton
			>
			<UiButton
				v-if="!freeAspect"
				:disabled="!ready || busy || !!pendingAction"
				@click="reset"
				>重置裁剪</UiButton
			>
			<UiButton v-if="freeAspect" :disabled="!ready || busy" :loading="busy" @click="crop"
				>框选后重试</UiButton
			>
			<UiButton v-else variant="primary" :disabled="!ready" :loading="busy" @click="crop"
				>使用裁剪后的图片</UiButton
			>
		</template>
	</Overlay>
</template>

<style scoped>
.cropper-host {
	width: min(100%, 32rem);
	height: min(65vh, 28rem);
	margin: var(--p-space-3) auto;
	background: var(--p-soft);
}

.preview-form-grid {
	display: flex;
	flex-wrap: wrap;
	gap: 8px;
}

.cropper-host :deep(cropper-canvas) {
	width: 100%;
	height: 100%;
}

.cropper-host:not(.cropper-host--free) :deep(cropper-selection) {
	aspect-ratio: 1;
}
</style>
