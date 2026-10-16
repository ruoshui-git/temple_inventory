<script setup lang="ts">
import { ref } from "vue";
import type { PreviewAttachment } from "../workflowModel";
import PreviewUiButton from "./PreviewUiButton.vue";
import PreviewOverlay from "../PreviewOverlay.vue";
const props = defineProps<{
	modelValue?: PreviewAttachment[];
	disabled?: boolean;
	mode?: "edit" | "display";
	imagesOnly?: boolean;
}>();
const emit = defineEmits<{ "update:modelValue": [files: PreviewAttachment[]] }>();
const failNext = ref(false),
	selected = ref<PreviewAttachment>();
function update(files: PreviewAttachment[]) {
	emit("update:modelValue", files);
}
function upload(event: Event) {
	const input = event.target as HTMLInputElement;
	const files = Array.from(input.files || []).filter(
		(file) => !props.imagesOnly || file.type.startsWith("image/"),
	);
	const shouldFail = failNext.value;
	failNext.value = false;
	const added = files.map((file, index): PreviewAttachment => ({
		id: `${Date.now()}-${index}`,
		name: file.name,
		type: file.type,
		state: "uploading",
	}));
	update([...(props.modelValue || []), ...added]);
	files.forEach((file, index) => {
		const attachment = added[index]!;
		const reader = new FileReader();
		reader.onload = () => {
			const current = props.modelValue?.find((row) => row.id === attachment.id);
			if (current) {
				current.url = String(reader.result);
				current.state = shouldFail ? "error" : "ready";
			}
		};
		reader.onerror = () => {
			const current = props.modelValue?.find((row) => row.id === attachment.id);
			if (current) current.state = "error";
		};
		reader.readAsDataURL(file);
	});
	input.value = "";
}
function remove(file: PreviewAttachment) {
	if (selected.value?.id === file.id) selected.value = undefined;
	update((props.modelValue || []).filter((row) => row.id !== file.id));
}
</script>
<template>
	<div class="preview-attachments">
		<label class="preview-field" v-if="mode !== 'display' && !disabled"
			>{{ imagesOnly ? "添加图片" : "添加附件"
			}}<input
				type="file"
				multiple
				:accept="imagesOnly ? 'image/*' : undefined"
				@change="upload"
		/></label>
		<article v-for="(file, index) in modelValue" :key="file.id">
			<img
				v-if="file.type.startsWith('image/') && file.url"
				:src="file.url"
				:alt="file.name"
				width="56"
				height="56"
			/><span>{{ file.name }} <small v-if="imagesOnly && index === 0">主图</small></span
			><span v-if="file.state === 'uploading'" role="status">上传中</span
			><template v-else-if="file.state === 'error'"
				><span role="alert">上传失败，文件保留</span
				><PreviewUiButton
					v-if="mode !== 'display' && !disabled"
					@click="file.state = 'ready'"
					>重试上传</PreviewUiButton
				></template
			><PreviewUiButton v-else @click="selected = file">查看附件</PreviewUiButton
			><PreviewUiButton
				v-if="imagesOnly && index > 0 && mode !== 'display' && !disabled"
				@click="update([file, ...(modelValue || []).filter((row) => row.id !== file.id)])"
				>设为主图</PreviewUiButton
			><PreviewUiButton v-if="mode !== 'display' && !disabled" @click="remove(file)"
				>移除</PreviewUiButton
			>
		</article>
		<p v-if="!modelValue?.length" class="muted">暂无附件</p>
		<details v-if="mode !== 'display' && !disabled">
			<summary>预览上传状态</summary>
			<label class="preview-choice-label"
				><input v-model="failNext" type="checkbox" />下次上传失败</label
			><PreviewUiButton
				v-if="modelValue?.length"
				@click="
					modelValue[0]!.state =
						modelValue[0]!.state === 'uploading' ? 'ready' : 'uploading'
				"
				>切换上传进度</PreviewUiButton
			>
		</details>
		<PreviewOverlay v-if="selected" :title="selected.name" @close="selected = undefined"
			><img
				v-if="selected.type.startsWith('image/') && selected.url"
				:src="selected.url"
				:alt="selected.name"
				style="max-width: 100%"
			/><a v-else-if="selected.url" :href="selected.url" target="_blank" rel="noopener"
				>打开文档</a
			>
			<a v-if="selected.url" :href="selected.url" :download="selected.name">下载附件</a>
			<p v-else>示例附件 · 文件内容不可用</p></PreviewOverlay
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
article img {
	object-fit: contain;
}
article span {
	flex: 1;
}
small {
	display: block;
}
</style>
