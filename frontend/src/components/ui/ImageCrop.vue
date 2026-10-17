<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import Overlay from "./Overlay.vue";
import UiButton from "./UiButton.vue";
const props = defineProps<{ file: File; index?: number; total?: number }>();
const emit = defineEmits<{ choose: [files: File[]]; cancel: [] }>();
const canvas = ref<HTMLCanvasElement>(),
	zoom = ref(1),
	x = ref(50),
	y = ref(50),
	retain = ref(false),
	error = ref(""),
	ready = ref(false),
	busy = ref(false);
let bitmap: ImageBitmap | undefined,
	disposed = false;
const title = computed(
	() => `裁剪图片${props.total && props.total > 1 ? `（${props.index} / ${props.total}）` : ""}`,
);
function draw() {
	const context = canvas.value?.getContext("2d");
	if (!context || !bitmap) return;
	const side = Math.min(bitmap.width, bitmap.height) / zoom.value;
	const left = ((bitmap.width - side) * x.value) / 100,
		top = ((bitmap.height - side) * y.value) / 100;
	context.clearRect(0, 0, 800, 800);
	context.drawImage(bitmap, left, top, side, side, 0, 0, 800, 800);
}
onMounted(async () => {
	try {
		const image = await createImageBitmap(props.file, { imageOrientation: "from-image" });
		if (disposed) {
			image.close();
			return;
		}
		bitmap = image;
		ready.value = true;
		draw();
	} catch {
		error.value = "无法预览此图片格式。可使用原图，或取消后选择其它图片。";
	}
});
watch([zoom, x, y], draw);
async function crop() {
	if (!ready.value || busy.value || !canvas.value) return;
	busy.value = true;
	error.value = "";
	try {
		const blob = await new Promise<Blob>((resolve, reject) =>
			canvas.value!.toBlob(
				(value) => (value ? resolve(value) : reject(new Error("无法生成裁剪图片"))),
				"image/png",
			),
		);
		if (disposed) return;
		const file = new File([blob], props.file.name.replace(/\.[^.]+$/, "") + "-裁剪.png", {
			type: "image/png",
		});
		const original = new File([props.file], "原图-" + props.file.name, {
			type: props.file.type,
			lastModified: props.file.lastModified,
		});
		emit("choose", retain.value ? [file, original] : [file]);
	} catch {
		if (!disposed) error.value = "裁剪失败，原文件仍保留，请重试或使用原图。";
	} finally {
		busy.value = false;
	}
}
onBeforeUnmount(() => {
	disposed = true;
	bitmap?.close();
});
</script>
<template>
	<Overlay :title="title" adaptive-creation @close="emit('cancel')">
		<p>{{ file.name }} · 调整方形范围；文档证据可选择使用原图。</p>
		<p v-if="!ready && !error" role="status">正在读取图片方向与尺寸…</p>
		<p v-if="error" role="alert">{{ error }}</p>
		<canvas
			ref="canvas"
			width="800"
			height="800"
			class="crop-preview"
			aria-label="方形裁剪预览"
		/>
		<div v-if="ready" class="preview-form-grid">
			<label class="preview-field"
				>缩放<input v-model.number="zoom" type="range" min="1" max="4" step="0.05"
			/></label>
			<label class="preview-field"
				>水平位置<input v-model.number="x" type="range" min="0" max="100"
			/></label>
			<label class="preview-field"
				>垂直位置<input v-model.number="y" type="range" min="0" max="100"
			/></label>
			<label class="preview-choice-label"
				><input v-model="retain" type="checkbox" />保留原图（额外的原图附件）</label
			>
		</div>
		<template #footer>
			<UiButton :disabled="busy" @click="emit('cancel')">取消此图片</UiButton>
			<UiButton :disabled="busy" @click="emit('choose', [file])">使用原图</UiButton>
			<UiButton variant="primary" :disabled="!ready" :loading="busy" @click="crop"
				>使用裁剪图片</UiButton
			>
		</template>
	</Overlay>
</template>
<style scoped>
.crop-preview {
	display: block;
	width: min(100%, 24rem);
	aspect-ratio: 1;
	height: auto;
	background: var(--p-soft);
	margin: var(--p-space-3) auto;
}
</style>
