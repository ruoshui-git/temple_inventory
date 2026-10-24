<script setup lang="ts">
import UiButton from "./UiButton.vue";
import InventoryIcon from "../InventoryIcon.vue";
import { ref } from "vue";
export type BrowseAction = { label: string; kind: string; icon?: string };
const props = defineProps<{ label: string; kind: string; icon: string; options: BrowseAction[] }>();
const emit = defineEmits<{ select: [kind: string] }>();
const open = ref(false);
const menu = ref<HTMLDetailsElement>();
function choose(kind: string) { open.value = false; if (menu.value) menu.value.open = false; emit("select", kind); }
function closeMenu(event: KeyboardEvent) {
	if (event.key !== "Escape" || !menu.value?.open) return;
	event.preventDefault();
	menu.value.open = false;
	menu.value.querySelector("summary")?.focus();
}
</script>

<template>
	<div class="browse-split-button">
		<UiButton variant="primary" :icon="icon" @click="choose(kind)">{{ label }}</UiButton>
		<details ref="menu" :open="open" @toggle="open = ($event.target as HTMLDetailsElement).open" @keydown="closeMenu">
			<summary aria-label="选择新建类型" title="选择新建类型"><InventoryIcon name="chevron-down" /></summary>
			<div class="browse-action-menu" role="menu" aria-label="新建类型">
				<button v-for="option in options" :key="option.kind" type="button" role="menuitem" @click="choose(option.kind)">
					<InventoryIcon v-if="option.icon" :name="option.icon" />{{ option.label }}
				</button>
			</div>
		</details>
	</div>
</template>
