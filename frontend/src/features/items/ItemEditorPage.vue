<script setup lang="ts">
import ItemEditorView from "./ItemEditorView.vue";
import { useItemEditor } from "./useItemEditor";
import type { CatalogItem } from "../../lib/catalogPresentation";
const props = defineProps<{
	code?: string;
	barcode?: string;
	contextual?: boolean;
	recoveryId?: string;
}>();
const emit = defineEmits<{ saved: [item: CatalogItem]; cancel: [] }>();
const controller = useItemEditor(props, (item) => emit("saved", item));
defineExpose({ controller });
</script>
<template>
	<ItemEditorView :controller="controller" :contextual="contextual" @cancel="emit('cancel')" />
</template>
