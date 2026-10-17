<script setup lang="ts">
import ItemImage from "../components/ItemImage.vue";
import PreviewProduct from "./PreviewProduct.vue";
import type { StockItem } from "./model";
defineProps<{ item: StockItem; interaction?: "detail" | "lightbox" }>();
const emit = defineEmits<{ detail: [] }>();
</script>
<template><ItemImage :item="item" :interaction="interaction" :has-artwork="item.illustration !== 'none'" @detail="emit('detail')"><template #artwork><PreviewProduct :kind="item.illustration" :name="item.name" /></template></ItemImage></template>
