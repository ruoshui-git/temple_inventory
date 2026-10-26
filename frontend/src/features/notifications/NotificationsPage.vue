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
			></PageHeader
		>
		<div class="notification-page-toolbar" role="group" aria-label="通知筛选">
			<button :aria-pressed="!c.unreadOnly.value" @click="c.unreadOnly.value = false">
				全部
			</button>
			<button :aria-pressed="c.unreadOnly.value" @click="c.unreadOnly.value = true">
				未读
			</button>
			<UiButton
				class="notification-mark-all"
				size="compact"
				:disabled="!c.unreadCount.value"
				@click="c.markAllRead"
				>全部已读</UiButton
			>
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

<style scoped>
@media (max-width: 1023px) {
	.notification-page :deep(.app-page-header) {
		margin-bottom: 8px;
	}
	.notification-page-toolbar {
		width: 100%;
		display: flex;
		align-items: center;
		margin-bottom: 8px;
	}
	.notification-page-toolbar .notification-mark-all {
		margin-inline-start: auto;
		min-height: 34px;
		padding-inline: 10px;
	}
	.notification-page-list {
		padding-inline: 10px;
	}
	.notification-page-list :deep(.notification-rows li.is-export) {
		grid-template-columns: 30px minmax(0, 1fr) 8px auto;
	}
	.notification-page-list :deep(.notification-rows li.is-export .notification-subject) {
		word-break: normal;
		overflow-wrap: break-word;
		font-size: 0.9rem;
	}
	.notification-page-list :deep(.notification-rows li.is-export .ui-button) {
		min-height: 32px;
		padding-inline: 7px;
		font-size: 0.78rem;
	}
}
</style>
