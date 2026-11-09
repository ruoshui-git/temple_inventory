<script setup lang="ts">
import { computed, ref } from "vue";
import Overlay from "./ui/Overlay.vue";
import UiButton from "./ui/UiButton.vue";
import InventoryIcon from "./InventoryIcon.vue";
const props = defineProps<{ url: string; number: string }>();
const emit = defineEmits<{ close: [] }>();
const frame = ref<HTMLIFrameElement>();
const phone = computed(() => window.matchMedia("(max-width: 700px)").matches);
function download() {
	const link = document.createElement("a");
	link.href = props.url;
	link.download = `${props.number}.pdf`;
	document.body.append(link);
	link.click();
	link.remove();
}
function print() {
	frame.value?.contentWindow?.print();
}
</script>
<template>
	<Overlay title="打印预览" panel-class="record-print-dialog" @close="emit('close')">
		<div class="record-print-actions">
			<UiButton v-if="!phone" @click="print"><InventoryIcon name="print" />打印</UiButton>
			<UiButton :variant="phone ? 'primary' : 'secondary'" @click="download"
				><InventoryIcon name="download" />下载</UiButton
			>
		</div>
		<p v-if="phone" class="muted">手机浏览器可能无法预览 PDF，请下载后打开或打印。</p>
		<iframe v-if="!phone" ref="frame" :src="url" :title="`${number} PDF 预览`" />
	</Overlay>
</template>
<style scoped>
.record-print-dialog {
	width: min(1100px, 96vw);
	height: min(90dvh, 900px);
	max-height: min(90dvh, 900px);
}
.record-print-dialog :deep(.dialog-content) {
	display: flex;
	flex-direction: column;
	min-height: 0;
	overflow: hidden;
}
.record-print-actions {
	display: flex;
	justify-content: flex-end;
	gap: var(--p-control-gap);
	margin-bottom: var(--p-field-gap);
}
iframe {
	width: 100%;
	flex: 1;
	min-height: 0;
	border: 1px solid var(--p-border);
}
</style>
