<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import DisplaySettingsPage from "../features/settings/DisplaySettingsPage.vue";
import MorePage from "../features/more/MorePage.vue";
import type { MoreHost } from "../features/more/useMoreController";
import type { InstallPlatform } from "../lib/installGuidance";
import { fixtureDisplayScenario } from "./fixtureDisplaySettings";
import { provideGalleryReference } from "./fixtureReference";
import PreviewSetupWorkspace from "./components/PreviewSetupWorkspace.vue";
import InventoryIcon from "../components/InventoryIcon.vue";
import PreviewUiButton from "../components/ui/UiButton.vue";
import { previewPages, reviewSession } from "./reviewModel";
provideGalleryReference();
const props = withDefaults(defineProps<{ page: string; variant: string; active?: boolean }>(), {
	active: true,
});
const emit = defineEmits<{
	navigate: [page: string, variant: string];
	notify: [message: string];
}>();
const installPlatform = ref<InstallPlatform>("ios");
const host: MoreHost = {
	platform: () => installPlatform.value,
	standalone: () => false,
	install: async () => false,
	logout: async () => undefined,
	afterLogout: () => emit("navigate", "recovery", "session"),
};
function navigateMore(path: string) {
	if (path === "/reconcile/new") reviewSession.selectedDraftName = "";
	const routes: Record<string, [string, string]> = {
		"/activities": ["activity-list", "active"],
		"/reconcile/new": ["reconciliation-form", "new"],
		"/drafts": ["drafts", "open"],
		"/counts": ["counts", "records"],
		"/settings": ["settings", "density"],
		"/setup": ["setup", "warehouse"],
	};
	const target = routes[path];
	if (target) emit("navigate", ...target);
}
const state = reactive({ recovery: "expired" as "idle" | "expired" | "restored" });
watch(
	() => props.variant,
	(value) => (state.recovery = value === "restored" ? "restored" : "expired"),
	{ immediate: true },
);
const title = computed(
	() =>
		({
			setup: "配置检查 · 预览",
			recovery: "会话恢复 · 预览",
			"auth-complete": "身份验证完成 · 预览",
		})[props.page] || "更多工具",
);
function navigateByKey(key: string) {
	const target = previewPages.find((route) => route.key === key);
	if (target) emit("navigate", target.page, target.variant);
}
function recoverSession() {
	if (state.recovery === "restored" || props.page === "auth-complete") {
		emit("navigate", "drafts", "open");
		return;
	}
	state.recovery = "restored";
	emit("notify", "示例会话已恢复，草稿输入仍保留");
}
</script>

<template>
	<template v-if="page === 'settings'">
		<details class="preview-state-controls">
			<summary>图库账户保存状态</summary>
			<label class="preview-choice-label"
				><input
					v-model="fixtureDisplayScenario.failSave"
					type="checkbox"
				/>下次保存失败</label
			><label class="preview-choice-label"
				><input v-model="fixtureDisplayScenario.failRead" type="checkbox" />读取失败</label
			>
		</details>
		<DisplaySettingsPage @back="emit('navigate', 'more', 'index')" />
	</template>
	<template v-else-if="page === 'more'">
		<details class="preview-state-controls">
			<summary>图库设备类型</summary>
			<label class="preview-field"
				>设备<select v-model="installPlatform">
					<option value="ios">iPhone / iPad Safari</option>
					<option value="android">Android</option>
					<option value="other">电脑 / 其它浏览器</option>
				</select></label
			>
		</details>
		<MorePage :host="host" :active="active" @navigate="navigateMore" />
	</template>
	<PreviewSetupWorkspace v-else-if="page === 'setup'" />
	<section v-else class="preview-utility-page">
		<header class="utility-heading">
			<div>
				<span class="eyebrow">UTILITY WORKFLOW · PREVIEW</span>
				<h1>{{ title }}</h1>
				<p class="muted">功能与反馈均为可交互样本，不连接账户设置或服务端。</p>
			</div>
			<span class="utility-sample-tag">预览样本</span>
		</header>
		<template v-if="page === 'recovery' || page === 'auth-complete'"
			><section class="surface utility-panel recovery-panel">
				<span class="recovery-mark"
					><InventoryIcon
						:name="
							state.recovery === 'restored' || page === 'auth-complete'
								? 'check'
								: 'notice'
						"
				/></span>
				<h2>
					{{
						state.recovery === "restored" || page === "auth-complete"
							? "已恢复到预览会话"
							: "登录状态已过期"
					}}
				</h2>
				<p>输入的表单与草稿保留在本次预览会话中；恢复过程使用模拟反馈。</p>
				<div v-if="state.recovery === 'expired'" class="utility-error" role="alert">
					网络恢复后可以继续，不需要重新录入。
				</div>
				<PreviewUiButton variant="primary" @click="recoverSession">{{
					state.recovery === "restored" || page === "auth-complete"
						? "返回刚才的工作"
						: "模拟验证并继续"
				}}</PreviewUiButton
				><button class="utility-link" @click="navigateByKey('drafts/open')">
					查看保留的草稿样本
				</button>
			</section></template
		>
	</section>
</template>
