<script setup lang="ts">
import ImageCrop from "./ui/ImageCrop.vue";
import AsyncImage from "./ui/AsyncImage.vue";
import { computed, ref } from "vue";
import UiButton from "./ui/UiButton.vue";
import SkeletonBlock from "./ui/SkeletonBlock.vue";
import Overlay from "./ui/Overlay.vue";
import type { AttachmentEntry, useAttachments } from "../features/attachments/useAttachments";
import InventoryIcon from "./InventoryIcon.vue";
const props = defineProps<{
	controller: ReturnType<typeof useAttachments>;
	disabled?: boolean;
	mode?: "edit" | "display";
	imagesOnly?: boolean;
	imageRole?: "main" | "attachments" | "all";
}>();
const selected = ref<AttachmentEntry>();
const picker = ref<HTMLInputElement>();
function openPicker() {
	picker.value?.click();
}
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
		<div v-if="imageRole === 'main'" class="main-image-picker-row">
			<div class="main-image-preview" aria-label="主图预览">
				<AsyncImage
					v-if="visibleFiles[0]?.url"
					:src="visibleFiles[0].url"
					:alt="visibleFiles[0].name"
					width="112"
					height="112"
					fit="contain"
				/>
				<div v-else class="main-image-placeholder">
					<InventoryIcon name="image" /><span>主图预览</span>
				</div>
			</div>
			<div class="main-image-actions">
				<UiButton
					v-if="mode !== 'display' && !disabled"
					type="button"
					icon="image"
					@click="openPicker"
					>选择主图</UiButton
				>
				<UiButton
					v-if="visibleFiles[0]?.url"
					type="button"
					icon="expand"
					@click="selected = visibleFiles[0]"
					>查看</UiButton
				>
				<UiButton
					v-if="visibleFiles[0] && mode !== 'display' && !disabled"
					type="button"
					icon="disposal"
					variant="danger"
					:disabled="visibleFiles[0].state === 'uploading'"
					@click="controller.remove(visibleFiles[0])"
					>移除</UiButton
				>
			</div>
			<p v-if="visibleFiles[0]?.state === 'pending'" class="main-image-status">
				保存资料后上传
			</p>
			<p
				v-else-if="visibleFiles[0]?.state === 'uploading'"
				class="main-image-status"
				role="status"
			>
				上传中 {{ visibleFiles[0].progress }}%
			</p>
			<div
				v-else-if="visibleFiles[0]?.state === 'error'"
				class="main-image-status"
				role="alert"
			>
				{{ visibleFiles[0].error }}
				<UiButton
					v-if="!disabled && mode !== 'display'"
					size="compact"
					@click="controller.upload(visibleFiles[0]!, true)"
					>重试上传</UiButton
				>
			</div>
			<input
				ref="picker"
				class="shared-file-picker-input"
				type="file"
				accept="image/*"
				@change="choose"
			/>
		</div>
		<div
			v-if="mode !== 'display' && !disabled && imageRole !== 'main'"
			class="shared-file-picker"
		>
			<UiButton
				type="button"
				:icon="imagesOnly ? 'image' : 'paperclip'"
				@click="openPicker"
				>{{ imagesOnly ? "添加图片附件" : "添加附件" }}</UiButton
			>
			<input
				ref="picker"
				class="shared-file-picker-input"
				type="file"
				multiple
				:accept="imagesOnly ? 'image/*' : undefined"
				@change="choose"
			/>
		</div>
		<article
			v-for="file in visibleFiles"
			:key="file.id"
			:class="{ 'main-image-file-row': imageRole === 'main' }"
		>
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
				class="shared-file-picker shared-file-picker-label"
				>重新选择文件<input
					class="shared-file-picker-input"
					type="file"
					@change="reselect(file, $event)" /></label
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
				:disabled="
					controller.actionBusy.value && controller.pendingAction(file) !== 'primary'
				"
				:loading="controller.pendingAction(file) === 'primary'"
				loading-label="正在设为主图…"
				>设为主图</UiButton
			><UiButton
				v-if="mode !== 'display' && !disabled"
				:disabled="
					file.state === 'uploading' ||
					(controller.actionBusy.value && controller.pendingAction(file) !== 'remove')
				"
				:loading="controller.pendingAction(file) === 'remove'"
				loading-label="正在移除…"
				@click="controller.remove(file)"
				>移除</UiButton
			>
		</article>
		<p v-if="controller.error.value" role="alert">
			{{ controller.error.value }}
			<UiButton @click="controller.fetch()">重试读取附件</UiButton>
		</p>
		<SkeletonBlock
			v-if="controller.loading.value && !controller.initialized.value"
			variant="list"
			:rows="3"
		/>
		<p
			v-else-if="
				!controller.error.value &&
				controller.initialized.value &&
				!visibleFiles.length &&
				imageRole !== 'main'
			"
			class="muted"
		>
			暂无附件
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
.main-image-picker-row {
	display: flex;
	align-items: end;
	flex-wrap: wrap;
	gap: 12px;
}
.main-image-actions {
	display: flex;
	align-items: center;
	flex-wrap: wrap;
	gap: 8px;
}
.main-image-status {
	flex: 1 0 100%;
	margin: 0 0 0 124px;
	color: var(--p-muted);
}
.main-image-status[role="alert"] {
	color: var(--p-danger);
}
@media (max-width: 1023px) {
	.main-image-picker-row {
		align-items: center;
	}
	.main-image-file-row {
		display: none;
	}
}
@media (min-width: 1024px) {
	.main-image-actions {
		display: block;
		align-self: end;
	}
	.main-image-actions > :deep(.ui-button:not(:first-child)),
	.main-image-status {
		display: none;
	}
}
.main-image-preview {
	width: 112px;
	height: 112px;
	border: 1px solid var(--p-border);
	border-radius: var(--p-radius-control);
	background: var(--p-surface);
}
.main-image-preview :deep(.async-image),
.main-image-placeholder {
	width: 100%;
	height: 100%;
	object-fit: contain;
}
.main-image-placeholder {
	display: grid;
	place-content: center;
	justify-items: center;
	gap: 6px;
	color: var(--p-muted);
	background: var(--p-soft);
}
.main-image-placeholder :deep(svg) {
	width: 28px;
	height: 28px;
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
