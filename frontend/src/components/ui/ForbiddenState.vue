<script setup lang="ts">
import UiButton from "./UiButton.vue";
import BrowseEmpty from "./BrowseEmpty.vue";
defineProps<{ message?: string }>();
const emit = defineEmits<{ back: [] }>();
</script>
<template>
	<section class="surface form-section" data-testid="forbidden-state">
		<BrowseEmpty :text="message || '没有此操作的权限'">
			<p>需要其他权限时请联系管理员。</p>
			<UiButton @click="emit('back')">返回首页</UiButton>
		</BrowseEmpty>
	</section>
</template>
