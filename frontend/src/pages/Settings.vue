<script setup lang="ts">
import { onMounted, ref } from "vue";
import UiButton from "../components/UiButton.vue";
import { refreshSession, saveUiPreferences } from "../lib/api";
import {
	density,
	preferenceError,
	preferenceSaveState,
	preferenceUser,
	configureDensitySave,
	densitySaveQueue,
	type Density,
} from "../lib/uiPreferences";

const refreshError = ref("");
const densityOptions: { value: Density; title: string; detail: string }[] = [
	{ value: "compact", title: "紧凑", detail: "内容更集中，适合较大的屏幕。" },
	{ value: "balanced", title: "均衡", detail: "文字与留白保持日常使用的平衡。" },
	{ value: "spacious", title: "宽松", detail: "文字更大、间距更宽，便于阅读。" },
];
configureDensitySave(saveUiPreferences);

async function refreshPreferences() {
	refreshError.value = "";
	try {
		await refreshSession();
	} catch (error) {
		refreshError.value = error instanceof Error ? error.message : "读取设置失败";
	}
}

onMounted(() => void refreshPreferences());
</script>

<template>
	<main class="app-shell preferences-page">
		<header class="preferences-heading">
			<div>
				<p class="eyebrow">更多选项</p>
				<h1>显示设置</h1>
			</div>
			<RouterLink to="/more">返回更多</RouterLink>
		</header>
		<p class="muted">设置会保存到当前账户；其他设备下次打开时采用此设置。</p>
		<p v-if="preferenceUser" class="preferences-account">当前账户：{{ preferenceUser }}</p>

		<section class="preferences-density" aria-labelledby="density-heading">
			<div class="preferences-section-heading">
				<div>
					<h2 id="density-heading">显示密度</h2>
					<p class="muted">在紧凑、均衡和宽松之间选择。</p>
				</div>
				<p class="preferences-save-state" role="status" aria-live="polite">
					<span v-if="preferenceSaveState === 'saving'">正在保存…</span>
					<span v-else-if="preferenceSaveState === 'error'" class="text-danger"
						>保存失败</span
					>
					<span v-else>已保存</span>
				</p>
			</div>

			<fieldset class="preferences-options">
				<legend class="sr-only">显示密度</legend>
				<label
					v-for="option in densityOptions"
					:key="option.value"
					class="preferences-option"
					:class="{ selected: density === option.value }"
				>
					<input
						type="radio"
						name="density"
						:value="option.value"
						:checked="density === option.value"
						@change="densitySaveQueue.enqueue(option.value)"
					/>
					<span>
						<strong>{{ option.title }}</strong>
						<small>{{ option.detail }}</small>
					</span>
				</label>
			</fieldset>
			<div class="density-example" aria-label="密度预览">
				<span>物资名称</span>
				<strong>东北珍珠米</strong>
				<small>库存位置 · 斋堂 / A-01</small>
				<UiButton variant="secondary" disabled>预览按钮</UiButton>
			</div>
			<div v-if="preferenceSaveState === 'error'" class="preferences-error" role="alert">
				<p>{{ preferenceError || "设置未保存，当前选择仅在本次会话生效。" }}</p>
				<UiButton variant="secondary" @click="densitySaveQueue.retry()">重试保存</UiButton>
			</div>
			<p v-if="refreshError" class="preferences-error" role="alert">
				{{ refreshError }}。当前显示设置保持不变。
				<UiButton variant="secondary" @click="refreshPreferences">重新读取</UiButton>
			</p>
		</section>
	</main>
</template>

<style scoped>
.preferences-page {
	max-width: 760px;
}

.preferences-heading,
.preferences-section-heading {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: var(--ti-density-row-gap);
}

.preferences-heading {
	margin-bottom: var(--ti-space-3);
}

.preferences-heading h1,
.preferences-section-heading h2 {
	margin: 0;
}

.preferences-density {
	margin-top: var(--ti-density-gap);
	padding: var(--ti-density-page);
	border: 1px solid var(--ti-border);
	border-radius: var(--ti-radius-card);
	background: var(--ti-surface);
	box-shadow: var(--ti-shadow-card);
}

.preferences-section-heading p {
	margin-top: var(--ti-space-1);
}

.preferences-save-state {
	flex: none;
	color: var(--ti-muted);
}

.preferences-options {
	display: grid;
	gap: var(--ti-density-row-gap);
	margin-top: var(--ti-density-gap);
}

.preferences-option {
	display: flex;
	align-items: center;
	gap: var(--ti-space-3);
	min-height: var(--ti-density-control);
	padding: var(--ti-density-control-pad-y) var(--ti-density-control-pad-x);
	border: 1px solid var(--ti-border);
	border-radius: var(--ti-radius-control);
	cursor: pointer;
}

.preferences-option.selected {
	border-color: var(--ti-accent);
	background: var(--ti-accent-soft);
}

.preferences-option input {
	width: 18px;
	height: 18px;
	accent-color: var(--ti-accent);
}

.preferences-option span {
	display: grid;
	gap: var(--ti-space-1);
}

.preferences-option small,
.preferences-account {
	color: var(--ti-muted);
}

.density-example {
	display: grid;
	justify-items: start;
	gap: var(--ti-density-row-gap);
	margin-top: var(--ti-density-gap);
	padding: var(--ti-density-page);
	border: 1px dashed var(--ti-border-strong);
	border-radius: var(--ti-radius-control);
	background: var(--ti-canvas);
}

.density-example > span {
	color: var(--ti-muted);
	font-size: var(--ti-font-small);
}

.density-example > strong {
	font-size: var(--ti-font-body);
}

.density-example > small {
	color: var(--ti-muted);
}

.preferences-error {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: var(--ti-space-3);
	margin-top: var(--ti-space-4);
	color: var(--ti-danger);
}

@media (max-width: 600px) {
	.preferences-density {
		padding: var(--ti-density-page);
	}

	.preferences-section-heading,
	.preferences-error {
		align-items: flex-start;
		flex-direction: column;
	}
}
</style>
