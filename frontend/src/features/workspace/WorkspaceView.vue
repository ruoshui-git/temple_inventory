<script setup lang="ts">
import Scanner from "../../components/Scanner.vue";
import LoadingIndicator from "../../components/LoadingIndicator.vue";
import ItemPicker from "../../components/ItemPicker.vue";
import LoanItemPicker from "../../components/LoanItemPicker.vue";
import AttachmentList from "../../components/AttachmentList.vue";
import { type WorkspaceController } from "./useWorkspaceController";
import UiButton from "../../components/UiButton.vue";

const props = defineProps<{ controller: WorkspaceController }>();
const {
	labels,
	sessionExpired,
	boot,
	record,
	form,
	error,
	saveStatus,
	dirty,
	conflict,
	saving,
	confirming,
	picker,
	loanPicker,
	scanner,
	unknown,
	scanBusy,
	recentScans,
	catalog,
	activities,
	seedQueue,
	review,
	activityDialog,
	activitySearch,
	detailsOpen,
	currentRoom,
	currentLocation,
	currentTo,
	lastScannedWarehouse,
	scopeGroup,
	chosen,
	line,
	editingIndex,
	batchRows,
	activity,
	activityTypeLabel,
	newRequestId,
	applying,
	editVersion,
	readonly,
	tree,
	allowed,
	inScope,
	scopedAllowed,
	rooms,
	locations,
	isReceive,
	isIssue,
	isTransfer,
	postingTimeMode,
	groups,
	totals,
	lineStockEquivalent,
	sourceOptions,
	label,
	leafLabel,
	requiredMark,
	today,
	isExpiredDate,
	changed,
	invalidate,
	markManualTime,
	setCurrentTime,
	adoptWorkspaceRoute,
	close,
	queue,
	hydrate,
	load,
	selectLoanItem,
	configureSeed,
	selectItem,
	editLine,
	loadBatches,
	scan,
	addLine,
	removeLine,
	attach,
	uploadAttachmentFiles,
	removeFile,
	removeAttachmentFile,
	createActivity,
	showReview,
	confirm,
	beforeUnload,
	deleteDraft,
} = props.controller;
</script>
<template>
	<main class="app-shell workspace">
		<header>
			<UiButton variant="ghost" size="compact" type="button" @click="close">‹ 首页</UiButton>
			<h1>{{ labels[form?.movement_kind] || "库存记录" }}</h1>
			<UiButton
				v-if="!readonly && record?.name"
				variant="danger"
				size="compact"
				type="button"
				@click="deleteDraft"
			>
				删除草稿</UiButton
			><span role="status">{{
				readonly
					? record.direct_entry
						? "ERPNext 记录"
						: record.docstatus === 1
							? "已完成 ✓"
							: "已取消"
					: saveStatus
			}}</span>
		</header>
		<p v-if="error" class="error" role="alert">{{ error }}</p>
		<div v-if="conflict" class="error">
			记录已在其他窗口修改。当前输入仍保留在页面中，请复制需要保留的内容后重新打开记录。<button
				type="button"
				@click="load"
			>
				重新加载
			</button>
		</div>
		<UiButton
			v-else-if="dirty && !saving"
			variant="secondary"
			size="compact"
			type="button"
			@click="queue.schedule(true)"
		>
			重试保存
		</UiButton>
		<LoadingIndicator v-if="!form || !boot" text="正在加载工作区…" /><template v-else
			><p v-if="record.direct_entry" class="field-hint">
				这是直接在 ERPNext 创建的库存记录。请在
				<a :href="record.desk_url">ERPNext Stock Entry</a> 中编辑或提交。
			</p>
			<form @submit.prevent="showReview">
				<fieldset :disabled="readonly || confirming">
					<div class="form-grid">
						<label
							>日期 <span v-html="requiredMark" /><input
								type="date"
								v-model="form.posting_date"
								:required="postingTimeMode === 'manual'"
								@input="markManualTime" /></label
						><label
							>时间 <span v-html="requiredMark" /><input
								type="time"
								step="1"
								v-model="form.posting_time"
								:required="postingTimeMode === 'manual'"
								@input="markManualTime" /></label
						><button
							v-if="postingTimeMode === 'manual'"
							type="button"
							@click="setCurrentTime"
						>
							使用当前时间
						</button>
						<p v-else class="field-hint">提交时使用当前时间</p>
					</div>
				</fieldset>
				<div v-if="!isIssue && !readonly" class="location-bar">
					<label
						>当前房间<select
							v-model="currentRoom"
							@change="currentLocation = locations[0]?.name || ''"
						>
							<option v-for="r in rooms" :value="r.name">
								{{ label(r.name) }}
							</option>
						</select></label
					><label v-if="locations.length > 1"
						>当前位置<select v-model="currentLocation">
							<option v-for="w in locations" :value="w.name">
								{{ label(w.name) }}
							</option>
						</select></label
					><button
						v-if="form.items?.length"
						type="button"
						@click="
							currentLocation = '';
							currentRoom = '';
						"
					>
						新增仓库/位置
					</button>
				</div>
				<div v-if="!readonly" class="toolbar workspace-tools">
					<button
						type="button"
						@click="
							form.movement_kind === 'Return'
								? (loanPicker = true)
								: (picker = true);
							unknown = '';
						"
					>
						＋添加物品</button
					><button
						v-if="form.movement_kind === 'Loss'"
						type="button"
						@click="loanPicker = true"
					>
						从未结借出选择</button
					><button type="button" @click="scanner = !scanner">▣ 连续扫码</button
					><span v-if="isIssue && lastScannedWarehouse" class="filter-chip"
						>出库仓库：{{ label(lastScannedWarehouse) }}
						<button type="button" @click="lastScannedWarehouse = ''">
							清除
						</button></span
					>
				</div>
				<Scanner
					v-if="scanner && !readonly"
					presentation="continuous"
					:paused="!!chosen || picker || scanBusy || sessionExpired"
					@scan="scan"
					@close="scanner = false"
				/>
				<ul v-if="scanner">
					<li v-for="text in recentScans.slice(0, 5)">✓ {{ text }}</li>
				</ul>
				<section v-if="seedQueue.length && !readonly" class="seed-queue">
					<h2>待配置物品</h2>
					<p class="field-hint">请为每项确认数量和实际库存位置后再加入记录。</p>
					<button
						v-for="seed in seedQueue"
						:key="seed.loan_item || seed.item_code"
						type="button"
						class="selection-row"
						@click="configureSeed(seed)"
					>
						<img
							v-if="seed.detail?.image"
							:src="seed.detail.image"
							class="thumb"
						/><b>{{ seed.detail?.item_name || seed.item_code }}</b
						><small>{{
							seed.loan_item
								? `未结 ${seed.outstanding} ${seed.uom}`
								: "选择数量和位置"
						}}</small>
					</button>
				</section>
				<p v-if="record.sync_error && form.items?.length" class="error">
					{{ record.sync_error }}
				</p>
				<p v-if="!form.items?.length" class="empty-state">
					尚未添加物品，请点击“添加物品”开始。
				</p>
				<section v-for="g in groups" :key="g.location" class="location-section">
					<h2>📍 {{ label(g.room) }}</h2>
					<h3 v-if="g.location !== g.room">{{ leafLabel(g.location) }}</h3>
					<p v-if="!g.lines.length">尚未添加物品</p>
					<article v-for="r in g.lines" :key="r.id" class="item-card">
						<img
							v-if="catalog[r.item_code]?.image"
							:src="catalog[r.item_code].image"
						/>
						<div>
							<b>{{ catalog[r.item_code]?.item_name || r.item_code }}</b>
							<p>
								{{ r.qty }} {{ r.uom }} <small>{{ r.item_code }}</small>
							</p>
							<p v-if="r.batch_no">批次 {{ r.batch_no }}</p>
							<p v-if="r.expiry_date">
								到期 {{ r.expiry_date }}
								<strong v-if="isExpiredDate(r.expiry_date)" class="error"
									>· 已过期</strong
								>
							</p>
							<p v-if="isTransfer">→ {{ label(r.to_warehouse) }}</p>
						</div>
						<div v-if="!readonly">
							<button type="button" @click="editLine(r.index)">编辑</button
							><button type="button" @click="removeLine(r.index)">移除</button>
						</div>
					</article>
				</section>
				<section class="details-panel">
					<button v-if="!readonly" type="button" @click="detailsOpen = !detailsOpen">
						{{ detailsOpen ? "收起详细信息" : "添加详细信息" }}
					</button>
					<div v-if="detailsOpen || readonly" class="details-content">
						<fieldset :disabled="readonly || confirming" @input="invalidate">
							<div class="form-grid">
								<label v-if="isReceive"
									>来源<input
										v-model="form.source_text"
										placeholder="例如：捐赠、采购或内部调拨" /></label
								><label v-if="!isReceive"
									>用途<input
										v-model="form.purpose_text"
										list="purposes"
									/><datalist id="purposes">
										<option
											v-for="p in [
												'分发',
												'活动/演出',
												'内部使用',
												'对外捐赠',
												'损坏/报废',
												'其他',
											]"
										>
											{{ p }}
										</option>
									</datalist></label
								><label
									v-if="['Loan', 'Return', 'Loss'].includes(form.movement_kind)"
									>借用方
									<span
										v-if="form.movement_kind === 'Loan'"
										v-html="requiredMark" /><input
										v-model="form.borrower"
										:required="form.movement_kind === 'Loan'"
										:readonly="
											form.movement_kind === 'Return' && !!form.items?.length
										"
										placeholder="姓名、单位或团体" /></label
								><label
									>活动<button
										type="button"
										class="selector-button"
										@click="activityDialog = true"
									>
										{{
											activities.find((a: any) => a.name === form.activity)
												?.title || "选择活动"
										}}
									</button></label
								><label>备注<textarea v-model="form.notes" /></label>
							</div>
						</fieldset>
					</div>
				</section>
				<AttachmentList
					v-if="record"
					class="workspace-attachment-list"
					:attachments="record.attachments"
					:editable="!readonly"
					@upload="uploadAttachmentFiles"
					@remove="removeAttachmentFile"
				/>
				<fieldset class="transaction-people" :disabled="readonly || confirming">
					<legend>现场人员（可选）</legend>
					<label
						>记录人<input v-model="form.recorder_name" @input="changed(true)"
					/></label>
					<label
						>经手人<input v-model="form.handler_name" @input="changed(true)"
					/></label>
					<label
						>鉴证人<input v-model="form.reviewer_name" @input="changed(true)"
					/></label>
				</fieldset>
				<button
					v-if="!readonly"
					type="submit"
					class="primary confirm-button"
					:disabled="confirming || conflict"
				>
					提交</button
				><small v-if="!readonly" class="muted"
					>系统记录用户：{{ form.recorded_by || boot.user }}</small
				>
				<p v-if="record.stock_entry">
					库存记录：{{ record.stock_entry }}
					<a
						v-if="boot.is_manager || record.direct_entry"
						:href="
							record.desk_url ||
							`/app/stock-entry/${encodeURIComponent(record.stock_entry)}`
						"
						>在 ERPNext 查看</a
					>
				</p>
			</form>
			<LoanItemPicker
				v-if="loanPicker"
				:tree="tree"
				@select="selectLoanItem"
				@close="loanPicker = false"
			/><ItemPicker
				v-if="picker"
				:boot="boot"
				:barcode="unknown"
				:movement-kind="form.movement_kind"
				:stock-only="isIssue"
				:warehouse="lastScannedWarehouse"
				:posting-date="postingTimeMode === 'manual' ? form.posting_date : undefined"
				:posting-time="postingTimeMode === 'manual' ? form.posting_time : undefined"
				@warehouse-change="lastScannedWarehouse = $event"
				@select="selectItem"
				@close="
					picker = false;
					unknown = '';
				"
			/>
			<div v-if="chosen && line" class="drawer-backdrop">
				<aside class="drawer wide" role="dialog" aria-modal="true" aria-label="数量与位置">
					<div class="compact-selection">
						<img
							v-if="chosen.image"
							:src="chosen.image"
							:alt="chosen.item_name"
							class="thumb"
						/>
						<div>
							<h2>{{ chosen.item_name }}</h2>
							<p>
								{{ chosen.item_code }} · 总库存 {{ chosen.total_stock }}
								{{ chosen.stock_uom }}
							</p>
						</div>
					</div>
					<form @submit.prevent="addLine">
						<label
							>数量 <span v-html="requiredMark" /><input
								type="number"
								min="0.000001"
								step="any"
								v-model.number="line.qty"
								required /></label
						><label
							>单位 <span v-html="requiredMark" /><select
								v-model="line.uom"
								required
							>
								<option :value="chosen.stock_uom">
									{{ chosen.stock_uom }}
								</option>
								<option
									v-for="u in chosen.uoms.filter(
										(u: any) => u.uom !== chosen.stock_uom,
									)"
									:value="u.uom"
								>
									{{ u.uom }} ({{ u.conversion_factor }} {{ chosen.stock_uom }})
								</option>
							</select></label
						>
						<p
							v-if="line.uom !== chosen.stock_uom && lineStockEquivalent != null"
							class="field-hint"
							aria-live="polite"
						>
							相当于 {{ lineStockEquivalent }} {{ chosen.stock_uom }}
						</p>
						<label v-if="isReceive"
							>入库位置 <span v-html="requiredMark" /><select
								v-model="line.warehouse"
								required
							>
								<option v-for="w in allowed" :value="w.name">
									{{ label(w.name) }}
								</option>
							</select></label
						><template v-else-if="form.movement_kind === 'Return'"
							><p>
								来源位置：{{ label(boot.settings.loan_warehouse) }}（系统借出库）
							</p></template
						><template v-else
							><h3>各位置库存</h3>
							<button
								type="button"
								v-for="s in sourceOptions"
								@click="
									line.from_warehouse = s.warehouse;
									loadBatches();
								"
							>
								{{ label(s.warehouse) }} · {{ s.actual_qty }}
								{{ chosen.stock_uom }}</button
							><label
								>来源位置 <span v-html="requiredMark" /><select
									v-model="line.from_warehouse"
									required
									@change="loadBatches"
								>
									<option value="">请选择有库存的位置</option>
									<option v-for="s in sourceOptions" :value="s.warehouse">
										{{ label(s.warehouse) }} · {{ s.actual_qty }}
										{{ chosen.stock_uom }}
									</option>
								</select></label
							></template
						><label v-if="form.movement_kind === 'Return'"
							>结果<select
								v-model="line.outcome"
								@change="
									line.to_warehouse =
										line.outcome === 'Damaged'
											? boot.settings.damaged_warehouse
											: line.to_warehouse
								"
							>
								<option value="Returned">正常归还</option>
								<option value="Damaged">损坏待处理</option>
							</select></label
						><label v-if="isTransfer && form.movement_kind !== 'Loan'"
							>目标位置 <span v-html="requiredMark" /><select
								v-model="line.to_warehouse"
								required
							>
								<option v-for="w in allowed" :value="w.name">
									{{ label(w.name) }}
								</option>
							</select></label
						><template v-if="chosen.has_batch_no"
							><label v-if="isReceive && boot.capabilities.Batch"
								><input
									type="checkbox"
									v-model="line.new_batch"
									@change="line.batch_no = ''"
								/>创建新批次</label
							><template v-if="line.new_batch"
								><label
									>批次编号（留空自动生成）<input
										v-model="line.batch_no" /></label
								><label
									>生产日期<input
										type="date"
										v-model="line.manufacturing_date" /></label
								><label
									>到期日期
									<span
										v-if="chosen.has_expiry_date"
										v-html="requiredMark" /><input
										type="date"
										v-model="line.expiry_date"
										:required="!!chosen.has_expiry_date" /></label></template
							><label v-else
								>批次 <span v-html="requiredMark" /><select
									v-model="line.batch_no"
									required
								>
									<option value="">请选择批次</option>
									<option v-for="b in batchRows" :value="b.name">
										{{ b.name }} · {{ b.expiry_date || "无到期日期" }}
										{{ isExpiredDate(b.expiry_date) ? "· 已过期" : "" }}
										{{ b.qty != null ? `· 库存 ${b.qty}` : "" }}
									</option>
								</select></label
							></template
						><button class="primary">
							{{ editingIndex >= 0 ? "更新" : "添加" }}</button
						><button
							type="button"
							@click="
								chosen = undefined;
								line = undefined;
							"
						>
							取消
						</button>
					</form>
				</aside>
			</div>
			<div v-if="activityDialog" class="modal">
				<section role="dialog" aria-modal="true">
					<h2>选择活动</h2>
					<label>搜索活动<input v-model="activitySearch" /></label>
					<div
						v-for="a in activities.filter(
							(a: any) => !activitySearch || a.title.includes(activitySearch),
						)"
						:key="a.name"
					>
						<button
							type="button"
							@click="
								form.activity = a.name;
								activityDialog = false;
								changed(true);
							"
						>
							{{ a.title }}（{{ activityTypeLabel(a.activity_type) }}）
						</button>
					</div>
					<form
						v-if="!readonly && boot.capabilities['Inventory Activity']"
						@submit.prevent="createActivity"
					>
						<h3>新建活动</h3>
						<label
							>名称 <span v-html="requiredMark" /><input
								v-model="activity.title"
								required /></label
						><label
							>类型 <span v-html="requiredMark" /><select
								v-model="activity.activity_type"
								required
							>
								<option
									v-for="t in [
										'Distribution',
										'Event',
										'Performance',
										'Religious Activity',
										'Maintenance',
										'Other',
									]"
									:value="t"
								>
									{{ activityTypeLabel(t) }}
								</option>
							</select></label
						><label>开始日期<input type="date" v-model="activity.start_date" /></label
						><label>结束日期<input type="date" v-model="activity.end_date" /></label
						><label>说明<textarea v-model="activity.description" /></label
						><button>创建并选择</button
						><button type="button" @click="activityDialog = false">取消</button>
					</form>
				</section>
			</div>
			<div v-if="review" class="modal">
				<section>
					<h2>确认{{ labels[form.movement_kind] }}</h2>
					<p>
						{{
							postingTimeMode === "manual"
								? `${form.posting_date} ${form.posting_time}`
								: "提交时使用当前时间"
						}}
					</p>
					<p>{{ form.source_text || form.purpose_text || form.borrower || "" }}</p>
					<p>{{ form.items.length }} 行物品</p>
					<div class="review-items">
						<div v-for="line in form.items" :key="line.id" class="compact-selection">
							<img
								v-if="catalog[line.item_code]?.image"
								:src="catalog[line.item_code].image"
								:alt="catalog[line.item_code]?.item_name"
								class="thumb"
							/><span
								><b>{{ catalog[line.item_code]?.item_name || line.item_code }}</b
								><small
									>{{ line.qty }} {{ line.uom
									}}<template v-if="line.batch_no">
										· 批次 {{ line.batch_no }}</template
									><template v-if="isExpiredDate(line.expiry_date)">
										· 已过期</template
									></small
								></span
							>
						</div>
					</div>
					<p v-for="(qty, uom) in totals">{{ qty }} {{ uom }}</p>
					<p v-for="g in groups">{{ label(g.location) }} · {{ g.lines.length }} 行</p>
					<p>活动：{{ form.activity || "无" }}</p>
					<p>附件：{{ record.attachments?.length || 0 }}</p>
					<p>记录人：{{ form.recorder_name || "未填写" }}</p>
					<p>经手人：{{ form.handler_name || "未填写" }}</p>
					<p>系统记录用户：{{ form.recorded_by || boot.user }}</p>
					<p>鉴证人：{{ form.reviewer_name || "未填写" }}</p>
					<p v-if="error" class="error">{{ error }}</p>
					<button type="button" :disabled="confirming" @click="review = false">
						返回修改</button
					><button type="button" class="primary" :disabled="confirming" @click="confirm">
						{{ confirming ? "正在确认…" : `确认${labels[form.movement_kind]}` }}
					</button>
				</section>
			</div>
		</template>
	</main>
</template>
