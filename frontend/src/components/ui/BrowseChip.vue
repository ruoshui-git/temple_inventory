<script setup lang="ts">
import InventoryIcon from "../InventoryIcon.vue";
withDefaults(defineProps<{ label: string; removable?: boolean; icon?: string }>(), {
	removable: true,
});
const emit = defineEmits<{ edit: []; remove: [] }>();
</script>

<template>
	<span class="browse-active-chip">
		<button type="button" class="browse-active-chip-label" @click="emit('edit')">
			<InventoryIcon v-if="icon" :name="icon" />
			{{ label }}
		</button>
		<button
			v-if="removable !== false"
			type="button"
			class="browse-active-chip-remove"
			:aria-label="`移除${label}`"
			@click.stop="emit('remove')"
		>
			<span aria-hidden="true">×</span>
		</button>
	</span>
</template>
