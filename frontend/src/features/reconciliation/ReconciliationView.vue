<script setup lang="ts">
import LoadingIndicator from "../../components/LoadingIndicator.vue";
import Scanner from "../../components/Scanner.vue";
import AttachmentList from "../../components/AttachmentList.vue";
import { type ReconciliationController } from "./useReconciliationController";

const props = defineProps<{ controller: ReconciliationController }>();
const {
	requestId,
	boot,
	record,
	error,
	loading,
	saving,
	scanner,
	conflict,
	warehouse,
	mode,
	search,
	results,
	postingDate,
	postingTime,
	rows,
	notes,
	batchChoices,
	batchItem,
	review,
	reviewDialog,
	reviewTrigger,
	audit,
	readonly,
	leaves,
	warehouseLabel,
	countedRows,
	discrepancyRows,
	uomSummary,
	adopt,
	load,
	find,
	add,
	markNotFound,
	scan,
	close,
	payload,
	resetPostingTime,
	persistChain,
	persistNow,
	persist,
	confirm,
	refreshBaseline,
	showReview,
	attach,
	uploadAttachmentFiles,
	removeFile,
	removeAttachmentFile,
	trapReview,
} = props.controller;
</script>
<template>
	<button
		v-if="!loading && !readonly"
		type="button"
		class="reconciliation-reset-time"
		@click="resetPostingTime"
	>
		重置为当前盘点时间
	</button>
	<section v-if="batchItem" class="modal" role="dialog" aria-modal="true">
		<section>
			<h2>选择批次</h2>
			<button
				v-for="batch in batchChoices"
				:key="batch.batch_no"
				type="button"
				@click="add(batchItem, batch.batch_no)"
			>
				{{ batch.batch_no }} · {{ batch.expiry_date || "无效期" }} · 账面
				{{ batch.qty }}
			</button>
			<p v-if="!batchChoices.length" class="empty-state">该库位没有可盘点的正库存批次</p>
			<button
				type="button"
				@click="
					batchItem = undefined;
					batchChoices = [];
				"
			>
				取消
			</button>
		</section>
	</section>
	<section
		v-if="review"
		ref="reviewDialog"
		class="modal"
		role="dialog"
		aria-modal="true"
		aria-labelledby="reconciliation-confirm-title"
		tabindex="-1"
		@keydown.esc="review = false"
		@keydown.tab="trapReview"
	>
		<section>
			<h2 id="reconciliation-confirm-title">确认提交</h2>
			<p>库位：{{ warehouseLabel(warehouse, boot?.warehouse_tree || []) }}</p>
			<p>已确认 {{ countedRows.length }} 行，其中 {{ discrepancyRows.length }} 行有差异。</p>
			<p v-for="(summary, uom) in uomSummary" :key="uom">
				{{ uom || "未指定单位" }}：增加 {{ summary.increase }}，减少
				{{ summary.decrease }}
			</p>
			<p v-if="record?.attachments?.length">已附 {{ record.attachments.length }} 个文件。</p>
			<p>记录人：{{ audit.recorder_name || "未填写" }}</p>
			<p>经手人：{{ audit.handler_name || "未填写" }}</p>
			<p>鉴证人：{{ audit.reviewer_name || "未填写" }}</p>
			<p v-if="conflict" class="error">账面数量已变化，请先更新账面数量。</p>
			<div class="detail-actions">
				<button type="button" :disabled="saving" @click="review = false">取消</button
				><button
					class="primary"
					type="button"
					:disabled="saving || conflict"
					@click="confirm"
				>
					确认提交
				</button>
			</div>
		</section>
	</section>
	<p v-if="conflict" class="error">
		账面数量发生变化。<button type="button" @click="refreshBaseline">
			更新账面数量并重新检查
		</button>
	</p>
	<main class="app-shell wide-shell reconciliation-page">
		<header>
			<button type="button" @click="close">‹ 返回</button>
			<h1>{{ readonly ? "盘点记录" : "盘点" }}</h1>
			<span role="status">{{
				saving
					? "正在保存…"
					: record?.stock_reconciliation
						? "已完成"
						: record?.name
							? "已保存"
							: "尚未保存"
			}}</span>
		</header>
		<LoadingIndicator v-if="loading" text="正在加载盘点…" /><template v-else
			><p v-if="error" class="error">
				{{ error }} <button type="button" @click="load">重试</button>
			</p>
			<template v-if="!error"
				><form @submit.prevent="showReview">
					<section class="reconciliation-scope">
						<h2>1. 选择盘点范围</h2>
						<label
							>实体叶子库位<span
								v-if="!readonly"
								class="required-mark"
								aria-hidden="true"
								>*</span
							><select
								v-model="warehouse"
								:disabled="readonly"
								:required="!readonly"
								@change="persist"
							>
								<option value="" disabled>请选择库位</option>
								<option v-for="node in leaves" :key="node.name" :value="node.name">
									{{ warehouseLabel(node.name, boot?.warehouse_tree || []) }}
								</option>
							</select></label
						><label
							>盘点方式<select v-model="mode" :disabled="readonly" @change="persist">
								<option value="selective">抽查盘点</option>
								<option value="whole">整库盘点（需逐项确认）</option>
							</select></label
						>
						<p class="field-hint">
							盘点时间：{{ postingDate }}
							{{ postingTime }}。整库盘点必须逐项选择“已盘点”或“未找到，计为 0”。
						</p>
					</section>
					<section>
						<h2>2. 录入实点数量</h2>
						<div v-if="!readonly" class="result-toolbar">
							<input
								v-model="search"
								placeholder="搜索物品或条码"
								@keydown.enter.prevent="find"
							/><button type="button" @click="find">搜索</button
							><button type="button" @click="scanner = true">扫描</button>
						</div>
						<div v-if="results.length" class="selection-row">
							<button
								v-for="item in results"
								:key="item.item_code"
								type="button"
								@click="add(item)"
							>
								{{ item.item_name }} · {{ item.item_code }}
							</button>
						</div>
						<div class="reconciliation-lines">
							<article
								v-for="row in rows"
								:key="`${row.item_code}:${row.batch_no || ''}`"
								class="item-card"
							>
								<div>
									<b>{{ row.item_name || row.item_code }}</b
									><small
										>{{ row.item_code
										}}<template v-if="row.batch_no">
											· 批次 {{ row.batch_no }}</template
										>
										· {{ row.uom }} · 账面 {{ row.ledger_qty }}</small
									>
								</div>
								<label
									>实点数量<input
										v-model="row.counted_qty"
										type="number"
										min="0"
										step="any"
										:readonly="readonly"
										@change="
											row.count_state = 'counted';
											persist();
										" /></label
								><button
									v-if="!readonly && mode === 'whole'"
									type="button"
									@click="markNotFound(row)"
								>
									未找到，计为 0</button
								><strong v-if="row.counted_qty !== ''"
									>差异
									{{ Number(row.counted_qty) - Number(row.ledger_qty) }}</strong
								><small v-if="mode === 'whole'"
									>状态：{{
										row.count_state === "not_found"
											? "未找到，计为 0"
											: row.count_state === "counted"
												? "已盘点"
												: "待确认"
									}}</small
								>
							</article>
						</div>
						<p v-if="!rows.length" class="empty-state">尚未添加盘点物品</p>
					</section>
					<section class="reconciliation-summary">
						<h2>3. 检查差异</h2>
						<p>
							已确认 {{ countedRows.length }} 行 · 差异
							{{ discrepancyRows.length }} 行
						</p>
						<p v-for="(summary, uom) in uomSummary" :key="uom">
							{{ uom || "未指定单位" }}：增加 {{ summary.increase }}，减少
							{{ summary.decrease }}
						</p>
					</section>
					<section class="attachments">
						<h2>备注</h2>
						<textarea
							v-model="notes"
							:readonly="readonly"
							placeholder="可选的盘点说明"
							@change="persist"
						></textarea>
					</section>
					<AttachmentList
						v-if="record"
						class="reconciliation-attachment-list"
						:attachments="record.attachments"
						:editable="!readonly"
						@upload="uploadAttachmentFiles"
						@remove="removeAttachmentFile"
					/>
					<section class="reconciliation-audit">
						<h2>现场人员（可选）</h2>
						<label
							>记录人<input
								v-model="audit.recorder_name"
								:readonly="readonly"
								@change="persist"
						/></label>
						<label
							>经手人<input
								v-model="audit.handler_name"
								:readonly="readonly"
								@change="persist"
						/></label>
						<label
							>鉴证人<input
								v-model="audit.reviewer_name"
								:readonly="readonly"
								@change="persist"
						/></label>
					</section>
					<div v-if="!readonly" class="submit-row">
						<button type="button" @click="persist">保存盘点</button
						><button
							class="primary"
							type="submit"
							:disabled="
								saving ||
								!rows.some(
									(row) =>
										row.count_state === 'counted' ||
										row.count_state === 'not_found',
								)
							"
						>
							提交
						</button>
					</div>
				</form></template
			></template
		><Scanner v-if="scanner" presentation="modal" @scan="scan" @close="scanner = false" />
	</main>
</template>
