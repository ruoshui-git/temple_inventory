<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { ConversionLine } from "../../lib/quantityConversion";
import type { StockItem } from "../../lib/stockPresentation";
import Overlay from "../../components/ui/Overlay.vue";
import UiButton from "../../components/ui/UiButton.vue";
import ConversionEditor from "../conversions/ConversionEditor.vue";
import DisclosureSection from "../../components/ui/DisclosureSection.vue";
import type { SavedItemConversions } from "../conversions/useConversionEditor";
import { useConfirm } from "../../services/confirm";
import { unitLabel } from "../../lib/units";
const props = defineProps<{ item: StockItem; disabled?: boolean; inline?: boolean }>();
const emit = defineEmits<{
	dirtyChange: [dirty: boolean];
	updated: [value: SavedItemConversions];
}>();
const item = computed(() => props.item);
const line = ref<ConversionLine>();
const dirty = ref(false);
const { confirm } = useConfirm();
watch(dirty, (value) => emit("dirtyChange", value), { flush: "sync" });
async function close() {
	if (
		dirty.value &&
		!(await confirm({ title: "放弃换算？", message: "尚未保存的常用换算将丢失。" }))
	)
		return;
	line.value = undefined;
	dirty.value = false;
}
function edit() {
	if (!item.value || props.disabled) return;
	dirty.value = false;
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
		<p>库存单位：{{ unitLabel(item.uom) }}（只读）</p>
		<p v-for="row in item.alternateUnits" :key="row.uom">
			1 {{ unitLabel(row.uom) }} = {{ row.factor }} {{ unitLabel(item.uom) }}
		</p>
		<UiButton :disabled="disabled" @click="edit">编辑常用换算</UiButton>
		<Overlay v-if="line" :title="`${item.name} · 常用换算`" @close="close">
			<div>
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
			<template #footer><UiButton @click="close">关闭换算</UiButton></template>
		</Overlay>
	</DisclosureSection>
</template>
