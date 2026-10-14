<script setup lang="ts">
import { ref } from "vue";
import { reviewSession } from "../reviewModel";
import PreviewSearchSelect from "./PreviewSearchSelect.vue";
import PreviewUiButton from "./PreviewUiButton.vue";
const state = ref("ready"),
	candidate = ref(""),
	review = ref(false),
	confirmed = ref(false),
	message = ref("");
function apply() {
	if (!confirmed.value || !candidate.value) return;
	message.value = `配置引用已指向 ${candidate.value}；未移动库存或更改仓库上级。`;
	state.value = "ready";
	review.value = false;
}
</script>
<template>
	<section class="form-section">
		<h2>配置与恢复</h2>
		<label class="preview-field"
			>预览状态<select
				v-model="state"
				@change="
					review = false;
					confirmed = false;
					message = '';
				"
			>
				<option value="ready">配置有效</option>
				<option value="new">尚未初始化</option>
				<option value="root">仓库根引用失效</option>
				<option value="metadata">物理类型缺失</option>
				<option value="denied">无权读取已配置仓库</option>
				<option value="guest">尚未登录</option>
				<option value="role">非 System Manager</option>
			</select></label
		>
		<p v-if="state === 'ready'" role="status">配置有效 · System Manager · 可进入库存</p>
		<p v-else-if="state === 'guest'">请登录后打开库存应用。</p>
		<p v-else-if="state === 'role'">此应用目前仅供 System Manager 使用。可切换账户。</p>
		<p v-else-if="state === 'denied'" role="alert">
			仓库存在但当前账户没有读取权限。请在 ERPNext 调整授权后重试；不能将其当作缺失仓库重建。
		</p>
		<template v-else-if="state === 'new'"
			><p>为已配置公司建立实体、借出和损坏库存位置。初始化不导入库存数量。</p>
			<PreviewUiButton @click="review = true">查看初始化结构</PreviewUiButton>
			<div v-if="review">
				<ul>
					<li>实体仓库 → 房间 → 未指定库位</li>
					<li>借出 → 通用借用</li>
					<li>损坏待处理</li>
				</ul>
				<PreviewUiButton
					@click="
						state = 'ready';
						message = '样本配置已初始化';
					"
					>确认初始化</PreviewUiButton
				>
			</div></template
		><template v-else-if="state === 'metadata'"
			><p>节点缺少 Room / Location 类型；层级和库存不会改变。</p>
			<PreviewUiButton
				@click="
					state = 'ready';
					message = '已恢复样本物理类型';
				"
				>修复物理类型</PreviewUiButton
			></template
		><template v-else
			><PreviewSearchSelect
				label="替代根节点"
				v-model="candidate"
				:options="
					reviewSession.warehouses
						.filter(
							(row) => row.is_group && !['借出', '损坏待处理'].includes(row.name),
						)
						.map((row) => row.name)
				"
			/><PreviewUiButton :disabled="!candidate" @click="review = true"
				>查看修复影响</PreviewUiButton
			>
			<div v-if="review">
				<p>失效根引用 → {{ candidate }}。仅修改配置指针，不移动库存，不修改树结构。</p>
				<label class="preview-choice-label"
					><input type="checkbox" v-model="confirmed" />确认使用此实体根节点</label
				><PreviewUiButton :disabled="!confirmed" @click="apply">应用修复</PreviewUiButton
				><PreviewUiButton @click="review = false">取消</PreviewUiButton>
			</div></template
		>
		<p v-if="message" role="status">{{ message }}</p>
	</section>
</template>
