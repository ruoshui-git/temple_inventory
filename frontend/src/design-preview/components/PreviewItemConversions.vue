<script setup lang="ts">
import { computed, ref, nextTick, watch } from "vue";
import { reviewSession, type DraftLine } from "../reviewModel";
import PreviewOverlay from "../PreviewOverlay.vue";
import PreviewUiButton from "./PreviewUiButton.vue";
import PreviewConversionEditor from "./PreviewConversionEditor.vue";
const props = defineProps<{ code: string; disabled?: boolean }>();
const item = computed(() => reviewSession.stock.find((row) => row.code === props.code));
const line = ref<DraftLine>();
const dirty = ref(false);
const discard = ref(false);
const discardPanel = ref<HTMLElement>();
watch(discard, async (value) => {
	if (value) {
		await nextTick();
		discardPanel.value?.focus();
	}
});
function close() {
	if (dirty.value) discard.value = true;
	else line.value = undefined;
}
function edit() {
	if (!item.value || props.disabled) return;
	dirty.value = false;
	discard.value = false;
	line.value = {
		id: "item-conversion",
		code: props.code,
		qty: 1,
		uom: item.value.uom,
		location: "",
		entryUom: item.value.uom,
		entryQty: 1,
		conversionFactor: 1,
	};
}
</script>
<template>
	<details v-if="item" class="form-section">
		<summary>计量单位与换算（{{ item.alternateUnits?.length || 0 }}）</summary>
		<p>库存单位：{{ item.uom }}（只读）</p>
		<p v-for="row in item.alternateUnits" :key="row.uom">
			1 {{ row.uom }} = {{ row.factor }} {{ item.uom }}
		</p>
		<button type="button" :disabled="disabled" @click="edit">编辑常用换算</button>
		<PreviewOverlay v-if="line" :title="`${item.name} · 常用换算`" drawer @close="close">
			<div :inert="discard || undefined">
				<PreviewConversionEditor
					:line="line"
					:disabled="disabled"
					reusable-only
					@dirty-change="dirty = $event"
					@applied="line = undefined"
				/>
			</div>
			<div v-if="discard" ref="discardPanel" role="alert" tabindex="-1">
				<p>放弃尚未保存的常用换算？已创建的单位会保留。</p>
				<PreviewUiButton @click="discard = false">继续编辑</PreviewUiButton>
				<PreviewUiButton @click="line = undefined">放弃并关闭</PreviewUiButton>
			</div>
			<template #footer><PreviewUiButton @click="close">关闭换算</PreviewUiButton></template>
		</PreviewOverlay>
	</details>
</template>
