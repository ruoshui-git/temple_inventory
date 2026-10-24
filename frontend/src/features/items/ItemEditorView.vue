<script setup lang="ts">
import PageHeader from "../../components/ui/PageHeader.vue";
import { ref, watch } from "vue";
import ItemConversions from "./ItemConversions.vue";
import ItemFields from "./ItemFields.vue";
import Attachments from "../../components/Attachments.vue";
import UiButton from "../../components/ui/UiButton.vue";
import SkeletonBlock from "../../components/ui/SkeletonBlock.vue";
import RecoverySummary from "../../components/ui/RecoverySummary.vue";
import type { useItemEditor } from "./useItemEditor";
const props = defineProps<{
	controller: ReturnType<typeof useItemEditor>;
	contextual?: boolean;
}>();
const emit = defineEmits<{ cancel: [] }>();
const {
	model,
	existing,
	loading,
	busy,
	error,
	recoveryError,
	conflict,
	dirty,
	canWrite,
	load,
	save,
	files,
	recoveryText,
	discardOpen,
	discard,
} = props.controller;
const support = ref<HTMLElement>();
const categoryDirty = ref(false),
	unitDirty = ref(false),
	conversionDirty = ref(false);
watch(
	[categoryDirty, unitDirty, conversionDirty],
	() => {
		props.controller.supportingDirty.value =
			categoryDirty.value || unitDirty.value || conversionDirty.value;
	},
	{ flush: "sync" },
);
async function cancel() {
	if (await props.controller.requestLeave()) emit("cancel");
}
</script>
<template>
	<section class="preview-form-page">
		<PageHeader v-if="!contextual" class="form-page-heading"
			><h1 tabindex="-1">{{ existing ? "编辑物品" : "新建物品" }}</h1></PageHeader
		>
		<SkeletonBlock v-if="loading && existing" variant="detail" :count="3" :rows="4" />
		<p v-if="error" role="alert">{{ error }}</p>
		<p v-if="recoveryError" role="alert">{{ recoveryError }}</p>
		<form class="surface form-section" @submit.prevent="save">
			<section class="item-main-image">
				<h3>主图</h3>
				<Attachments
					:controller="files"
					images-only
					image-role="main"
					:disabled="!canWrite || busy || conflict"
				/>
			</section>
			<dl v-if="!canWrite && !loading" class="preview-info-grid">
				<div
					v-for="(value, label) in {
						物品编号: model.code,
						名称: model.name,
						分类: model.category,
						库存单位: model.uom,
						条码: model.barcode,
						说明: model.description,
						按批次管理: model.tracksBatch ? '是' : '否',
						记录效期: model.tracksExpiry ? '是' : '否',
					}"
					:key="label"
				>
					<dt>{{ label }}</dt>
					<dd class="preview-long-text">{{ value || "未填写" }}</dd>
				</div>
			</dl>
			<fieldset v-else :disabled="loading || busy || conflict" class="item-fields">
				<ItemFields
					:model="model"
					:editing="!!existing"
					:disabled="loading || busy || conflict || !canWrite"
					:editor-target="support"
					@supporting-dirty="
						(field, value) =>
							field === 'category' ? (categoryDirty = value) : (unitDirty = value)
					"
				/>
				<div ref="support" class="preview-supporting-editors" />
			</fieldset>
			<p v-if="!canWrite && !loading">没有编辑权限。当前资料可选中复制。</p>
			<ItemConversions
				v-if="controller.stockItem.value"
				:item="controller.stockItem.value"
				:disabled="!canWrite || busy || conflict"
				:inline="contextual"
				@dirty-change="conversionDirty = $event"
				@updated="controller.conversionsUpdated"
			/>
			<h3>附件</h3>
			<Attachments
				:controller="files"
				image-role="attachments"
				:disabled="!canWrite || busy || conflict"
			/>
			<div v-if="conflict">
				<p>物品已更改。当前输入已保留，重新读取会替换输入。</p>
				<RecoverySummary
					kind="Item"
					:values="model"
					:copy-text="recoveryText"
					:pending-upload-reselection="files.incomplete.value"
				/>
				<UiButton @click="load">重新读取物品</UiButton>
			</div>
			<div class="form-actions">
				<UiButton @click="cancel">取消编辑</UiButton
				><UiButton
					v-if="canWrite"
					variant="primary"
					type="submit"
					:loading="busy"
					:disabled="
						loading ||
						busy ||
						conflict ||
						categoryDirty ||
						unitDirty ||
						conversionDirty
					"
					>{{ contextual ? "创建并使用物品" : "保存物品" }}</UiButton
				>
			</div>
		</form>
		<section v-if="controller.leaveRequested.value" class="notice-bar" role="alert">
			<p>离开当前物品编辑？未完成输入仅能在此浏览器恢复，待上传文件需要重新选择。</p>
			<p v-if="controller.supportingDirty.value">
				请先完成或取消尚未保存的分类、单位与换算，才能保留输入离开。
			</p>
			<UiButton @click="controller.finishLeave('stay')">继续编辑</UiButton
			><UiButton
				:disabled="controller.supportingDirty.value"
				@click="controller.finishLeave('retain')"
				>保留输入并离开</UiButton
			><UiButton variant="danger" @click="controller.finishLeave('discard')"
				>放弃输入并离开</UiButton
			>
		</section>
		<div v-if="discardOpen" class="notice-bar" role="alert">
			<p>放弃当前未保存输入？已经创建的物品、分类和单位会保留。</p>
			<UiButton @click="discardOpen = false">继续编辑</UiButton
			><UiButton
				@click="
					discard();
					emit('cancel');
				"
				>放弃未保存输入</UiButton
			>
		</div>
	</section>
</template>
<style scoped>
.item-fields {
	border: 0;
	margin: 0;
	padding: 0;
	min-width: 0;
}
</style>
