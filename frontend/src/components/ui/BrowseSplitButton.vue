<script setup lang="ts">
import UiButton from "./UiButton.vue";
import InventoryIcon from "../InventoryIcon.vue";
import PopupMenu from "./PopupMenu.vue";

export type BrowseAction = { label: string; kind: string; icon?: string };
const props = defineProps<{
	label: string;
	kind: string;
	icon: string;
	options: BrowseAction[];
}>();
const emit = defineEmits<{ select: [kind: string] }>();
function choose(kind: string) {
	emit("select", kind);
}
</script>

<template>
	<div class="browse-split-button">
		<UiButton variant="primary" :icon="icon" @click="choose(kind)">{{ label }}</UiButton>
		<PopupMenu label="选择新建类型" variant="split" align="end">
			<button
				v-for="option in props.options"
				:key="option.kind"
				type="button"
				role="menuitem"
				@click="choose(option.kind)"
			>
				<InventoryIcon v-if="option.icon" :name="option.icon" />{{ option.label }}
			</button>
		</PopupMenu>
	</div>
</template>
