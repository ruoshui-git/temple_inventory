<script setup lang="ts">
import { ref } from "vue";
import InventoryIcon from "../InventoryIcon.vue";
const open = ref(false);
const menu = ref<HTMLDetailsElement>();
function closeMenu(event: KeyboardEvent) {
	if (event.key !== "Escape" || !menu.value?.open) return;
	event.preventDefault();
	menu.value.open = false;
	menu.value.querySelector("summary")?.focus();
}
function closeAfterAction(event: MouseEvent) {
	if (!(event.target instanceof Element) || !event.target.closest("button, a")) return;
	open.value = false;
	if (menu.value) menu.value.open = false;
}
</script>

<template>
	<details ref="menu" class="browse-overflow-menu" :open="open" @toggle="open = ($event.target as HTMLDetailsElement).open" @keydown="closeMenu">
		<summary aria-label="更多操作" title="更多操作"><InventoryIcon name="more" /></summary>
		<div class="browse-action-menu" @click="closeAfterAction"><slot /></div>
	</details>
</template>
