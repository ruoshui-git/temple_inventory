<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import { createCropper, type Cropper } from "cropperjs";
import Overlay from "./Overlay.vue";
import UiButton from "./UiButton.vue";
import {
	clampSelectionToBounds,
	fitImageAspect,
	imageBoundsInCanvas,
} from "../../lib/imageCropBounds";

/** Free-aspect region picker for retrying barcode decoding on part of an image. */
const props = defineProps<{ file: File }>();
const emit = defineEmits<{ choose: [files: File[]]; cancel: [] }>();
const host = ref<HTMLElement>();
const image = ref<HTMLImageElement>();
const ready = ref(false);
const stageSize = ref({ width: 512, height: 448 });
const busy = ref(false);
const error = ref("");
let cropper: Cropper | undefined;
let cropImageElement: HTMLElement | undefined;
let cropSelectionElement: HTMLElement | undefined;
let transformListener: (() => void) | undefined;
let selectionChangeListener: ((event: Event) => void) | undefined;
let objectUrl = "";
let disposed = false;
let initialSelectionSet = false;

onMounted(async () => {
	try {
		objectUrl = URL.createObjectURL(props.file);
		image.value!.src = objectUrl;
		cropper = createCropper(image.value!, { container: host.value! });
		const cropImage = cropper.getCropperImage();
		const selection = cropper.getCropperSelection();
		if (!cropImage || !selection) throw new Error("cropper elements unavailable");
		selection.aspectRatio = NaN;
		selection.initialAspectRatio = NaN;
		selection.initialCoverage = 1;
		selection.keyboard = true;
		await cropImage.$ready();
		if (!disposed) {
			const canvas = cropper.getCropperCanvas();
			if (!canvas) throw new Error("cropper canvas unavailable");
			const natural = cropImage.$image;
			const maxWidth = Math.min(512, host.value?.clientWidth || 512);
			const maxHeight = Math.min(window.innerHeight * 0.65, 448);
			stageSize.value = fitImageAspect(
				maxWidth,
				maxHeight,
				natural.naturalWidth,
				natural.naturalHeight,
			);
			await nextTick();
			cropImage.$center();
			await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
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
					const initial = {
						x: bounds.left + (bounds.right - bounds.left) * 0.05,
						y: bounds.top + (bounds.bottom - bounds.top) * 0.05,
						width: (bounds.right - bounds.left) * 0.9,
						height: (bounds.bottom - bounds.top) * 0.9,
					};
					if (initial.width)
						selection.$change(
							initial.x,
							initial.y,
							initial.width,
							initial.height,
							NaN,
							true,
						);
					initialSelectionSet = Boolean(initial.width && initial.height);
				}
				const bounded = clampSelectionToBounds(
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
						NaN,
						true,
					);
			};
			const onActionEnd = () => updateBounds();
			let correctingSelection = false;
			selectionChangeListener = (event: Event) => {
				if (correctingSelection) return;
				const detail = (event as CustomEvent).detail;
				if (
					!detail ||
					![detail.x, detail.y, detail.width, detail.height].every(Number.isFinite)
				)
					return;
				const canvasRect = canvas.getBoundingClientRect();
				const imageRect = cropImage.$image.getBoundingClientRect();
				const bounds = imageBoundsInCanvas(imageRect, canvasRect);
				const proposed = {
					x: detail.x,
					y: detail.y,
					width: detail.width,
					height: detail.height,
				};
				const bounded = clampSelectionToBounds(proposed, bounds);
				if (
					Object.keys(bounded).some(
						(key) =>
							Math.abs(
								bounded[key as keyof typeof bounded] -
									proposed[key as keyof typeof proposed],
							) > 0.01,
					)
				) {
					event.preventDefault();
					correctingSelection = true;
					selection.$change(
						bounded.x,
						bounded.y,
						bounded.width,
						bounded.height,
						NaN,
						true,
					);
					correctingSelection = false;
				}
			};
			if (
				typeof canvas.getBoundingClientRect === "function" &&
				typeof cropImage.$image?.getBoundingClientRect === "function" &&
				typeof cropImage.addEventListener === "function"
			) {
				cropImageElement = cropImage;
				cropSelectionElement = selection;
				transformListener = updateBounds;
				selection.addEventListener("change", selectionChangeListener);
				cropImage.addEventListener("transform", transformListener);
				canvas.addEventListener("actionend", onActionEnd);
				updateBounds();
				const observer =
					typeof ResizeObserver === "undefined"
						? undefined
						: new ResizeObserver(() => updateBounds());
				observer?.observe(canvas);
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
		if (!disposed) error.value = "无法预览此图片格式，请换一张图片。";
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
		const outputWidth = Math.max(1, Math.round(sourceWidth * outputScale));
		const outputHeight = Math.max(1, Math.round(sourceHeight * outputScale));
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
		emit("choose", [cropped]);
	} catch {
		if (!disposed) error.value = "框选失败，请重试或换一张图片。";
	} finally {
		busy.value = false;
	}
}

function rotate() {
	cropper?.getCropperImage()?.$rotate(90);
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
	if (cropSelectionElement && selectionChangeListener)
		cropSelectionElement.removeEventListener("change", selectionChangeListener);
	if (objectUrl) URL.revokeObjectURL(objectUrl);
});
</script>

<template>
	<Overlay
		title="裁剪图片"
		panel-class="image-crop-dialog"
		adaptive-creation
		@close="emit('cancel')"
	>
		<p>{{ file.name }} · 拖动选区框定条码区域。</p>
		<p>未识别到条码。请框选条码区域、旋转或换一张更清晰的图片。</p>
		<p v-if="!ready && !error" role="status">正在读取图片方向与尺寸…</p>
		<p v-if="error" role="alert">{{ error }}</p>
		<div
			ref="host"
			class="cropper-host"
			:style="{ width: `${stageSize.width}px`, height: `${stageSize.height}px` }"
		>
			<img ref="image" :alt="file.name" />
		</div>
		<template #footer>
			<UiButton @click="rotate">旋转 90°</UiButton>
			<UiButton :disabled="!ready || busy" :loading="busy" @click="crop"
				>框选后重试</UiButton
			>
		</template>
	</Overlay>
</template>

<style scoped>
.cropper-host {
	max-width: 100%;
	max-height: 65vh;
	margin: var(--p-gap) auto;
	background: var(--p-soft);
}

.cropper-host :deep(cropper-canvas) {
	width: 100%;
	height: 100%;
}
</style>
