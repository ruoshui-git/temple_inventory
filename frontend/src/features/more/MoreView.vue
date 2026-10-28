<script setup lang="ts">
import PageHeader from "../../components/ui/PageHeader.vue";
import type { MoreController } from "./useMoreController";
import UiButton from "../../components/ui/UiButton.vue";
import Overlay from "../../components/ui/Overlay.vue";
import InventoryIcon from "../../components/InventoryIcon.vue";
import type { AppRouteTarget } from "../../lib/routeRegistry";
import { routeTarget } from "../../lib/routeRegistry";
import { computed } from "vue";
const props = defineProps<{ controller: MoreController }>();
const emit = defineEmits<{ navigate: [route: AppRouteTarget] }>();
const c = props.controller,
	{
		installOpen,
		installBusy,
		logoutOpen,
		busy,
		error,
		summaryError,
		loading,
		draftCount,
		guidance,
		canInstall,
	} = c;
const displayGroups = computed(() =>
	c.groups.map((group) =>
		group.label === "管理与设置"
			? {
					...group,
					items: group.items.flatMap((item) =>
						item.key === "settings"
							? [
									item,
									{
										key: "notification-settings",
										label: "通知设置",
										route: routeTarget("notification-settings"),
										icon: "notice",
										description: "管理应用内通知与本设备推送",
									},
								]
							: [item],
					),
				}
			: group,
	),
);
</script>
<template>
	<section class="utility-page">
		<PageHeader><h1 tabindex="-1">更多</h1></PageHeader>
		<p v-if="summaryError" role="alert">
			{{ summaryError }}
			<UiButton :loading="loading" @click="c.load">重试读取草稿数量</UiButton>
		</p>
		<p v-if="error && !logoutOpen && !installOpen" role="alert">{{ error }}</p>
		<section v-for="group in displayGroups" :key="group.label" class="more-section">
			<h2>{{ group.label }}</h2>
			<div class="more-grid">
				<button
					v-for="item in group.items"
					:key="item.key"
					class="more-card surface"
					@click="emit('navigate', item.route)"
				>
					<span><InventoryIcon :name="item.icon" /></span
					><strong
						>{{ item.label
						}}<span
							v-if="item.key === 'drafts' && draftCount !== undefined"
							class="count-dot"
							>{{ draftCount }}</span
						></strong
					><small>{{ item.description }}</small>
				</button>
			</div>
		</section>
		<section class="more-section">
			<h2>账户与设备</h2>
			<div class="more-grid">
				<button
					v-if="canInstall"
					type="button"
					class="more-card surface"
					:disabled="installBusy"
					:aria-busy="installBusy"
					@click="c.install"
				>
					<span><InventoryIcon :name="installBusy ? 'warning' : 'device'" /></span
					><strong>{{ installBusy ? "正在准备安装…" : "安装到手机 / 电脑" }}</strong
					><small>添加到主屏幕，方便下次打开</small>
				</button>
				<div class="more-card surface account-card">
					<strong>当前账户</strong>
					<p :title="c.reference.user">{{ c.reference.user }}</p>
					<UiButton variant="ghost" @click="logoutOpen = true">退出登录</UiButton>
				</div>
			</div>
		</section>
		<Overlay v-if="installOpen" title="安装到手机 / 电脑" @close="c.close"
			><p>{{ guidance }}</p>
			<p v-if="error" role="alert">{{ error }}</p>
			<template #footer><UiButton @click="c.close">知道了</UiButton></template></Overlay
		>
		<Overlay v-if="logoutOpen" title="退出登录" :dismissible="!busy" @close="c.close"
			><p>退出当前账户后，可重新登录继续工作。</p>
			<p v-if="error" role="alert">{{ error }}</p>
			<template #footer
				><UiButton :disabled="busy" @click="c.close">取消</UiButton
				><UiButton variant="danger" :loading="busy" @click="c.logout"
					>确认退出</UiButton
				></template
			></Overlay
		>
	</section>
</template>

<style scoped>
@media (max-width: 1023px) {
	.more-section {
		margin-block: 12px;
	}
	.more-section h2 {
		margin-block: 0 6px;
	}
	.more-grid {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: 0;
		border: 1px solid var(--p-border);
		border-radius: var(--p-radius-card);
		background: var(--p-surface);
		overflow: hidden;
	}
	.more-card {
		min-height: 64px !important;
		grid-template-columns: 36px minmax(0, 1fr) 16px;
		grid-template-rows: auto auto;
		align-content: center !important;
		align-items: center;
		column-gap: 10px;
		row-gap: 1px;
		padding: 8px 12px !important;
		border: 0 !important;
		border-radius: 0 !important;
		box-shadow: none !important;
		border-bottom: 1px solid var(--p-border) !important;
	}
	.more-card:last-child {
		border-bottom: 0 !important;
	}
	.more-card > span {
		grid-column: 1;
		grid-row: 1 / span 2;
		width: 36px !important;
		height: 36px !important;
	}
	.more-card > strong,
	.more-card > small {
		grid-column: 2;
		min-width: 0;
	}
	.more-card > strong {
		align-self: end;
		font-size: 0.95rem;
	}
	.more-card > small {
		align-self: start;
		font-size: 0.78rem;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.more-card:is(button)::after {
		grid-column: 3;
		grid-row: 1 / span 2;
		content: "›";
		justify-self: end;
		color: var(--p-muted);
		font-size: 1.3rem;
	}
	.account-card {
		grid-template-columns: minmax(0, 1fr) auto;
	}
	.account-card strong,
	.account-card p {
		grid-column: 1;
	}
	.account-card .ui-button {
		grid-column: 2;
		grid-row: 1 / span 2;
	}
}
</style>
