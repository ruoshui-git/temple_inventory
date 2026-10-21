<script setup lang="ts">
import MoreView from "./MoreView.vue";
import { useMoreController, type MoreHost } from "./useMoreController";
import type { AppRouteTarget } from "../../lib/routeRegistry";
const props = withDefaults(defineProps<{ host: MoreHost; active?: boolean }>(), { active: true });
const emit = defineEmits<{ navigate: [route: AppRouteTarget] }>();
const controller = useMoreController(props.host, () => props.active !== false);
defineExpose({ controller });
</script>
<template><MoreView :controller="controller" @navigate="emit('navigate', $event)" /></template>
