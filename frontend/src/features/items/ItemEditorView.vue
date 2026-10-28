<script setup lang="ts">
import PageHeader from "../../components/ui/PageHeader.vue";
import { ref } from "vue";
import ItemConversions from "./ItemConversions.vue";
import ItemFields from "./ItemFields.vue";
import Attachments from "../../components/Attachments.vue";
import UiButton from "../../components/ui/UiButton.vue";
import SkeletonBlock from "../../components/ui/SkeletonBlock.vue";
import RecoverySummary from "../../components/ui/RecoverySummary.vue";
import { useConfirm } from "../../services/confirm";
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
} = props.controller;
const conversionDirty = ref(false);
const itemFields = ref<InstanceType<typeof ItemFields>>();
const { confirm } = useConfirm();
async function cancel() {
	if (
		!dirty.value ||
		(await confirm({ title: "取消编辑？", message: "未保存的物品输入将丢失。" }))
	) {
		props.controller.discard();
		emit("cancel");
	}
}
function submit() {
	if (!itemFields.value?.validate().ok) return;
	void save();
}
</script>
<template>
	<section class="form-page">
		<PageHeader v-if="!contextual" class="form-page-heading"
			><h1 tabindex="-1">{{ existing ? "编辑物品" : "新建物品" }}</h1></PageHeader
		>
		<SkeletonBlock v-if="loading && existing" variant="detail" :count="3" :rows="4" />
		<p v-if="error" role="alert">{{ error }}</p>
		<p v-if="recoveryError" role="alert">{{ recoveryError }}</p>
		<form class="surface form-section" novalidate @submit.prevent="submit">
			<section class="item-main-image">
				<h3>主图</h3>
				<Attachments
					:controller="files"
					images-only
					image-role="main"
					:disabled="!canWrite || busy || conflict"
				/>
			</section>
			<dl v-if="!canWrite && !loading" class="info-grid">
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
					<dd class="content-long-text">{{ value || "未填写" }}</dd>
				</div>
			</dl>
			<fieldset v-else :disabled="loading || busy || conflict" class="item-fields">
				<ItemFields
					ref="itemFields"
					:model="model"
					:editing="!!existing"
					:disabled="loading || busy || conflict || !canWrite"
					:suggested-code="controller.suggestedCode.value"
					:tracking-changeable="existing?.tracking_changeable"
					:tracking-change-reason="existing?.tracking_change_reason"
				/>
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
			<div v-if="!contextual" class="form-actions">
				<UiButton @click="cancel">取消编辑</UiButton
				><UiButton
					v-if="canWrite"
					variant="primary"
					type="submit"
					:loading="busy"
					:disabled="loading || busy || conflict || conversionDirty"
					>{{ contextual ? "创建并使用物品" : "保存物品" }}</UiButton
				>
			</div>
		</form>
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
