<script setup lang="ts">
import { watch } from "vue";
import PageHeader from "../../components/ui/PageHeader.vue";
import InventoryIcon from "../../components/InventoryIcon.vue";
import UiButton from "../../components/ui/UiButton.vue";
import SkeletonBlock from "../../components/ui/SkeletonBlock.vue";
import NotificationRows from "./NotificationRows.vue";
import { useNotifications } from "./useNotifications";
const c = useNotifications(20, true);
watch(c.unreadOnly, () => void c.refresh());
</script>
<template>
	<section class="preview-utility-page notification-page">
		<PageHeader
			><h1 tabindex="-1">通知</h1>
			<template #actions
				><UiButton :disabled="!c.unreadCount.value" @click="c.markAllRead"
					>全部已读</UiButton
				></template
			></PageHeader
		>
		<div class="notification-page-toolbar" role="group" aria-label="通知筛选">
			<button :aria-pressed="!c.unreadOnly.value" @click="c.unreadOnly.value = false">
				全部
			</button>
			<button :aria-pressed="c.unreadOnly.value" @click="c.unreadOnly.value = true">
				未读
			</button>
		</div>
		<p v-if="c.error.value" role="alert">
			{{ c.error.value }} <UiButton @click="c.refresh">重试</UiButton>
		</p>
		<SkeletonBlock v-if="c.loading.value && !c.initialized.value" variant="lines" :count="6" />
		<div v-else-if="c.rows.value.length" class="surface notification-page-list">
			<NotificationRows :rows="c.rows.value" :mark-read="c.markRead" />
			<UiButton v-if="c.hasMore.value" :loading="c.loadingMore.value" @click="c.loadMore"
				>加载更多</UiButton
			>
		</div>
		<div v-else-if="c.initialized.value" class="surface notification-empty">
			<InventoryIcon name="notice" /><strong>暂无通知</strong>
		</div>
	</section>
</template>
