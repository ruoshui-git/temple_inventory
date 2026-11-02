<script setup lang="ts">
import UiButton from "./UiButton.vue";

withDefaults(
	defineProps<{
		loadedCount: number;
		totalCount: number;
		hasMore: boolean;
		loading?: boolean;
		error?: string;
	}>(),
	{ loading: false, error: "" },
);
const emit = defineEmits<{ loadMore: []; retry: [] }>();
</script>

<template>
	<footer v-if="hasMore || error" class="browse-load-more">
		<p v-if="error" role="alert" class="browse-load-more-error">
			{{ error }} <UiButton @click="emit('retry')">重试加载</UiButton>
		</p>
		<UiButton v-else :loading="loading" @click="emit('loadMore')">
			加载更多 · {{ loadedCount }} / {{ totalCount }}
		</UiButton>
	</footer>
</template>
