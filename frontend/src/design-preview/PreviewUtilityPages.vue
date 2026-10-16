<script setup lang="ts">
import PreviewSetupWorkspace from "./components/PreviewSetupWorkspace.vue";
import { computed, reactive, ref, watch, onActivated, onDeactivated } from "vue";
import InventoryIcon from "../components/InventoryIcon.vue";
import PreviewUiButton from "./components/PreviewUiButton.vue";
import PreviewOverlay from "./PreviewOverlay.vue";
import { textScales, type TextScale } from "./model";
import { previewPages, reviewSession } from "./reviewModel";

import { moreNavigation } from "./navigation";

const props = withDefaults(
	defineProps<{
		page: string;
		variant: string;
		active?: boolean;
		textScale?: TextScale;
		density?: "compact" | "balanced" | "spacious";
	}>(),
	{
		active: true,
	},
);
const emit = defineEmits<{
	navigate: [page: string, variant: string];
	notify: [message: string];
	"update-text-scale": [scale: TextScale];
	"update-density": [density: "compact" | "balanced" | "spacious"];
}>();
const preferenceError = ref(false);
const preferencePending = ref(false);
const failPreference = ref(false);
const confirmedDensity = ref(props.density || "balanced");
const installPlatform = ref("ios");
const state = reactive({
	settingsDensity: props.density || "balanced",
	installOpen: false,
	logoutOpen: false,
	recovery: "idle" as "idle" | "expired" | "restored",
});
watch(
	() => props.active,
	(active) => {
		if (!active) {
			state.installOpen = false;
			state.logoutOpen = false;
		}
	},
);
onDeactivated(() => {
	state.installOpen = false;
	state.logoutOpen = false;
});
onActivated(() => {
	state.settingsDensity = props.density || "balanced";
});
watch(
	() => props.density,
	(density) => {
		if (density) state.settingsDensity = density;
	},
);
const title = computed(
	() =>
		({
			more: "更多",
			settings: "显示偏好 · 预览",
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
function updateDensity(density: "compact" | "balanced" | "spacious") {
	state.settingsDensity = density;
	document.documentElement.dataset.previewDensity = density;
	emit("update-density", density);
	preferencePending.value = true;
	preferenceError.value = failPreference.value;
	if (!preferenceError.value) {
		confirmedDensity.value = density;
		preferencePending.value = false;
	}
}
function retryPreference() {
	preferenceError.value = false;
	preferencePending.value = false;
	confirmedDensity.value = state.settingsDensity as "compact" | "balanced" | "spacious";
}
</script>

<template>
	<section class="preview-utility-page">
		<header class="utility-heading">
			<div>
				<span class="eyebrow">UTILITY WORKFLOW · PREVIEW</span>
				<h1>{{ title }}</h1>
				<p class="muted">功能与反馈均为可交互样本，不连接账户设置或服务端。</p>
			</div>
			<span class="utility-sample-tag">预览样本</span>
		</header>
		<template v-if="page === 'more'">
			<section v-for="group in moreNavigation" :key="group.label" class="more-section">
				<h2>{{ group.label }}</h2>
				<div class="more-grid">
					<button
						v-for="item in group.items"
						:key="item.key"
						class="more-card surface"
						@click="navigateByKey(item.route)"
					>
						<span><InventoryIcon :name="item.icon" /></span
						><strong
							>{{ item.label
							}}<span v-if="item.key === 'drafts'" class="count-dot">{{
								reviewSession.drafts.filter((draft) => draft.status === "draft")
									.length
							}}</span></strong
						>
						<small>{{ item.description }}</small>
					</button>
				</div>
			</section>
			<section class="more-section">
				<PreviewUiButton @click="emit('navigate', 'setup', 'default')"
					>配置与恢复</PreviewUiButton
				>
				<h2>账户与设备</h2>
				<div class="more-grid">
					<button class="more-card surface" @click="state.installOpen = true">
						<span><InventoryIcon name="download" /></span
						><strong>安装到手机 / 电脑</strong
						><small>添加到主屏幕，方便下次打开</small>
					</button>
					<div class="more-card surface">
						<strong>当前账户</strong>
						<p>System Manager · 示例账户</p>
						<PreviewUiButton variant="danger" @click="state.logoutOpen = true"
							>退出登录</PreviewUiButton
						>
					</div>
				</div>
			</section>
			<PreviewOverlay
				v-if="state.installOpen"
				title="安装到手机 / 电脑"
				@close="state.installOpen = false"
			>
				<p>
					手机浏览器：打开分享或浏览器菜单，选择「添加到主屏幕」。电脑浏览器：使用地址栏或菜单中的「安装应用」。
				</p>
				<label class="preview-field"
					>设备<select v-model="installPlatform">
						<option value="ios">iPhone / iPad Safari</option>
						<option value="chromium">Chrome / Edge</option>
						<option value="unsupported">其他浏览器</option>
					</select></label
				>
				<p>
					{{
						installPlatform === "ios"
							? "Safari → 分享 → 添加到主屏幕"
							: installPlatform === "chromium"
								? "浏览器菜单 → 安装应用；不可安装时可添加书签。"
								: "此浏览器不支持安装，可添加书签继续使用。"
					}}
				</p>
				<p class="muted">预览不注册服务工作线程。</p>
				<template #footer
					><PreviewUiButton @click="state.installOpen = false"
						>知道了</PreviewUiButton
					></template
				>
			</PreviewOverlay>
			<PreviewOverlay
				v-if="state.logoutOpen"
				title="退出登录"
				@close="state.logoutOpen = false"
			>
				<p>这是退出登录的交互样本，确认后保留本次预览中的输入和草稿。</p>
				<template #footer
					><PreviewUiButton @click="state.logoutOpen = false">取消</PreviewUiButton
					><PreviewUiButton
						variant="danger"
						@click="
							state.logoutOpen = false;
							emit('notify', '已模拟退出登录，预览数据仍保留');
						"
						>确认退出</PreviewUiButton
					></template
				>
			</PreviewOverlay>
		</template>
		<template v-else-if="page === 'settings'"
			><section class="surface utility-panel">
				<h2>文字大小</h2>
				<label class="preview-field"
					>文字大小<select
						aria-label="文字大小"
						:value="textScale || 100"
						@change="
							emit(
								'update-text-scale',
								Number(($event.target as HTMLSelectElement).value) as TextScale,
							)
						"
					>
						<option v-for="scale in textScales" :key="scale" :value="scale">
							{{ scale }}%
						</option>
					</select></label
				>
				<p>文字示例：核对物品、数量和库位后确认。</p>
				<PreviewUiButton @click="emit('update-text-scale', 100)">恢复默认</PreviewUiButton>
				<h2>显示密度</h2>
				<p v-if="preferenceError" role="alert">
					偏好保存失败，当前显示保留；确认的偏好仍为
					{{ confirmedDensity }}。<PreviewUiButton @click="retryPreference"
						>重试保存偏好</PreviewUiButton
					>
				</p>
				<p v-else-if="!preferencePending" role="status">
					预览偏好已确认：{{ confirmedDensity }}
				</p>
				<details>
					<summary>预览偏好状态</summary>
					<label class="preview-choice-label"
						><input v-model="failPreference" type="checkbox" />下次保存失败</label
					>
				</details>
				<p class="muted">此处只改变预览显示，不会保存到账户。</p>
				<div class="density-choice">
					<label
						class="preview-choice-label"
						v-for="option in [
							{ value: 'compact', label: '紧凑' },
							{ value: 'balanced', label: '均衡' },
							{ value: 'spacious', label: '宽松' },
						]"
						:key="option.value"
						><input
							type="radio"
							name="preview-density"
							:value="option.value"
							:checked="state.settingsDensity === option.value"
							@change="
								updateDensity(option.value as 'compact' | 'balanced' | 'spacious')
							"
						/><span>{{ option.label }}</span></label
					>
				</div>
				<PreviewUiButton
					variant="primary"
					@click="emit('notify', `预览密度：${state.settingsDensity}；不写入账户设置`)"
					>应用于此预览</PreviewUiButton
				>
			</section></template
		>
		<template v-else-if="page === 'setup'"><PreviewSetupWorkspace /></template>
		<template v-else-if="page === 'recovery' || page === 'auth-complete'"
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
