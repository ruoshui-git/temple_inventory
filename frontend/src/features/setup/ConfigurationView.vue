<script setup lang="ts">
import PageHeader from "../../components/ui/PageHeader.vue";
import { computed, watch } from "vue";
import type { useConfiguration } from "./useConfiguration";
import UiButton from "../../components/ui/UiButton.vue";
import SkeletonBlock from "../../components/ui/SkeletonBlock.vue";
import SearchSelect from "../../components/ui/SearchSelect.vue";
import Overlay from "../../components/ui/Overlay.vue";
import DisclosureSection from "../../components/ui/DisclosureSection.vue";
import FormField from "../../components/ui/FormField.vue";
const props = defineProps<{ controller: ReturnType<typeof useConfiguration> }>();
const c = props.controller;
const {
	status,
	loading,
	busy,
	error,
	company,
	field,
	warehouse,
	preview,
	confirmed,
	initializeOpen,
	message,
	options,
} = c;
const locationLabel = (name: string) =>
	name ? status.value?.candidates?.find((row) => row.value === name)?.label || name : "尚未配置";
watch([field, warehouse], () => c.clearPreview());
</script>
<template>
	<section class="preview-utility-page">
		<PageHeader
			><div>
				<h1 tabindex="-1">配置与恢复</h1>
				<p class="muted">检查公司、仓库范围与实际存放库位。</p>
			</div>
			<template #actions
				><UiButton
					:loading="loading"
					loading-label="正在重新检查…"
					:disabled="busy"
					@click="c.load"
					>重新检查</UiButton
				></template
			></PageHeader
		>
		<SkeletonBlock v-if="loading && !status" variant="detail" :count="3" :rows="3" />
		<p v-if="loading" class="muted" role="status">正在检查配置…</p>
		<p v-if="error" class="utility-error" role="alert">{{ error }}</p>
		<p v-if="message" role="status">{{ message }}</p>
		<template v-if="status">
			<section class="surface utility-panel">
				<h2>{{ status.ready ? "配置有效" : "需要核对配置" }}</h2>
				<p>
					当前账户：{{ c.reference.user }} · 公司：{{
						status.selected_company || "尚未选择"
					}}
				</p>
				<ul v-if="status.blockers.length">
					<li v-for="issue in status.blockers" :key="issue.code">{{ issue.message }}</li>
				</ul>
				<ul v-if="status.warnings.length">
					<li v-for="issue in status.warnings" :key="issue.code">{{ issue.message }}</li>
				</ul>
				<p v-if="status.blockers.some((issue) => issue.code.endsWith(':inaccessible'))">
					已存在但无权读取的仓库须先处理授权，不能重新创建。配置变更后请重新检查库存页面。
				</p>
			</section>
			<section v-if="status.can_initialize" class="surface utility-panel">
				<h2>建立必需仓库</h2>
				<FormField
					for="configuration-company"
					class="preview-field"
					label="公司"
					required
					:error="c.validation.errors['configuration-company']"
					><template #default="{ fieldAttrs }"
						><select v-model="company" v-bind="fieldAttrs" :disabled="busy">
							<option value="">请选择</option>
							<option v-for="value in status.companies" :key="value" :value="value">
								{{ value }}
							</option>
						</select></template
					></FormField
				>
				<p>建立实体、借出与损坏存放结构。普通初始化只建立仓库，不导入示例物品或库存。</p>
				<UiButton
					variant="primary"
					:disabled="!company || busy"
					@click="initializeOpen = true"
					>查看初始化结构</UiButton
				>
			</section>
			<section class="surface utility-panel">
				<h2>当前仓库引用</h2>
				<dl class="configuration-pointers">
					<template v-for="pointer in status.pointers" :key="pointer.field"
						><dt>{{ pointer.label }}</dt>
						<dd>
							{{ locationLabel(pointer.current)
							}}<small v-if="pointer.current" class="muted"
								>ERPNext 名称：{{ pointer.current }}</small
							>
						</dd></template
					>
				</dl>
			</section>
			<section v-if="status.selected_company" class="surface utility-panel">
				<h2>修复配置引用</h2>
				<p>
					选择当前可读取的仓库，查看替代范围与影响后再确认。修改引用不会移动库存或调整仓库上级。
				</p>
				<label class="preview-field"
					>配置项<select v-model="field" :disabled="busy">
						<option
							v-for="pointer in status.pointers"
							:key="pointer.field"
							:value="pointer.field"
						>
							{{ pointer.label }}
						</option>
					</select></label
				>
				<FormField
					label="替代仓库"
					required
					:error="c.validation.errors['configuration-warehouse']"
					><template #default="{ fieldAttrs }"
						><SearchSelect
							v-model="warehouse"
							label="替代仓库"
							external-label
							:options="options"
							:disabled="busy"
							v-bind="fieldAttrs" /></template
				></FormField>
				<p v-if="c.reviewing.value" class="muted" role="status">正在查看修复影响…</p>
				<UiButton
					:disabled="!warehouse || busy"
					:loading="c.reviewing.value"
					loading-label="正在查看修复影响…"
					@click="c.review"
					>查看修复影响</UiButton
				>
				<section v-if="preview" class="configuration-impact">
					<h3>{{ preview.label }}</h3>
					<p>当前引用：{{ locationLabel(preview.current) }}</p>
					<p>替代节点：{{ locationLabel(preview.replacement) }}</p>
					<p>
						可读取范围：{{ preview.visible_nodes }} 个节点，{{
							preview.visible_leaves
						}}
						个叶子库位。
					</p>
					<p>{{ preview.impact }}</p>
					<DisclosureSection
						title="同时核对其它配置引用"
						:count="preview.affected_references.length"
					>
						<p v-for="other in preview.affected_references" :key="other.field">
							{{
								status.pointers.find((pointer) => pointer.field === other.field)
									?.label
							}}：{{ locationLabel(other.warehouse) }}
						</p>
					</DisclosureSection>
					<label class="preview-choice-label"
						><input
							v-model="confirmed"
							type="checkbox"
							:disabled="busy"
						/>已核对当前引用、替代节点与影响，确认修改此配置引用</label
					>
					<UiButton
						variant="primary"
						:disabled="!confirmed"
						:loading="busy"
						loading-label="正在应用修复…"
						@click="c.apply()"
						>{{ busy ? "正在应用…" : "应用修复" }}</UiButton
					><UiButton :disabled="busy" @click="c.clearPreview">取消修复</UiButton>
				</section>
			</section>
		</template>
		<p>
			<a href="/app/warehouse" target="_blank" rel="noopener">打开 ERPNext 仓库</a> ·
			<a href="/app/company" target="_blank" rel="noopener">打开 ERPNext 公司</a> ·
			<a href="/app/temple-inventory-settings" target="_blank" rel="noopener"
				>打开库存设置</a
			>
		</p>
		<Overlay
			v-if="initializeOpen"
			title="确认建立必需仓库"
			:dismissible="!busy"
			@close="!busy && (initializeOpen = false)"
			><p>公司：{{ company }}</p>
			<ul>
				<li>总仓库 → 实体库房 → 通用库房（Room，叶子）</li>
				<li>总仓库 → 借出（叶子）</li>
				<li>总仓库 → 损坏待处理（叶子）</li>
			</ul>
			<p>此次操作不创建库存数量。</p>
			<p v-if="error" role="alert">{{ error }}</p>
			<template #footer
				><UiButton :disabled="busy" @click="initializeOpen = false">取消</UiButton
				><UiButton
					variant="primary"
					:loading="busy"
					loading-label="正在初始化…"
					@click="c.apply(true)"
					>{{ busy ? "正在建立…" : "确认初始化" }}</UiButton
				></template
			></Overlay
		>
	</section>
</template>
<style scoped>
.configuration-pointers {
	display: grid;
	grid-template-columns: minmax(120px, 1fr) minmax(0, 2fr);
	gap: 12px;
}
.configuration-pointers dd {
	margin: 0;
	overflow-wrap: anywhere;
}
.configuration-pointers small {
	display: block;
}
.configuration-impact {
	margin-block: 20px;
	padding-block: 16px;
	border-block: 1px solid var(--p-border);
}
@media (pointer: coarse) {
	.configuration-impact :deep(.preview-choice-label) {
		min-height: 44px;
	}
}
@media (max-width: 600px) {
	.configuration-pointers {
		grid-template-columns: 1fr;
		gap: 6px;
	}
	.configuration-pointers dd {
		margin-bottom: 12px;
	}
}
</style>
