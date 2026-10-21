<script setup lang="ts">
withDefaults(defineProps<{ label: string; removable?: boolean }>(), {
	removable: true,
});
const emit = defineEmits<{ edit: []; remove: [] }>();
</script>

<template>
	<span class="browse-active-chip">
		<button type="button" class="browse-active-chip-label" @click="emit('edit')">
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
