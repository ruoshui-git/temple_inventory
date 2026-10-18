<script setup lang="ts">
import PageHeader from "../../components/ui/PageHeader.vue";
import type { DisplaySettings } from "./useDisplaySettings";
import { themes, textScales, type TextScale } from "../../lib/displayPreferences";
import UiButton from "../../components/ui/UiButton.vue";
const props = defineProps<{ controller: DisplaySettings }>();
const emit = defineEmits<{ back: [] }>();
const c = props.controller,
	{ theme, density, textScale, loading, error, saveError, saveState } = c;
const densities = [
	{ value: "compact", label: "紧凑" },
	{ value: "balanced", label: "均衡" },
	{ value: "spacious", label: "宽松" },
] as const;
</script>
<template>
	<section class="preview-utility-page">
		<PageHeader
			><div>
				<h1 tabindex="-1">显示设置</h1>
				<p class="muted">设置保存到当前账户；其它设备下次打开时采用此设置。</p>
			</div>
			<template #back
				><UiButton @click="emit('back')">返回更多</UiButton></template
			></PageHeader
		>
		<p class="muted">当前账户：{{ c.account }}</p>
		<p v-if="loading" role="status">正在读取账户设置…</p>
		<p v-if="error" role="alert">
			{{ error }} <UiButton @click="c.refresh">重新读取</UiButton>
		</p>
		<section class="surface utility-panel">
			<h2>主题</h2>
			<div class="theme-options">
				<button
					v-for="option in themes"
					:key="option.id"
					class="theme-option"
					:aria-pressed="theme === option.id"
					:style="{
						'--theme-canvas': option.canvas,
						'--theme-ink': option.ink,
						'--theme-accent': option.accent,
						'--theme-soft': option.soft,
					}"
					@click="c.change({ theme: option.id })"
				>
					<span
						class="theme-miniature"
						:style="{ background: option.canvas, '--mini-accent': option.accent }"
						><i /><span><b /><b /><b /></span></span
					><span
						><strong>{{ option.name }}</strong
						><small>{{ option.description }}</small></span
					>
				</button>
			</div>
			<h2>文字大小</h2>
			<label class="preview-field"
				>文字大小<select
					aria-label="文字大小"
					:value="textScale"
					@change="
						c.change({
							textScale: Number(
								($event.target as HTMLSelectElement).value,
							) as TextScale,
						})
					"
				>
					<option v-for="scale in textScales" :key="scale" :value="scale">
						{{ scale }}%
					</option>
				</select></label
			>
			<p>文字示例：核对物品、数量和库位后确认。</p>
			<UiButton @click="c.change({ textScale: 100 })">恢复默认文字</UiButton>
			<h2>显示密度</h2>
			<p class="muted">文字大小独立于间距和控件尺寸。</p>
			<div class="density-choice">
				<label v-for="option in densities" :key="option.value" class="preview-choice-label"
					><input
						type="radio"
						name="display-density"
						:value="option.value"
						:checked="density === option.value"
						@change="c.change({ density: option.value })"
					/>{{ option.label }}</label
				>
			</div>
			<p role="status" aria-live="polite">
				{{
					saveState === "saving"
						? "正在保存…"
						: saveState === "error"
							? "设置尚未保存"
							: "已保存"
				}}
			</p>
			<p v-if="saveError" role="alert">
				{{ saveError }} <UiButton @click="c.retry">重试保存偏好</UiButton>
			</p>
		</section>
	</section>
</template>
