<script setup lang="ts">
import PageHeader from "../../components/ui/PageHeader.vue";
import type { MoreController } from "./useMoreController";
import UiButton from "../../components/ui/UiButton.vue";
import Overlay from "../../components/ui/Overlay.vue";
import InventoryIcon from "../../components/InventoryIcon.vue";
import type { AppRouteTarget } from "../../lib/routeRegistry";
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
</script>
<template>
	<section class="preview-utility-page">
		<PageHeader><h1 tabindex="-1">更多</h1></PageHeader>
		<p v-if="summaryError" role="alert">
			{{ summaryError }}
			<UiButton :loading="loading" @click="c.load">重试读取草稿数量</UiButton>
		</p>
		<p v-if="error && !logoutOpen && !installOpen" role="alert">{{ error }}</p>
		<section v-for="group in c.groups" :key="group.label" class="more-section">
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
				<UiButton
					v-if="canInstall"
					class="more-card surface"
					:loading="installBusy"
					loading-label="正在准备安装…"
					@click="c.install"
				>
					<span><InventoryIcon name="download" /></span><strong>安装到手机 / 电脑</strong
					><small>添加到主屏幕，方便下次打开</small>
				</UiButton>
				<div class="more-card surface">
					<strong>当前账户</strong>
					<p>{{ c.reference.user }}</p>
					<UiButton variant="danger" @click="logoutOpen = true">退出登录</UiButton>
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
