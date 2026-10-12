<script setup lang="ts">
import { computed, reactive, ref, watch, onActivated, onDeactivated } from "vue";
import InventoryIcon from "../components/InventoryIcon.vue";
import PreviewUiButton from "./components/PreviewUiButton.vue";
import PreviewOverlay from "./PreviewOverlay.vue";
import { previewDate, warehouseNodes } from "./model";
import { previewPages, reviewSession } from "./reviewModel";

const props = withDefaults(
	defineProps<{
		page: string;
		variant: string;
		active?: boolean;
		density?: "compact" | "balanced" | "spacious";
	}>(),
	{
		active: true,
	},
);
const emit = defineEmits<{
	navigate: [page: string, variant: string];
	notify: [message: string];
	"update-density": [density: "compact" | "balanced" | "spacious"];
}>();
type ReportType = "movement" | "movement_records" | "current_stock" | "warehouse_stock" | "expiry";
const reports: { type: ReportType; title: string; description: string; fields: string }[] = [
	{
		type: "movement",
		title: "货物流动汇总",
		description: "按日期、动作、类别和位置查看完成的库存流动。",
		fields: "日期、操作、物品、数量、来源与去向",
	},
	{
		type: "movement_records",
		title: "货物流动记录",
		description: "查看草稿、完成或取消的操作记录。",
		fields: "日期、记录编号、类型、状态、物品行、活动",
	},
	{
		type: "current_stock",
		title: "当前库存",
		description: "查看筛选范围内的物品总量、批次和位置。",
		fields: "编码、名称、类别、数量、单位、位置",
	},
	{
		type: "warehouse_stock",
		title: "仓库库存",
		description: "查看一个仓库节点及其下属位置的实际库存。",
		fields: "位置、编码、名称、类别、数量、单位",
	},
	{
		type: "expiry",
		title: "效期风险",
		description: "查看全部、临期、逾期或自选日期范围的批次。",
		fields: "批次、物品、类别、到期日、位置、数量",
	},
];
const movementLabels: Record<string, string> = {
	Receive: "入库",
	Issue: "出库",
	Transfer: "转移",
	Loan: "借出",
	Return: "归还",
	Damage: "标记损坏",
	Loss: "记录遗失",
	Repair: "修复归库",
	Disposal: "正式报废",
	Reconcile: "盘点",
	Opening: "期初库存",
};
const state = reactive({
	type: "movement" as ReportType,
	search: "",
	category: "",
	warehouse: "",
	movementKind: "",
	period: "this_month",
	dateFrom: "",
	dateTo: "",
	expiryMode: "all",
	expiryDays: "30",
	expiryFrom: "",
	expiryTo: "",
	exportOpen: false,
	exportFailed: false,
	exportFormat: "CSV",
	settingsDensity: "balanced",
	setupChecked: false,
	recovery: "idle" as "idle" | "expired" | "restored",
});
watch(
	() => [props.page, props.variant],
	([page, variant]) => {
		const report = String(variant).replaceAll("-", "_") as ReportType;
		if (reports.some((candidate) => candidate.type === report)) state.type = report;
		if (page === "report-export") state.exportOpen = true;
	},
	{ immediate: true },
);
watch(
	() => props.active,
	(active) => {
		if (!active) state.exportOpen = false;
	},
);
onDeactivated(() => {
	state.exportOpen = false;
});
onActivated(() => {
	state.settingsDensity = props.density || "balanced";
});
watch(
	() => props.density,
	(density) => {
		if (density) state.settingsDensity = density;
	},
);
const title = computed(
	() =>
		({
			reports: "报表与导出",
			"report-export": "导出范围复核",
			more: "更多",
			settings: "显示偏好 · 预览",
			setup: "配置检查 · 预览",
			recovery: "会话恢复 · 预览",
			"auth-complete": "身份验证完成 · 预览",
		})[props.page] || "更多工具",
);
const selectedReport = computed(() => reports.find((report) => report.type === state.type)!);
const categoryValues = computed(() => [
	...new Set(reviewSession.stock.map((item) => item.category)),
]);
const movementRows = computed(() =>
	reviewSession.movements.filter((row) => {
		const query = state.search.trim().toLocaleLowerCase();
		const matchText =
			!query ||
			[row.name, row.itemName, row.code, row.activity || "", row.borrower || ""].some(
				(value) => value.toLocaleLowerCase().includes(query),
			);
		const matchKind = !state.movementKind || row.kind === state.movementKind;
		const item = reviewSession.stock.find((candidate) => candidate.code === row.code);
		const matchCategory = !state.category || item?.category === state.category;
		const matchWarehouse =
			!state.warehouse ||
			[row.from, row.to].some((value) => value.includes(state.warehouse));
		const start =
			state.period === "this_month" ? `${previewDate.slice(0, 7)}-01` : state.dateFrom;
		const matchDate =
			(!start || row.date >= start) && (!state.dateTo || row.date <= state.dateTo);
		return matchText && matchKind && matchCategory && matchWarehouse && matchDate;
	}),
);
const stockRows = computed(() =>
	reviewSession.stock.filter((item) => {
		const query = state.search.trim().toLocaleLowerCase();
		return (
			(!query || `${item.code} ${item.name}`.toLocaleLowerCase().includes(query)) &&
			(!state.category || item.category === state.category) &&
			(!state.warehouse ||
				item.locations.some((row) => row.location.includes(state.warehouse)))
		);
	}),
);
const expiryRows = computed(() =>
	reviewSession.stock.flatMap((item) =>
		item.locations.flatMap((location) =>
			(location.batches || [])
				.filter((batch) => {
					const query = state.search.trim().toLocaleLowerCase();
					const expiry = batch.expiry || "";
					const today = previewDate;
					const maxSoon = new Date(`${today}T00:00:00Z`);
					maxSoon.setUTCDate(
						maxSoon.getUTCDate() + Math.max(1, Number(state.expiryDays) || 30),
					);
					const soon =
						!!expiry &&
						expiry >= today &&
						expiry <= maxSoon.toISOString().slice(0, 10);
					const matchesMode =
						state.expiryMode === "all" ||
						(state.expiryMode === "soon" && soon) ||
						(state.expiryMode === "expired" && !!expiry && expiry < today) ||
						(state.expiryMode === "exact" &&
							!!expiry &&
							expiry >= state.expiryFrom &&
							expiry <= state.expiryTo);
					return (
						item.tracksExpiry &&
						batch.available > 0 &&
						!!expiry &&
						matchesMode &&
						(!query ||
							`${item.name} ${item.code} ${batch.id}`
								.toLocaleLowerCase()
								.includes(query)) &&
						(!state.category || item.category === state.category) &&
						(!state.warehouse || location.location.includes(state.warehouse))
					);
				})
				.map((batch) => ({
					...batch,
					name: item.name,
					code: item.code,
					category: item.category,
					location: location.location,
					uom: item.uom,
				})),
		),
	),
);
const rows = computed(() =>
	state.type === "movement" || state.type === "movement_records"
		? movementRows.value
		: state.type === "expiry"
			? expiryRows.value
			: stockLocationRows.value,
);
const stockLocationRows = computed(() =>
	stockRows.value.flatMap((item) =>
		item.locations
			.filter((location) => !state.warehouse || location.location.includes(state.warehouse))
			.map((location) => ({ item, location })),
	),
);
const canExport = computed(() => state.type !== "warehouse_stock" || !!state.warehouse);
function chooseReport(type: ReportType) {
	state.type = type;
	state.exportOpen = false;
}
function openExport() {
	if (!canExport.value) {
		emit("notify", "请选择一个仓库节点后查看导出范围");
		return;
	}
	if (
		state.type === "expiry" &&
		state.expiryMode === "exact" &&
		(!state.expiryFrom || !state.expiryTo || state.expiryFrom > state.expiryTo)
	) {
		emit("notify", "请选择有效的效期开始和结束日期");
		return;
	}
	state.exportOpen = true;
	state.exportFailed = false;
}
function simulateExport() {
	if (state.exportFailed) {
		state.exportFailed = false;
		emit("notify", `已模拟生成 ${rows.value.length} 条${state.exportFormat}记录`);
	} else {
		state.exportFailed = true;
	}
}
function navigateByKey(key: string) {
	const target = previewPages.find((route) => route.key === key);
	if (target) emit("navigate", target.page, target.variant);
}
function recoverSession() {
	if (state.recovery === "restored" || props.page === "auth-complete") {
		emit("navigate", "drafts", "open");
		return;
	}
	state.recovery = "restored";
	emit("notify", "示例会话已恢复，草稿输入仍保留");
}
function checkSetup() {
	state.setupChecked = true;
	emit("notify", "配置检查已完成（仅显示预览反馈）");
}
function updateDensity(density: "compact" | "balanced" | "spacious") {
	state.settingsDensity = density;
	document.documentElement.dataset.previewDensity = density;
	emit("update-density", density);
}
</script>

<template>
	<section class="preview-utility-page">
		<header class="utility-heading">
			<div>
				<span class="eyebrow">UTILITY WORKFLOW · PREVIEW</span>
				<h1>{{ title }}</h1>
				<p class="muted">功能与反馈均为可交互样本，不连接账户设置或服务端。</p>
			</div>
			<span class="utility-sample-tag">预览样本</span>
		</header>
		<template v-if="page === 'reports' || page === 'report-export'">
			<div v-if="page === 'reports'" class="report-catalog">
				<button
					v-for="report in reports"
					:key="report.type"
					class="report-card surface"
					:aria-pressed="state.type === report.type"
					@click="chooseReport(report.type)"
				>
					<span class="report-card-icon"><InventoryIcon name="table" /></span
					><span
						><strong>{{ report.title }}</strong
						><small>{{ report.description }}</small
						><em>固定字段：{{ report.fields }}</em></span
					><span aria-hidden="true">→</span>
				</button>
			</div>
			<section class="surface report-workspace">
				<div class="report-toolbar">
					<div>
						<h2>{{ selectedReport.title }}</h2>
						<p class="muted">调整条件后，样本结果与导出复核范围会同步变化。</p>
					</div>
					<PreviewUiButton variant="primary" icon="download" @click="openExport"
						>复核并导出</PreviewUiButton
					>
				</div>
				<div class="report-filters">
					<label
						>搜索<input
							v-model="state.search"
							type="search"
							placeholder="物品、编号或活动"
					/></label>
					<label
						>物品类别<select v-model="state.category">
							<option value="">全部类别</option>
							<option v-for="category in categoryValues" :key="category">
								{{ category }}
							</option>
						</select></label
					>
					<label
						>仓库 / 位置<select v-model="state.warehouse">
							<option value="">全部位置</option>
							<option
								v-for="node in warehouseNodes"
								:key="node.name"
								:value="node.name"
							>
								{{ node.label }}
							</option>
						</select></label
					>
					<template v-if="state.type === 'movement' || state.type === 'movement_records'"
						><label
							>操作类型<select v-model="state.movementKind">
								<option value="">全部操作</option>
								<option
									v-for="kind in [
										'Receive',
										'Issue',
										'Transfer',
										'Loan',
										'Return',
										'Damage',
										'Loss',
										'Repair',
										'Disposal',
									]"
									:key="kind"
									:value="kind"
								>
									{{ movementLabels[kind] }}
								</option>
							</select></label
						><label
							>日期范围<select v-model="state.period">
								<option value="this_month">本月</option>
								<option value="custom">自选日期</option>
							</select></label
						><template v-if="state.period === 'custom'"
							><label>开始日期<input v-model="state.dateFrom" type="date" /></label
							><label
								>结束日期<input
									v-model="state.dateTo"
									type="date" /></label></template
					></template>
					<template v-if="state.type === 'expiry'"
						><label
							>效期范围<select v-model="state.expiryMode">
								<option value="all">全部有效库存批次</option>
								<option value="soon">即将到期</option>
								<option value="expired">已过期</option>
								<option value="exact">指定日期范围</option>
							</select></label
						><label v-if="state.expiryMode === 'soon'"
							>临期天数<input
								v-model="state.expiryDays"
								type="number"
								min="1" /></label
						><template v-if="state.expiryMode === 'exact'"
							><label>到期日从<input v-model="state.expiryFrom" type="date" /></label
							><label
								>到期日到<input
									v-model="state.expiryTo"
									type="date" /></label></template
					></template>
					<p v-if="state.type === 'warehouse_stock'" class="filter-note">
						仓库库存报表必须选择一个具体仓库或位置。
					</p>
				</div>
				<div class="report-result-heading">
					<strong>筛选结果</strong><span>{{ rows.length }} 条样本记录</span>
				</div>
				<div class="report-table-wrap">
					<table>
						<thead>
							<tr>
								<th
									v-if="
										state.type === 'movement' ||
										state.type === 'movement_records'
									"
								>
									日期
								</th>
								<th
									v-if="
										state.type === 'movement' ||
										state.type === 'movement_records'
									"
								>
									操作
								</th>
								<th>物品 / 记录</th>
								<th>类别 / 状态</th>
								<th>位置</th>
								<th>数量</th>
							</tr>
						</thead>
						<tbody>
							<template
								v-if="
									state.type === 'movement' || state.type === 'movement_records'
								"
								><tr v-for="row in movementRows" :key="row.name">
									<td>{{ row.date }}</td>
									<td>{{ movementLabels[row.kind] || row.kind }}</td>
									<td>
										{{ row.itemName }}<small>{{ row.name }}</small>
									</td>
									<td>
										{{
											row.docstatus === 1
												? "已完成"
												: row.docstatus === 0
													? "草稿"
													: "已取消"
										}}
									</td>
									<td>{{ row.from }} → {{ row.to }}</td>
									<td>{{ row.qty }} {{ row.uom }}</td>
								</tr></template
							>
							<template
								v-else-if="
									state.type === 'current_stock' ||
									state.type === 'warehouse_stock'
								"
								><tr
									v-for="row in stockLocationRows"
									:key="row.item.code + row.location.location"
								>
									<td>
										{{ row.item.name }}<small>{{ row.item.code }}</small>
									</td>
									<td>{{ row.item.category }}</td>
									<td>{{ row.location.location }}</td>
									<td>{{ row.location.available }} {{ row.item.uom }}</td>
								</tr></template
							>
							<template v-else
								><tr
									v-for="row in expiryRows"
									:key="row.code + row.id + row.location"
								>
									<td>
										{{ row.name
										}}<small
											>{{ row.code }} · {{ row.id }} · 到期
											{{ row.expiry }}</small
										>
									</td>
									<td>{{ row.category }}</td>
									<td>{{ row.location }}</td>
									<td>{{ row.available }} {{ row.uom }}</td>
								</tr></template
							>
							<tr v-if="!rows.length">
								<td colspan="6" class="report-empty">
									当前条件下没有匹配的预览记录。
								</td>
							</tr>
						</tbody>
					</table>
				</div>
			</section>
			<PreviewOverlay
				v-if="state.exportOpen"
				title="确认导出范围"
				@close="state.exportOpen = false"
				><p>{{ selectedReport.title }} · 依据当前全部筛选条件</p>
				<label
					>文件格式<select v-model="state.exportFormat">
						<option>CSV</option>
						<option>XLSX</option>
					</select></label
				>
				<div class="export-scope">
					<strong>{{ rows.length }} 条结果</strong
					><small>字段：{{ selectedReport.fields }}</small
					><small v-if="state.warehouse">位置：{{ state.warehouse }}</small
					><small v-if="state.search">搜索：{{ state.search }}</small>
				</div>
				<p v-if="state.exportFailed" class="utility-error" role="alert">
					模拟导出失败，筛选和输入内容已保留，可重试。
				</p>
				<template #footer
					><PreviewUiButton variant="secondary" @click="state.exportOpen = false"
						>返回修改</PreviewUiButton
					><PreviewUiButton variant="primary" @click="simulateExport">{{
						state.exportFailed ? "重试导出" : "模拟导出"
					}}</PreviewUiButton></template
				></PreviewOverlay
			>
		</template>
		<template v-else-if="page === 'more'"
			><section class="more-grid">
				<button
					v-for="route in previewPages.filter((entry) =>
						[
							'reports/overview',
							'pending/actionable',
							'drafts/open',
							'settings/density',
							'setup/warehouse',
							'recovery/session',
							'auth-complete/session',
						].includes(entry.key),
					)"
					:key="route.key"
					class="more-card surface"
					@click="navigateByKey(route.key)"
				>
					<span><InventoryIcon name="adjust" /></span><strong>{{ route.label }}</strong
					><small>{{ route.path }} · 本地预览</small></button
				><button
					class="more-card surface"
					@click="emit('notify', '安装指引已在预览中打开')"
				>
					<span><InventoryIcon name="download" /></span><strong>安装到设备</strong
					><small>显示安装引导样本</small>
				</button>
			</section></template
		>
		<template v-else-if="page === 'settings'"
			><section class="surface utility-panel">
				<h2>显示密度</h2>
				<p class="muted">此处只改变预览显示，不会保存到账户。</p>
				<div class="density-choice">
					<label
						v-for="option in [
							{ value: 'compact', label: '紧凑' },
							{ value: 'balanced', label: '均衡' },
							{ value: 'spacious', label: '宽松' },
						]"
						:key="option.value"
						><input
							type="radio"
							name="preview-density"
							:value="option.value"
							:checked="state.settingsDensity === option.value"
							@change="
								updateDensity(option.value as 'compact' | 'balanced' | 'spacious')
							"
						/><span>{{ option.label }}</span></label
					>
				</div>
				<PreviewUiButton
					variant="primary"
					@click="emit('notify', `预览密度：${state.settingsDensity}；不写入账户设置`)"
					>应用于此预览</PreviewUiButton
				>
			</section></template
		>
		<template v-else-if="page === 'setup'"
			><section class="surface utility-panel">
				<h2>配置就绪检查</h2>
				<p class="muted">模拟反馈样本，不会调用正式配置接口。</p>
				<ul class="setup-list">
					<li>仓库与位置示例 <span>已就绪</span></li>
					<li>物品分类示例 <span>已就绪</span></li>
					<li>
						用户权限样例 <span>{{ state.setupChecked ? "检查完成" : "待检查" }}</span>
					</li>
				</ul>
				<PreviewUiButton variant="primary" @click="checkSetup">{{
					state.setupChecked ? "再次检查" : "模拟检查配置"
				}}</PreviewUiButton>
			</section></template
		>
		<template v-else-if="page === 'recovery' || page === 'auth-complete'"
			><section class="surface utility-panel recovery-panel">
				<span class="recovery-mark"
					><InventoryIcon
						:name="
							state.recovery === 'restored' || page === 'auth-complete'
								? 'check'
								: 'notice'
						"
				/></span>
				<h2>
					{{
						state.recovery === "restored" || page === "auth-complete"
							? "已恢复到预览会话"
							: "登录状态已过期"
					}}
				</h2>
				<p>输入的表单与草稿保留在本次预览会话中；恢复过程使用模拟反馈。</p>
				<div v-if="state.recovery === 'expired'" class="utility-error" role="alert">
					网络恢复后可以继续，不需要重新录入。
				</div>
				<PreviewUiButton variant="primary" @click="recoverSession">{{
					state.recovery === "restored" || page === "auth-complete"
						? "返回刚才的工作"
						: "模拟验证并继续"
				}}</PreviewUiButton
				><button class="utility-link" @click="navigateByKey('drafts/open')">
					查看保留的草稿样本
				</button>
			</section></template
		>
	</section>
</template>
