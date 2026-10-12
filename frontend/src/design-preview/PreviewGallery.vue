<script setup lang="ts">
import { computed, ref } from "vue";
import UiButton from "../components/UiButton.vue";
import IconButton from "../components/IconButton.vue";
import InventoryIcon from "../components/InventoryIcon.vue";
import HierarchyFilter from "../components/HierarchyFilter.vue";
import QuantitySummary from "../components/QuantitySummary.vue";
import PreviewOverlay from "./PreviewOverlay.vue";
import PreviewProduct from "./PreviewProduct.vue";
import PreviewDenseLines from "./PreviewDenseLines.vue";
import PreviewItemImage from "./PreviewItemImage.vue";
import { items } from "./model";
import { themes, warehouseNodes, type ThemeId } from "./model";
const props = defineProps<{ theme: ThemeId }>();
const emit = defineEmits<{ notify: [message: string]; inventory: []; receive: [] }>();
const theme = computed(() => themes.find((item) => item.id === props.theme)!);
const hierarchy = ref<string[]>(["斋堂"]);
const input = ref("");
const validation = ref(false);
const tab = ref("明细");
const radio = ref("all");
const checkbox = ref(true);
const overlay = ref<"dialog" | "drawer" | "">("");
const feedback = ref("error");
const chipVisible = ref(true);
const swatches = computed(() => [
	{ name: "画布", color: theme.value.canvas },
	{ name: "表面", color: "#FFFFFF" },
	{ name: "正文", color: theme.value.ink },
	{ name: "辅助文字", color: theme.value.muted },
	{ name: "强调", color: theme.value.accent },
	{ name: "选中", color: theme.value.soft },
]);
</script>
<template>
	<div class="gallery">
		<div class="page-heading">
			<div>
				<span class="eyebrow">FOUNDATIONS / 设计语言</span>
				<h1>一致，始于每一个细节。</h1>
				<p class="muted">从一行文字到一次确认，让整个应用说同一种语言。</p>
			</div>
			<span class="version-mark">候选系统<br /><strong>01—03</strong></span>
		</div>
		<div class="gallery-intro surface">
			<div>
				<span class="eyebrow">{{ theme.en }}</span>
				<h2>{{ theme.name }}</h2>
				<p>{{ theme.description }}</p>
				<p class="muted">
					少一些装饰，多一些清楚。颜色表达含义，间距建立秩序，交互给出回应。
				</p>
			</div>
			<div class="swatches">
				<div v-for="swatch in swatches" :key="swatch.name">
					<span :style="{ background: swatch.color }" /><strong>{{ swatch.name }}</strong
					><small>{{ swatch.color }}</small>
				</div>
			</div>
		</div>
		<div class="gallery-grid">
			<section class="surface gallery-section">
				<div class="section-heading">
					<h2>文字与层级</h2>
					<span class="eyebrow">01 / TYPE</span>
				</div>
				<div class="type-specimen">
					<span class="muted">页面标题 · 24</span>
					<p class="type-title">物资有序，取用安心</p>
					<span class="muted">章节标题 · 18</span>
					<p class="type-section">每一份物资的来处与去向</p>
					<span class="muted">正文 · 桌面 14 / 手机 16</span>
					<p>清楚地记录位置、数量和批次，让交接更简单。</p>
					<span class="muted">辅助文字 · 12</span
					><small>最后更新 09:42 · 示例记录</small>
					<div class="type-numbers">1,280.50 <span>袋 / 桶 / 件</span></div>
				</div>
			</section>
			<section class="surface gallery-section">
				<div class="section-heading">
					<h2>操作与反馈</h2>
					<span class="eyebrow">02 / ACTION</span>
				</div>
				<p class="muted">主操作突出；次要操作退后；危险操作有明确文字。</p>
				<div class="button-row specimen-row">
					<UiButton
						variant="primary"
						icon="box"
						@click="emit('notify', '主要操作完成（模拟）')"
						>确认入库</UiButton
					><UiButton @click="emit('notify', '已返回编辑状态（模拟）')">返回修改</UiButton
					><UiButton variant="ghost" @click="emit('notify', '筛选已清除（模拟）')"
						>清除</UiButton
					><UiButton variant="danger" @click="overlay = 'dialog'">删除草稿</UiButton>
				</div>
				<div class="button-row specimen-row">
					<UiButton variant="primary" loading>保存</UiButton
					><UiButton disabled>不可用</UiButton
					><UiButton
						size="compact"
						icon="download"
						@click="emit('notify', '导出样式演示，不生成实际文件。')"
						>导出</UiButton
					><IconButton
						label="显示操作提示"
						@click="emit('notify', '图标操作保留可访问名称，聚焦时也显示提示。')"
						><InventoryIcon name="more"
					/></IconButton>
				</div>
				<div class="focus-example">
					<button class="focus-specimen" @click="emit('notify', '键盘焦点始终可见。')">
						可见焦点</button
					><small class="muted">按 Tab 体验真实焦点，不依赖悬停。</small>
				</div>
				<div class="chip-row">
					<span class="badge success">✓ 已保存</span
					><span class="badge warning">! 即将到期</span
					><span class="badge danger">! 已过期</span
					><span class="badge info">借出中</span><span class="badge neutral">草稿</span>
				</div>
			</section>
			<section class="surface gallery-section">
				<div class="section-heading">
					<h2>表单与校验</h2>
					<span class="eyebrow">03 / INPUT</span>
				</div>
				<form @submit.prevent="validation = true">
					<div class="form-grid">
						<label class="field"
							>物品名称 <span aria-hidden="true">*</span
							><input
								v-model="input"
								placeholder="例如：东北珍珠米"
								:aria-invalid="validation && !input.trim()"
								:aria-describedby="
									validation && !input.trim()
										? 'gallery-name-error'
										: 'gallery-name-hint'
								"
							/><small
								v-if="validation && !input.trim()"
								id="gallery-name-error"
								class="text-danger"
								role="alert"
								>请填写物品名称，输入将保留。</small
							><small v-else id="gallery-name-hint" class="muted"
								>使用便于辨认的名称。</small
							></label
						><label class="field">数量<input type="number" value="12" min="1" /></label
						><label class="field">日期<input type="date" value="2026-10-11" /></label
						><label class="field"
							>类别<select>
								<option>食品</option>
								<option>服装</option>
								<option>日用品</option>
							</select></label
						>
					</div>
					<fieldset class="inline-options">
						<legend>库存范围</legend>
						<label><input v-model="radio" type="radio" value="all" />全部</label
						><label
							><input v-model="radio" type="radio" value="stock" />仅有库存</label
						>
					</fieldset>
					<label class="check-label"
						><input v-model="checkbox" type="checkbox" />启用批次管理</label
					><UiButton type="submit">检查输入</UiButton>
				</form>
			</section>
			<section class="surface gallery-section">
				<div class="section-heading">
					<h2>筛选与层级</h2>
					<span class="eyebrow">04 / FILTER</span>
				</div>
				<div class="segmented">
					<button
						v-for="name in ['明细', '记录']"
						:key="name"
						:aria-pressed="tab === name"
						@click="tab = name"
					>
						{{ name }}
					</button>
				</div>
				<p class="muted">当前展示：{{ tab }}。切换保留筛选条件。</p>
				<HierarchyFilter
					v-model="hierarchy"
					:options="warehouseNodes"
					title="仓库位置"
					placeholder="搜索房间或位置"
				/>
				<div class="chip-row">
					<button v-if="chipVisible" class="chip" @click="chipVisible = false">
						食品 ×</button
					><UiButton v-else variant="ghost" @click="chipVisible = true"
						>添加食品筛选</UiButton
					><span class="muted">已选 {{ hierarchy.length }} 个层级节点</span>
				</div>
			</section>
			<section class="surface gallery-section">
				<div class="section-heading">
					<h2>数量与物品</h2>
					<span class="eyebrow">05 / DATA</span>
				</div>
				<QuantitySummary
					:metrics="[
						{
							key: 'stock',
							label: '可用库存',
							quantities: [
								{ qty: 128, uom: '袋' },
								{ qty: 36, uom: '桶' },
							],
							icon: 'box',
						},
						{
							key: 'loan',
							label: '借出',
							quantities: [{ qty: 12, uom: '件' }],
							icon: 'loan',
						},
					]"
				/>
				<p class="muted">不同单位分别展示，避免把袋、桶、件相加。</p>
				<div class="image-samples">
					<PreviewProduct kind="rice" name="东北珍珠米" /><PreviewProduct
						kind="none"
						name="无图物品"
					/>
				</div>
				<UiButton variant="ghost" icon="open" @click="emit('inventory')"
					>体验完整库存卡片与表格</UiButton
				>
			</section>
			<section class="surface gallery-section">
				<div class="section-heading">
					<h2>状态与恢复</h2>
					<span class="eyebrow">06 / FEEDBACK</span>
				</div>
				<label class="field"
					>查看状态<select v-model="feedback">
						<option value="error">失败与重试</option>
						<option value="loading">首次加载</option>
						<option value="refresh">保留内容并刷新</option>
						<option value="empty">空状态</option>
						<option value="saved">保存成功</option>
					</select></label
				>
				<div v-if="feedback === 'error'" class="feedback-sample">
					<span class="badge danger">读取失败</span>
					<h3>内容暂时无法更新</h3>
					<p class="muted">已有内容与操作保持不变。</p>
					<UiButton
						@click="
							feedback = 'saved';
							emit('notify', '重试成功，内容已更新（模拟）');
						"
						>重试</UiButton
					>
				</div>
				<div v-else-if="feedback === 'loading'" class="feedback-sample" role="status">
					<span class="spinner" />正在加载…
					<div class="skeleton" />
					<div class="skeleton short" />
				</div>
				<div v-else-if="feedback === 'refresh'" class="feedback-sample">
					<p role="status"><span class="spinner" /> 正在更新…</p>
					<p class="refreshing">东北珍珠米 · 128 袋 · 斋堂 / A-01</p>
				</div>
				<div v-else-if="feedback === 'empty'" class="feedback-sample">
					<InventoryIcon name="box" />
					<h3>还没有记录</h3>
					<p class="muted">添加第一项物品，开始登记。</p>
					<UiButton @click="emit('receive')">新建入库</UiButton>
				</div>
				<div v-else class="notice-bar success" role="status">
					✓ 已保存，所有更改均已记录（模拟）。
				</div>
			</section>
			<section class="surface gallery-section">
				<div class="section-heading">
					<h2>弹层与附件</h2>
					<span class="eyebrow">07 / OVERLAY</span>
				</div>
				<p class="muted">对话框用于确认；抽屉用于上下文选择。关闭后回到原来的焦点。</p>
				<div class="button-row specimen-row">
					<UiButton @click="overlay = 'dialog'">打开对话框</UiButton
					><UiButton @click="overlay = 'drawer'">打开抽屉</UiButton
					><UiButton @click="emit('notify', '操作已完成。您可以继续处理下一项物资。')"
						>显示通知</UiButton
					>
				</div>
				<div class="attachment-row">
					<InventoryIcon name="card" />
					<div>
						<strong>捐赠物资清单.jpg</strong
						><small class="muted">附件示例 · 已添加</small>
					</div>
					<span class="badge success">完成</span>
				</div>
				<p class="muted">通知可手动关闭；失败信息同时留在对应操作附近。</p>
			</section>
			<section class="surface gallery-section">
				<div class="section-heading">
					<h2>间距与形状</h2>
					<span class="eyebrow">08 / RHYTHM</span>
				</div>
				<div class="spacing-scale">
					<div v-for="size in [4, 8, 12, 16, 24, 32]" :key="size">
						<span :style="{ width: `${size * 3}px` }" /><small>{{ size }}px</small>
					</div>
				</div>
				<p class="muted">4px 基础节奏。密度影响文字与留白，触控目标保持舒适。</p>
				<div class="shape-samples">
					<span class="control-shape">控件 {{ theme.radius }}</span
					><span class="card-shape">卡片 {{ theme.cardRadius }}</span
					><span class="badge neutral">状态胶囊</span>
				</div>
			</section>
		</div>
		<PreviewDenseLines />
		<section class="surface gallery-section detail-specimen">
			<div class="section-heading">
				<h2>只读详情 · 布局样本</h2>
				<span class="eyebrow">10 / DETAIL</span>
			</div>
			<div class="detail-specimen-layout">
				<PreviewItemImage :item="items[2]" />
				<div>
					<h3>{{ items[2].name }}</h3>
					<dl class="detail-list">
						<dt>物品编号</dt>
						<dd>{{ items[2].code }}</dd>
						<dt>类别</dt>
						<dd>{{ items[2].category }}</dd>
						<dt>可用库存</dt>
						<dd>{{ items[2].available }} {{ items[2].uom }}</dd>
					</dl>
					<p class="muted">
						展示图片、标题与字段层级。物品、交易、仓库详情和报表整页将在后续单独设计。
					</p>
				</div>
			</div>
		</section>
		<PreviewOverlay
			v-if="overlay"
			:title="overlay === 'drawer' ? '上下文选择' : '确认操作'"
			:drawer="overlay === 'drawer'"
			@close="overlay = ''"
			><p>这是交互样本，不删除或修改任何真实数据。</p>
			<label class="field"
				>备注<textarea rows="3" placeholder="输入内容，体验键盘操作" />
			</label>
			<p class="muted">支持 Escape、背景点击关闭与 Tab 焦点约束。</p>
			<template #footer
				><UiButton @click="overlay = ''">取消</UiButton
				><UiButton
					variant="primary"
					@click="
						overlay = '';
						emit('notify', '示例操作已确认');
					"
					>确认（模拟）</UiButton
				></template
			></PreviewOverlay
		>
	</div>
</template>
