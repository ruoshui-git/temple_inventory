<script setup lang="ts">
import { computed } from "vue";
import PreviewProduct from "./FixtureHostProduct.vue";
import { reviewSession } from "./reviewModel";
const props = defineProps<{ code: string }>();
const item = computed(() => reviewSession.stock.find((row) => row.code === props.code));
</script>
<template><PreviewProduct v-if="item" :kind="item.illustration" :name="item.name" /></template>
