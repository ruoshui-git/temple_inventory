<script setup lang="ts">
import DisclosureIcon from "../../components/ui/DisclosureIcon.vue";
import PageHeader from "../../components/ui/PageHeader.vue";
import UiButton from "../../components/ui/UiButton.vue";
import SkeletonBlock from "../../components/ui/SkeletonBlock.vue";
import AsyncRegion from "../../components/ui/AsyncRegion.vue";
import Overlay from "../../components/ui/Overlay.vue";
import CategoryFormFields from "./CategoryFormFields.vue";
import type { useCategoriesController } from "./useCategoriesController";
import PopupMenu from "../../components/ui/PopupMenu.vue";

const props = defineProps<{ controller: ReturnType<typeof useCategoriesController> }>();
const c = props.controller;
const {
	categories,
	canCreate,
	canWrite,
	canDelete,
	success,
	error,
	refreshError,
	loading,
	search,
	dialog,
	saving,
	deleting,
	removeTarget,
	editing,
	form,
	expanded,
	recoveryError,
	recoveryConflict,
	discardOpen,
	leaveRequested,
} = c;
</script>

<template>
	<div class="app-shell category-management">
		<PageHeader title="分类">
			<p class="muted">管理物品分类层级。删除受物品引用或下级分类保护。</p>
			<template #actions>
				<UiButton v-if="canCreate" variant="primary" @click="c.openCreate()"
					>新建分类</UiButton
				>
			</template>
		</PageHeader>
		<p v-if="success" role="status">{{ success }}</p>
		<p v-if="error && !dialog && !removeTarget" role="alert">{{ error }}</p>
		<p v-if="recoveryError" role="alert">{{ recoveryError }}</p>
		<p v-if="recoveryConflict" class="notice-bar warning" role="alert">
			{{ recoveryConflict }}
		</p>
		<div v-if="refreshError" role="alert" class="notice-bar danger">
			{{ refreshError }}
			<UiButton :loading="loading" loading-label="正在重新读取分类…" @click="c.refresh"
				>重新读取分类</UiButton
			>
		</div>
		<div class="category-tools">
			<label class="preview-field">搜索分类<input v-model="search" type="search" /></label>
			<span v-if="c.initialized.value" class="muted">{{ categories.length }} 个分类</span>
		</div>
		<AsyncRegion
			:loading="loading"
			:initialized="c.initialized.value"
			:stale="c.initialized.value"
			:error="error || refreshError"
			label="分类刷新中。"
		>
			<template #skeleton><SkeletonBlock variant="list" :rows="6" /></template>
			<ul class="category-tree" aria-label="物品分类层级">
				<li v-for="row in categories.filter(c.visible)" :key="row.name">
					<div
						class="category-row"
						:style="{ '--category-depth': Math.min(c.depth(row), 5) }"
					>
						<UiButton
							v-if="row.is_group"
							class="category-expand"
							:aria-expanded="expanded.has(row.name) || !!search.trim()"
							:aria-label="`${expanded.has(row.name) ? '收起' : '展开'} ${row.label}`"
							@click="c.toggle(row)"
							><DisclosureIcon variant="inline"
						/></UiButton>
						<span v-else class="category-expand-spacer" aria-hidden="true" />
						<strong>{{ row.label }}</strong>
						<small v-if="row.name !== row.label">{{ row.name }}</small>
						<span class="category-kind">{{ row.is_group ? "分组" : "末级" }}</span>
						<PopupMenu
							label="分类操作"
							variant="icon"
							align="end"
							class="category-row-actions"
						>
							<UiButton
								v-if="canCreate && row.is_group"
								icon="tag"
								@click="c.openCreate(row.name)"
								>添加下级</UiButton
							>
							<UiButton v-if="canWrite" icon="settings" @click="c.openEdit(row)"
								>编辑</UiButton
							>
							<UiButton
								v-if="canDelete"
								icon="disposal"
								variant="danger"
								@click="c.askDelete(row)"
								>删除</UiButton
							>
						</PopupMenu>
					</div>
				</li>
				<li v-if="!categories.some(c.visible)" class="muted">
					{{ c.initialized.value ? "没有匹配的分类。" : "" }}
				</li>
			</ul>
		</AsyncRegion>
		<Overlay
			v-if="dialog && !discardOpen && !leaveRequested"
			:title="editing ? '编辑分类' : '新建分类'"
			initial-focus="[data-category-name]"
			:dismissible="!saving"
			@close="c.closeEditor"
		>
			<CategoryFormFields
				v-model="form"
				:categories="categories"
				:excluded-names="c.parentExclusions(editing)"
				:disabled="saving"
			/>
			<p v-if="error" role="alert">{{ error }}</p>
			<template #footer>
				<UiButton :disabled="saving" @click="c.closeEditor">取消</UiButton>
				<UiButton variant="primary" :loading="saving" @click="c.save">保存</UiButton>
			</template>
		</Overlay>
		<Overlay v-if="discardOpen" title="放弃分类输入？" @close="c.finishDiscard(false)">
			<p>当前更改已保留在本浏览器。关闭后可以恢复，或明确放弃。</p>
			<template #footer>
				<UiButton @click="c.finishDiscard(false)">继续编辑</UiButton>
				<UiButton variant="danger" @click="c.finishDiscard(true)">放弃输入</UiButton>
			</template>
		</Overlay>
		<Overlay
			v-if="removeTarget"
			title="删除分类"
			:dismissible="!deleting"
			@close="removeTarget = undefined"
		>
			<p>
				确定删除「{{ removeTarget.label }}」吗？Frappe
				会阻止删除仍被物品或下级分类引用的类别，并显示具体原因。
			</p>
			<p v-if="error" role="alert">{{ error }}</p>
			<template #footer>
				<UiButton :disabled="deleting" @click="removeTarget = undefined">取消</UiButton>
				<UiButton variant="danger" :loading="deleting" @click="c.remove"
					>确认删除</UiButton
				>
			</template>
		</Overlay>
		<Overlay v-if="leaveRequested" title="离开分类编辑？" @close="c.finishLeave('stay')">
			<p>未完成输入保存在当前浏览器和账户中。</p>
			<template #footer>
				<UiButton @click="c.finishLeave('stay')">继续编辑</UiButton>
				<UiButton @click="c.finishLeave('retain')">保留输入并离开</UiButton>
				<UiButton variant="danger" @click="c.finishLeave('discard')"
					>放弃输入并离开</UiButton
				>
			</template>
		</Overlay>
	</div>
</template>

<style scoped>
.category-management {
	padding-bottom: 32px;
}
.category-tools {
	display: flex;
	align-items: end;
	gap: 12px;
	margin-top: 12px;
}
.category-tools .preview-field {
	flex: 1;
	max-width: 520px;
}
.category-tree {
	list-style: none;
	padding: 0;
	margin: 12px 0;
}
.category-row {
	display: flex;
	align-items: center;
	gap: 8px;
	min-height: 48px;
	padding: 5px 8px;
	padding-inline-start: calc(8px + min(var(--category-depth), 5) * 22px);
	border-bottom: 1px solid var(--p-border);
}
.category-row strong {
	min-width: 100px;
	max-width: 240px;
	overflow-wrap: anywhere;
}
.category-row small {
	flex: 1;
	min-width: 0;
	color: var(--p-muted);
	text-overflow: ellipsis;
	overflow: hidden;
	white-space: nowrap;
}
.category-kind {
	color: var(--p-muted);
	font-size: 0.8rem;
}
.category-expand,
.category-expand-spacer {
	width: 36px;
	min-width: 36px;
}
.category-recovery {
	padding: 12px;
	border: 1px solid var(--p-border);
	border-radius: var(--p-radius-card);
}
.category-recovery h2 {
	margin-block: 0 6px;
	font-size: 1rem;
}
@media (max-width: 1023px) {
	.category-tools {
		align-items: stretch;
		flex-wrap: wrap;
	}
	.category-tools .preview-field {
		max-width: none;
		flex-basis: 100%;
	}
	.category-row {
		flex-wrap: wrap;
		padding-inline-start: calc(4px + min(var(--category-depth), 5) * 12px);
	}
	.category-row strong {
		flex: 1 1 90px;
	}
	.category-kind {
		margin-inline-end: auto;
	}
}
</style>
