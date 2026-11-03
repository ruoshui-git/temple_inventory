<script setup lang="ts">
import { ref } from "vue";
import PopupMenu from "./PopupMenu.vue";

// Pages that open a panel from a menu item anchor it to this menu's "…" trigger.
const menu = ref<InstanceType<typeof PopupMenu>>();
defineExpose({ trigger: () => menu.value?.anchor });
</script>

<template>
	<PopupMenu ref="menu" label="更多操作" variant="icon" align="end" sheet><slot /></PopupMenu>
</template>
