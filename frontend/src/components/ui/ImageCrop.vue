<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { createCropper, type Cropper } from "cropperjs";
import Overlay from "./Overlay.vue";
import UiButton from "./UiButton.vue";
import {
	clampSquareSelection,
	cropBoundsInset,
	imageBoundsInCanvas,
} from "../../lib/imageCropBounds";

const props = defineProps<{ file: File; index?: number; total?: number }>();
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
		selection.aspectRatio = 1;
		selection.initialAspectRatio = 1;
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
				selection.minInset = cropBoundsInset(bounds, canvasRect.width, canvasRect.height);
				const bounded = clampSquareSelection(
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
		const sourceCrop = Math.floor(
			Math.min(
				selection.width / scale,
				selection.height / scale,
				sourceImage.naturalWidth,
				sourceImage.naturalHeight,
			),
		);
		const outputSize = Math.min(800, sourceCrop);
		if (outputSize < 1) throw new Error("crop is too small");
		const selectedCanvas = await selection.$toCanvas({
			width: outputSize,
			height: outputSize,
		});
		if (disposed) return;
		const output = document.createElement("canvas");
		output.width = outputSize;
		output.height = outputSize;
		const context = output.getContext("2d");
		if (!context) throw new Error("canvas unavailable");
		context.drawImage(selectedCanvas, 0, 0, outputSize, outputSize);
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
	cropper?.getCropperSelection()?.$reset();
	cropper?.getCropperImage()?.$center();
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
		<p>{{ file.name }} · 拖动方形选区调整范围；方向键可微调位置。</p>
		<p v-if="!ready && !error" role="status">正在读取图片方向与尺寸…</p>
		<p v-if="error" role="alert">{{ error }}</p>
		<div ref="host" class="cropper-host">
			<img ref="image" :alt="file.name" />
		</div>
		<div v-if="ready" class="preview-form-grid">
			<UiButton @click="zoom(-0.1)">缩小图片</UiButton>
			<UiButton @click="zoom(0.1)">放大图片</UiButton>
			<label class="preview-choice-label">
				<input v-model="retain" type="checkbox" />另存原图为附件
			</label>
		</div>
		<template #footer>
			<UiButton
				:disabled="busy || (!!pendingAction && pendingAction !== 'cancel')"
				:loading="pendingAction === 'cancel'"
				loading-label="正在取消…"
				@click="chooseAction('cancel')"
				>取消此图片</UiButton
			>
			<UiButton
				:disabled="busy || (!!pendingAction && pendingAction !== 'original')"
				:loading="pendingAction === 'original'"
				loading-label="正在使用原图…"
				@click="chooseAction('original')"
				>使用原图作为主图</UiButton
			>
			<UiButton :disabled="!ready || busy || !!pendingAction" @click="reset"
				>重置裁剪</UiButton
			>
			<UiButton variant="primary" :disabled="!ready" :loading="busy" @click="crop"
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

.cropper-host :deep(cropper-selection) {
	aspect-ratio: 1;
}
</style>
