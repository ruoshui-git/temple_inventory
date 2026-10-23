<script setup lang="ts">
import { computed, ref, nextTick, watch } from "vue";
import type { ConversionLine } from "../../lib/quantityConversion";
import type { StockItem } from "../../lib/stockPresentation";
import Overlay from "../../components/ui/Overlay.vue";
import UiButton from "../../components/ui/UiButton.vue";
import ConversionEditor from "../conversions/ConversionEditor.vue";
import DisclosureSection from "../../components/ui/DisclosureSection.vue";
import type { SavedItemConversions } from "../conversions/useConversionEditor";
const props = defineProps<{ item: StockItem; disabled?: boolean; inline?: boolean }>();
const emit = defineEmits<{
	dirtyChange: [dirty: boolean];
	updated: [value: SavedItemConversions];
}>();
const item = computed(() => props.item);
const line = ref<ConversionLine>();
const dirty = ref(false);
const discard = ref(false);
watch(dirty, (value) => emit("dirtyChange", value), { flush: "sync" });
const discardPanel = ref<HTMLElement>();
watch(discard, async (value) => {
	if (value) {
		await nextTick();
		discardPanel.value?.focus();
	}
});
function close() {
	if (dirty.value) discard.value = true;
	else {
		line.value = undefined;
		dirty.value = false;
	}
}
function edit() {
	if (!item.value || props.disabled || !item.value.canEdit) return;
	dirty.value = false;
	discard.value = false;
	line.value = {
		code: item.value.code,
		qty: 1,
		uom: item.value.uom,
		entryUom: item.value.uom,
		entryQty: 1,
		conversionFactor: 1,
	};
}
</script>
<template>
	<DisclosureSection
		v-if="item"
		title="计量单位与换算"
		:count="item.alternateUnits?.length || 0"
	>
		<p>库存单位：{{ item.uom }}（只读）</p>
		<p v-for="row in item.alternateUnits" :key="row.uom">
			1 {{ row.uom }} = {{ row.factor }} {{ item.uom }}
		</p>
		<UiButton v-if="item.canEdit" :disabled="disabled" @click="edit">编辑常用换算</UiButton>
		<component
			:is="inline ? 'section' : Overlay"
			v-if="line"
			:title="`${item.name} · 常用换算`"
			drawer
			@close="close"
		>
			<div :inert="discard || undefined">
				<ConversionEditor
					:item="item"
					@item-updated="emit('updated', $event)"
					:line="line"
					:disabled="disabled"
					reusable-only
					@dirty-change="dirty = $event"
					@applied="
						line = undefined;
						dirty = false;
					"
				/>
			</div>
			<div v-if="discard" ref="discardPanel" role="alert" tabindex="-1">
				<p>放弃尚未保存的常用换算？已创建的单位会保留。</p>
				<UiButton @click="discard = false">继续编辑</UiButton>
				<UiButton
					@click="
						line = undefined;
						dirty = false;
					"
					>放弃并关闭</UiButton
				>
			</div>
			<UiButton v-if="inline" @click="close">关闭换算</UiButton>
			<template #footer><UiButton @click="close">关闭换算</UiButton></template>
		</component>
	</DisclosureSection>
</template>
