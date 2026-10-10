<script setup lang="ts">
import AttachmentList from "../../components/AttachmentList.vue";
import LoadingIndicator from "../../components/LoadingIndicator.vue";
import Scanner from "../../components/Scanner.vue";
import IconButton from "../../components/IconButton.vue";
import UiButton from "../../components/UiButton.vue";
import AsyncImage from "../../components/AsyncImage.vue";
import { type ItemDetailController } from "./useItemDetailController";

const props = defineProps<{ controller: ItemDetailController }>();
const {
	item,
	boot,
	error,
	chosen,
	editing,
	saving,
	scanner,
	selectedImage,
	itemGroups,
	operationCaps,
	warehouseText,
	batchSort,
	batchSortOrder,
	batches,
	toggleBatchSort,
	batchSelected,
	signedChange,
	formatExpiryDuration,
	operation,
	addBarcode,
	close,
	retry,
	saveEdit,
	uploadAttachments,
	setPrimary,
	removeFile,
} = props.controller;
</script>
<template>
	<section class="app-shell wide-shell">
		<header>
			<IconButton label="返回" @click="close"
				><svg aria-hidden="true" viewBox="0 0 24 24">
					<path d="m14 5-7 7 7 7M7 12h11" /></svg
			></IconButton>
			<h1>物品详情</h1>
			<IconButton
				v-if="item?.can_edit"
				:label="editing ? '取消编辑' : '编辑'"
				@click="editing = !editing"
				><svg aria-hidden="true" viewBox="0 0 24 24">
					<path d="m4 16.5V20h3.5L18 9.5 14.5 6 4 16.5ZM13.5 7l3.5 3.5" /></svg
			></IconButton>
		</header>
		<p v-if="error" class="error">
			{{ error }}
			<UiButton variant="ghost" size="compact" type="button" @click="retry">重试</UiButton>
		</p>
		<LoadingIndicator v-if="!item && !error" text="正在加载物品…" />
		<template v-else-if="item">
			<form v-if="editing" class="settings-detail" @submit.prevent="saveEdit">
				<h2>编辑物品资料</h2>
				<label>名称<input v-model="item.item_name" required /></label
				><label
					>类别<select v-model="item.item_group">
						<option v-for="group in itemGroups" :key="group.name" :value="group.name">
							{{ group.item_group_name }}
						</option>
					</select></label
				><label>说明<textarea v-model="item.description" /></label
				><label>条码（每行一个）<textarea v-model="item.barcodes" /></label>
				<div class="detail-actions">
					<UiButton
						variant="secondary"
						size="compact"
						type="button"
						@click="scanner = true"
						>扫描添加条码</UiButton
					><UiButton variant="primary" type="submit" :loading="saving">
						{{ saving ? "正在保存…" : "保存资料" }}
					</UiButton>
				</div>
			</form>
			<Scanner
				v-if="editing && scanner"
				presentation="modal"
				@scan="addBarcode"
				@close="scanner = false"
			/>
			<section v-if="selectedImage" class="item-gallery">
				<AsyncImage
					class="item-gallery-hero"
					:src="selectedImage.file_url"
					:alt="item.item_name"
				/>
				<div v-if="(item.images || []).length > 1" class="gallery-thumbs">
					<button
						v-for="image in item.images"
						:key="image.file_url"
						type="button"
						:class="{ selected: image.file_url === chosen }"
						:aria-label="`查看 ${image.file_name}`"
						@click="chosen = image.file_url"
					>
						<AsyncImage
							:src="image.file_url"
							:alt="image.file_name"
							width="54"
							height="54"
						/>
					</button>
				</div>
			</section>
			<h2>{{ item.item_name }}</h2>
			<p>{{ item.item_code }} · {{ item.item_group }} · {{ item.stock_uom }}</p>
			<p>{{ item.description }}</p>
			<p>
				可用 {{ item.available_stock }} · 总计 {{ item.total_stock }} · 借出
				{{ item.on_loan_qty }} · 损坏 {{ item.damaged_qty }} {{ item.stock_uom }}
			</p>
			<div class="detail-actions">
				<template
					v-for="kind in ['Receive', 'Issue', 'Transfer', 'Loan', 'Damage']"
					:key="kind"
					><button v-if="operationCaps[kind]" type="button" @click="operation(kind)">
						{{
							(
								{
									Receive: "入库",
									Issue: "出库",
									Transfer: "转移",
									Loan: "借出",
									Damage: "标记损坏",
								} as any
							)[kind]
						}}
					</button></template
				>
			</div>
			<section v-if="item.has_batch_no" class="item-batches">
				<h2>批次与有效期</h2>
				<p v-if="!batches.length" class="empty-state">暂无有库存的批次</p>
				<div class="batch-desktop-table">
					<table>
						<thead>
							<tr>
								<th>Batch ID</th>
								<th
									:aria-sort="
										batchSort === 'expiry_date'
											? batchSortOrder === 'asc'
												? 'ascending'
												: 'descending'
											: 'none'
									"
								>
									<button
										type="button"
										aria-label="按到期日期排序"
										@click="toggleBatchSort('expiry_date')"
									>
										到期日期
									</button>
								</th>
								<th>剩余</th>
								<th
									:aria-sort="
										batchSort === 'total_qty'
											? batchSortOrder === 'asc'
												? 'ascending'
												: 'descending'
											: 'none'
									"
								>
									<button
										type="button"
										aria-label="按数量排序"
										@click="toggleBatchSort('total_qty')"
									>
										数量
									</button>
								</th>
								<th>位置</th>
							</tr>
						</thead>
						<tbody>
							<tr
								v-for="batch in batches"
								:key="batch.batch_no"
								:class="{
									selected: batchSelected(batch),
									expired: batch.days_to_expiry < 0,
								}"
							>
								<td>{{ batch.batch_no }}</td>
								<td>{{ batch.expiry_date || "无有效期" }}</td>
								<td>
									{{
										batch.days_to_expiry == null
											? "—"
											: formatExpiryDuration(batch.days_to_expiry)
									}}
								</td>
								<td>{{ batch.total_qty ?? batch.qty }} {{ item.stock_uom }}</td>
								<td>
									<span
										v-for="location in batch.locations || []"
										:key="location.warehouse"
										>{{ warehouseText(location.warehouse) }}：{{ location.qty
										}}<br
									/></span>
								</td>
							</tr>
						</tbody>
					</table>
				</div>
				<div
					v-for="batch in batches"
					:key="'card-' + batch.batch_no"
					class="batch-card"
					:class="{
						selected: batchSelected(batch),
						expired: batch.days_to_expiry < 0,
					}"
				>
					<b>{{ batch.batch_no }}</b
					><span
						>{{ batch.expiry_date || "无有效期"
						}}<template v-if="batch.days_to_expiry != null">
							· {{ formatExpiryDuration(batch.days_to_expiry) }}</template
						></span
					><strong>{{ batch.total_qty ?? batch.qty }} {{ item.stock_uom }}</strong
					><small v-for="location in batch.locations || []" :key="location.warehouse"
						>{{ warehouseText(location.warehouse) }}：{{ location.qty }}
						{{ item.stock_uom }}</small
					>
				</div>
			</section>
			<template v-else>
				<h2>库存位置</h2>
				<p v-if="!item.stock.length" class="empty-state">暂无库存位置记录</p>
				<div v-for="stock in item.stock" :key="stock.warehouse" class="selection-row">
					{{ warehouseText(stock.warehouse) }}
					<b>{{ stock.actual_qty }} {{ item.stock_uom }}</b>
				</div>
			</template>
			<details v-if="item.active_loans?.length">
				<summary>未结借用</summary>
				<RouterLink
					v-for="loan in item.active_loans"
					:key="loan.loan_item"
					:to="`/loans/${encodeURIComponent(loan.loan)}`"
					>{{ loan.borrower || loan.loan }} · {{ loan.outstanding }}
					{{ loan.uom }}</RouterLink
				>
			</details>
			<AttachmentList
				:attachments="item.attachments"
				:editable="Boolean(item.can_edit && editing)"
				:allow-primary-image="true"
				:primary-url="item.image"
				@upload="uploadAttachments"
				@remove="removeFile"
				@set-primary="setPrimary"
			/>
			<h2 v-if="item.history?.length">最近库存变动</h2>
			<RouterLink
				v-for="row in item.history"
				:key="row.name"
				class="selection-row recent-change"
				:to="
					row.document_type === 'Stock Reconciliation'
						? `/reconcile/${encodeURIComponent(row.name)}`
						: row.legacy
							? `/entry/${encodeURIComponent(row.name)}`
							: `/workspace/${row.name}`
				"
				><b>{{ row.posting_date }} · {{ row.movement_kind }}</b
				><template v-if="row.item_changes?.length"
					><span
						v-for="change in row.item_changes"
						:key="`${change.warehouse}:${change.uom}`"
						:class="change.delta < 0 ? 'negative-change' : 'positive-change'"
						>{{ warehouseText(change.warehouse) }} {{ signedChange(change.delta) }}
						{{ change.uom }}</span
					></template
				><span v-else>此记录没有可显示的物品变动明细</span></RouterLink
			>
		</template>
	</section>
</template>
