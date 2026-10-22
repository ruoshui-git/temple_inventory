<script setup lang="ts">
import ImageCrop from "./ui/ImageCrop.vue";
import AsyncImage from "./ui/AsyncImage.vue";
import { computed, ref } from "vue";
import UiButton from "./ui/UiButton.vue";
import Overlay from "./ui/Overlay.vue";
import type { AttachmentEntry, useAttachments } from "../features/attachments/useAttachments";
const props = defineProps<{
	controller: ReturnType<typeof useAttachments>;
	disabled?: boolean;
	mode?: "edit" | "display";
	imagesOnly?: boolean;
	imageRole?: "main" | "attachments" | "all";
}>();
const selected = ref<AttachmentEntry>();
const cropQueue = ref<File[]>([]);
const cropIndex = ref(0),
	cropTotal = ref(0);
function choose(event: Event) {
	const input = event.target as HTMLInputElement;
	const values = Array.from(input.files || []).filter(
		(file) => !props.imagesOnly || file.type.startsWith("image/"),
	);
	const images = values.filter((file) => file.type.startsWith("image/"));
	if (props.imageRole === "main") {
		cropQueue.value.push(...images);
		cropTotal.value += images.length;
	} else if (values.length) props.controller.add(values);
	input.value = "";
}
function finishCrop(values: File[] = []) {
	if (!props.disabled && props.mode !== "display")
		props.controller.add(values, !!props.imagesOnly);
	cropQueue.value.shift();
	cropIndex.value++;
	if (!cropQueue.value.length) {
		cropTotal.value = 0;
		cropIndex.value = 0;
	}
}
function reselect(entry: AttachmentEntry, event: Event) {
	const input = event.target as HTMLInputElement;
	const file = input.files?.[0];
	if (file) props.controller.reselect(entry, file);
	input.value = "";
}
const visibleFiles = computed(() =>
	props.imageRole === "main"
		? props.controller.files.filter((file) => file.primary)
		: props.imageRole === "attachments"
			? props.controller.files.filter((file) => !file.primary)
			: props.controller.files,
);
</script>
<template>
	<div class="preview-attachments">
		<label v-if="mode !== 'display' && !disabled" class="preview-field"
			>{{ imageRole === "main" ? "选择主图" : imagesOnly ? "添加图片附件" : "添加附件"
			}}<input
				type="file"
				multiple
				:accept="imagesOnly ? 'image/*' : undefined"
				@change="choose"
		/></label>
		<article v-for="file in visibleFiles" :key="file.id">
			<AsyncImage
				v-if="file.type.startsWith('image/')"
				:src="file.url"
				:alt="file.name"
				width="56"
				height="56"
				fit="contain"
			/><span>{{ file.name }}<small v-if="file.primary">主图</small></span
			><span v-if="file.state === 'pending'">保存资料后上传</span
			><span v-if="file.state === 'uploading'" role="status"
				>上传中 {{ file.progress }}%</span
			><template v-if="file.state === 'error'"
				><span role="alert">{{ file.error }}</span
				><UiButton
					v-if="!disabled && mode !== 'display'"
					@click="controller.upload(file, true)"
					>重试上传</UiButton
				></template
			><label
				v-if="file.state === 'reselect' && !disabled && mode !== 'display'"
				class="preview-field"
				>需要重新选择文件<input type="file" @change="reselect(file, $event)" /></label
			><UiButton v-if="file.url && file.state !== 'uploading'" @click="selected = file">{{
				imageRole === "main" ? "查看主图" : "查看附件"
			}}</UiButton
			><UiButton
				v-if="
					file.type.startsWith('image/') &&
					!file.primary &&
					imageRole !== 'main' &&
					mode !== 'display' &&
					!disabled
				"
				@click="controller.primary(file)"
				>设为主图</UiButton
			><UiButton
				v-if="mode !== 'display' && !disabled"
				:disabled="file.state === 'uploading'"
				@click="controller.remove(file)"
				>移除</UiButton
			>
		</article>
		<p v-if="controller.error.value" role="alert">
			{{ controller.error.value }}
			<UiButton @click="controller.fetch()">重试读取附件</UiButton>
		</p>
		<p v-if="controller.loading.value" role="status">正在读取附件…</p>
		<p
			v-else-if="
				!controller.error.value && controller.initialized.value && !visibleFiles.length
			"
			class="muted"
		>
			{{ imageRole === "main" ? "暂无主图" : "暂无附件" }}
		</p>
		<ImageCrop
			v-if="cropQueue[0]"
			:key="cropIndex"
			:file="cropQueue[0]"
			:index="cropIndex + 1"
			:total="cropTotal"
			@choose="finishCrop"
			@cancel="finishCrop()"
		/>
		<Overlay v-if="selected" :title="selected.name" @close="selected = undefined"
			><img
				v-if="selected.type.startsWith('image/') && selected.url"
				:src="selected.url"
				:alt="selected.name"
				style="max-width: 100%"
			/><a v-else-if="selected.url" :href="selected.url" target="_blank" rel="noopener"
				>打开文档</a
			><a
				v-if="selected.serverName && selected.url"
				:href="selected.url"
				:download="selected.name"
				>下载附件</a
			></Overlay
		>
	</div>
</template>
<style scoped>
article {
	display: flex;
	align-items: center;
	flex-wrap: wrap;
	gap: 8px;
	padding: 8px 0;
}
article :deep(.async-image) {
	flex: 0 0 56px;
	aspect-ratio: 1;
	object-fit: contain;
}
article span {
	flex: 1 1 min(100%, 12em);
	overflow-wrap: anywhere;
}
small {
	display: block;
}
</style>
