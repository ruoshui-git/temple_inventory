"""Development-only native catalog, stock documents, and count review examples.

No workspace, custom loan ledger, virtual warehouse or runtime fixture is used.
The caller owns commit/rollback. Ordinary hooks and permissions remain enabled.
"""

# ruff: noqa: RUF001 — Chinese sample descriptions are intentional.

import random
import re
from contextvars import ContextVar
from datetime import timedelta
from decimal import Decimal

import frappe
from erpnext.stock.utils import get_stock_balance
from frappe.utils import getdate, nowdate

from temple_inventory import activities, catalog, configuration, conversions, counts, native_api, warehouses
from temple_inventory.item_code import allocate_item_code
from temple_inventory.native_stock import loan_balances
from temple_inventory.sample_media import ASSETS, ATTACHMENT_CONTENT, costume_catalog, generated_images
from temple_inventory.sample_media import catalog as sample_catalog

REQUEST_PREFIX = "temple-native-samples:v1:"
SAMPLE_ACTIVITY_TITLE = "秋季演出与物资周转"
SAMPLE_MEAL_ACTIVITY_TITLE = "社区共餐物资配送"
SAMPLE_HISTORY_ACTIVITY_TITLE = "库位物资周转"
_SITE_DATE = ContextVar("temple_inventory_sample_site_date", default=None)
EXPIRY_OFFSETS = (-1, -30, -31, -60, -90, -91, 0, 30, 31, 60, 90, 91, 120, 180, -120, -365, 45, 1)
MANUFACTURING_OFFSETS = (
	-500,
	-600,
	-730,
	-700,
	-650,
	-730,
	-430,
	-540,
	-420,
	-600,
	-540,
	-650,
	-730,
	-700,
	-600,
	-730,
	-650,
	-500,
)
BORROWERS = (
	"活动服务团队",
	"演出团队",
	"斋堂义工组",
	"法会筹备组",
	"王建国",
	"林慧",
	"社区共餐志愿队",
	"园林维护组",
	"陈师傅",
	"青年团契",
)
EXTRA_ITEMS = (
	("N-WORKFLOW", "活动周转箱", "Nos", False, False),
	("N-ZERO", "备用展示支架（暂无库存）", "Nos", False, False),
	("N-WEIGHT", "散装活动用米", "Kg", False, False),
	("N-UNDATED", "无效期批次耗材", "Nos", True, False),
)

GENERATED_PRODUCTS = {
	"日常用品": (
		"扫帚",
		"拖把",
		"水桶",
		"垃圾袋",
		"抽纸",
		"卷纸",
		"洗手液",
		"消毒液",
		"电池",
		"灯泡",
		"插线板",
		"毛巾",
		"雨伞",
		"抹布",
		"清洁刷",
	),
	"厨房物资": (
		"不锈钢汤锅",
		"炒锅",
		"砧板",
		"菜刀",
		"食用油",
		"蒸笼",
		"保鲜盒",
		"大米",
		"漏勺",
		"汤勺",
		"洗洁精",
		"电饭煲",
		"酱油",
		"米醋",
		"一次性手套",
	),
	"法会用品": (
		"香炉",
		"烛台",
		"供杯",
		"供盘",
		"蒲团",
		"拜垫",
		"木鱼",
		"引磬",
		"经幡",
		"盘香",
		"酥油灯",
		"莲花灯",
		"檀香",
		"经书架",
		"佛前供花瓶",
	),
	"办公物资": (
		"A4打印纸",
		"签字笔",
		"文件夹",
		"订书机",
		"便签",
		"计算器",
		"胶带",
		"剪刀",
		"记事本",
		"印泥",
		"档案盒",
		"白板笔",
		"标签贴纸",
		"文件袋",
		"复印纸",
	),
}
GENERATED_PRODUCT_SPECS = {
	"扫帚": ("木柄 1.2m", "木柄 1.5m", "硬毛", "软毛", "室外款", "加宽 40cm", "塑料柄", "替换扫头"),
	"拖把": ("平板 40cm", "平板 60cm", "旋转款", "棉线款", "超细纤维", "加长杆", "替换拖布", "家用型"),
	"水桶": ("8L", "10L", "12L 带盖", "15L", "20L 加厚", "不锈钢 8L", "带刻度", "塑料提手"),
	"垃圾袋": (
		"45×50cm 100只",
		"60×80cm 50只",
		"加厚 80×100cm",
		"背心袋",
		"平口袋",
		"黑色",
		"透明",
		"大号 90×110cm",
	),
	"抽纸": ("100抽", "200抽", "原生木浆", "无香型", "三层加厚", "盒装 120抽", "便携装 40抽", "竹浆"),
	"卷纸": ("3层 12卷", "4层 10卷", "卷筒 180g", "大卷商用", "无芯款", "原生木浆", "加厚款", "竹浆"),
	"洗手液": ("300ml", "500ml", "补充装 1L", "泡沫型", "柠檬香", "无香型", "抑菌型", "按压瓶"),
	"消毒液": (
		"75%酒精 500ml",
		"75%酒精 1L",
		"含氯 1L",
		"喷雾 500ml",
		"补充装 2L",
		"无香型",
		"便携装 100ml",
		"浓缩型",
	),
	"电池": ("AA 4节装", "AAA 4节装", "5号 8节装", "7号 8节装", "碱性", "充电电池", "1.5V", "大容量"),
	"灯泡": ("LED 9W E27", "LED 12W E27", "暖白", "正白", "球泡 7W", "筒灯 5W", "GU10 7W", "节能型"),
	"插线板": ("3位 1.8m", "5位 3m", "6位带开关", "USB双口", "过载保护", "国标插孔", "1.5m", "防雷款"),
	"毛巾": ("纯棉 34×75cm", "纯棉 70×140cm", "速干款", "加厚款", "白色", "黄色", "吸水款", "双层纱"),
	"雨伞": ("三折款", "直杆 60cm", "自动开收", "晴雨两用", "黑色", "大号 70cm", "儿童款", "防风款"),
	"抹布": ("超细纤维 30×30cm", "纯棉 40×40cm", "加厚款", "吸水款", "蓝色", "黄色", "厨房专用", "10条装"),
	"清洁刷": ("长柄锅刷", "硬毛 5cm", "软毛 8cm", "杯刷 30cm", "地刷 25cm", "缝隙刷", "木柄款", "替换刷头"),
	"不锈钢汤锅": ("24cm", "28cm", "32cm", "双耳加厚", "带盖 26cm", "加深 30cm", "复底 28cm", "商用 36cm"),
	"炒锅": (
		"30cm 熟铁",
		"32cm 不粘",
		"34cm 炒锅",
		"带盖 32cm",
		"平底 28cm",
		"双耳 36cm",
		"窒化铁",
		"轻量款 30cm",
	),
	"砧板": (
		"木质 30×20cm",
		"木质 40×30cm",
		"塑料 35×25cm",
		"双面款",
		"加厚 3cm",
		"竹制 38cm",
		"圆形 30cm",
		"商用 50×35cm",
	),
	"菜刀": ("切片刀", "斩骨刀", "小号", "中号 18cm", "大号 20cm", "不锈钢", "三德刀", "木柄款"),
	"食用油": ("5L", "10L", "1.8L", "菜籽油 5L", "花生油 5L", "大豆油 10L", "玉米油 5L", "食用调和油 4L"),
	"蒸笼": ("26cm", "28cm", "30cm", "竹制两层", "竹制三层", "不锈钢 28cm", "带盖 32cm", "加深款"),
	"保鲜盒": ("500ml", "750ml", "1L", "1.5L", "长方形 2L", "玻璃 800ml", "四件套", "带密封圈"),
	"大米": ("5kg", "10kg", "东北大米 5kg", "糯米 2.5kg", "籼米 10kg", "粳米 5kg", "真空装 2kg", "散装优选"),
	"漏勺": ("12cm", "16cm", "20cm", "细孔款", "不锈钢长柄", "油炸滤勺", "加深款", "双耳款"),
	"汤勺": (
		"不锈钢 30cm",
		"不锈钢 35cm",
		"木柄 28cm",
		"汤勺 10cm",
		"大号 12cm",
		"长柄 40cm",
		"双层隔热",
		"商用加深",
	),
	"洗洁精": ("500ml", "1L", "2L补充装", "柠檬香", "无香型", "浓缩型", "按压瓶", "商用 5L"),
	"电饭煲": ("3L", "4L", "5L", "6L商用", "智能预约", "不粘内胆", "IH加热 4L", "小型 2L"),
	"酱油": (
		"生抽 500ml",
		"老抽 500ml",
		"生抽 1L",
		"零添加 500ml",
		"酿造酱油",
		"蒸鱼豉油 500ml",
		"低盐型",
		"商用 5L",
	),
	"米醋": ("500ml", "1L", "糯米酿造", "陈酿 500ml", "白米醋", "有机米醋", "无添加", "商用 2L"),
	"一次性手套": (
		"S码 100只",
		"M码 100只",
		"L码 100只",
		"加厚款",
		"食品级",
		"PE款 200只",
		"乳胶款",
		"透明款",
	),
	"香炉": ("铜制 12cm", "铜制 18cm", "陶瓷 15cm", "三足款", "带盖款", "小号 10cm", "大号 24cm", "香道款"),
	"烛台": ("黄铜 18cm", "黄铜 25cm", "一对装", "单支款", "莲花底座", "不锈钢款", "高脚 30cm", "小号 12cm"),
	"供杯": ("玻璃 60ml", "玻璃 100ml", "青瓷 80ml", "一对装", "三件套", "带盖款", "莲花纹", "不锈钢款"),
	"供盘": ("直径 18cm", "直径 24cm", "黄铜款", "白瓷款", "莲花纹", "浅口 20cm", "一对装", "不锈钢 28cm"),
	"蒲团": ("黄色", "红色", "加厚 40cm", "圆形 45cm", "棉麻面", "高密度填充", "深蓝色", "可拆洗"),
	"拜垫": ("加厚 40cm", "跪垫 45×70cm", "红色", "黄色", "防滑底", "棉麻面", "高密度填充", "可折叠"),
	"木鱼": ("小号 10cm", "中号 15cm", "大号 20cm", "榉木款", "含鱼槌", "檀木色", "法会用", "加厚音腔"),
	"引磬": ("铜制 8cm", "铜制 10cm", "含磬槌", "木柄款", "法会用", "小号", "加厚款", "便携套装"),
	"经幡": ("五色 5m", "五色 10m", "五色 20m", "棉布款", "涤纶款", "户外加厚", "经文印花", "宽幅 30cm"),
	"盘香": ("4小时", "8小时", "12小时", "24小时", "檀香味", "沉香味", "无烟款", "小盘 20枚"),
	"酥油灯": ("玻璃杯装", "供灯 100ml", "黄铜灯盏", "陶瓷款", "一对装", "小号 8cm", "加厚灯芯", "耐热杯"),
	"莲花灯": ("粉色 12cm", "黄色 12cm", "红色 15cm", "电池款", "插电款", "七彩灯", "供桌款", "可遥控"),
	"檀香": ("线香 21cm", "线香 30cm", "盘香款", "天然檀香", "无烟款", "短支 15cm", "100支装", "礼佛用"),
	"经书架": ("木制 30cm", "木制 40cm", "折叠款", "双层款", "红木色", "竹制款", "可调角度", "加宽 50cm"),
	"佛前供花瓶": ("青瓷 20cm", "白瓷 25cm", "一对装", "莲花纹", "铜制款", "小号 15cm", "高脚款", "粉彩款"),
	"A4打印纸": ("70g 500张", "80g 500张", "彩色", "70g 10包箱", "80g 5包箱", "双面打印", "亮白款", "再生纸"),
	"签字笔": (
		"0.5mm黑色",
		"0.5mm蓝色",
		"0.7mm黑色",
		"按动款",
		"中性笔 12支装",
		"速干款",
		"红色 12支装",
		"商务礼盒",
	),
	"文件夹": ("A4单夹", "A4双夹", "透明封面", "加厚款", "蓝色", "抽杆款", "多页插袋", "10个装"),
	"订书机": ("10号", "12号", "省力型", "金属款", "迷你款", "可订 25页", "重型款", "附订书针"),
	"便签": ("76×76mm", "黄色 100张", "彩色 5本装", "荧光款", "横线款", "便携 50×50mm", "可再贴", "加厚纸"),
	"计算器": ("12位桌面款", "8位便携款", "双电源", "太阳能款", "金融型", "大屏幕", "静音按键", "带税率功能"),
	"胶带": (
		"透明 18mm",
		"透明 24mm",
		"宽幅 48mm",
		"双面胶 12mm",
		"美纹纸 24mm",
		"封箱胶带",
		"可手撕款",
		"6卷装",
	),
	"剪刀": (
		"办公 17cm",
		"不锈钢 21cm",
		"小号 13cm",
		"圆头安全款",
		"左手款",
		"裁纸 24cm",
		"防滑手柄",
		"多用途",
	),
	"记事本": ("A5横线", "A6便携", "B5方格", "硬壳 80页", "软抄 60页", "线圈装", "空白页", "皮面款"),
	"印泥": ("红色 80mm", "红色 100mm", "蓝色", "快干型", "朱砂色", "小号 60mm", "海绵垫", "带盒装"),
	"档案盒": ("A4 3cm", "A4 5cm", "A4 7.5cm", "加厚 PP", "蓝色", "带标签槽", "牛皮纸款", "10个装"),
	"白板笔": ("黑色 2mm", "蓝色 2mm", "红色 2mm", "可擦式", "圆头款", "斜头款", "4色套装", "补充墨水款"),
	"标签贴纸": (
		"A4 24格",
		"A4 40格",
		"热敏 50×30mm",
		"白色不干胶",
		"彩色圆点",
		"防水款",
		"可书写",
		"100张装",
	),
	"文件袋": ("A4透明", "A4拉链款", "牛津布", "防水款", "按扣式", "加厚 0.3mm", "蓝色", "10个装"),
	"复印纸": ("70g 500张", "80g 500张", "A4 10包箱", "A3 500张", "高白度", "双面打印", "再生纸", "彩色款"),
}
GENERATED_UNITS = ("Nos", "Pair", "Set", "Box", "包", "瓶", "Litre", "Meter", "张", "Kg")
GENERATED_PRODUCT_UOM = {
	"扫帚": "Nos",
	"拖把": "Set",
	"水桶": "Nos",
	"垃圾袋": "Box",
	"抽纸": "包",
	"卷纸": "包",
	"洗手液": "瓶",
	"消毒液": "Litre",
	"电池": "包",
	"灯泡": "Nos",
	"插线板": "Set",
	"毛巾": "张",
	"雨伞": "Nos",
	"抹布": "包",
	"清洁刷": "Nos",
	"不锈钢汤锅": "Set",
	"炒锅": "Nos",
	"砧板": "Nos",
	"菜刀": "Nos",
	"食用油": "Litre",
	"蒸笼": "Set",
	"保鲜盒": "Set",
	"大米": "Kg",
	"漏勺": "Nos",
	"汤勺": "Nos",
	"洗洁精": "Litre",
	"电饭煲": "Set",
	"酱油": "瓶",
	"米醋": "瓶",
	"一次性手套": "Pair",
	"香炉": "Set",
	"烛台": "Pair",
	"供杯": "Set",
	"供盘": "Set",
	"蒲团": "Nos",
	"拜垫": "Nos",
	"木鱼": "Nos",
	"引磬": "Nos",
	"经幡": "Meter",
	"盘香": "包",
	"酥油灯": "Nos",
	"莲花灯": "Nos",
	"檀香": "包",
	"经书架": "Set",
	"佛前供花瓶": "Nos",
	"A4打印纸": "张",
	"签字笔": "Box",
	"文件夹": "包",
	"订书机": "Nos",
	"便签": "包",
	"计算器": "Nos",
	"胶带": "包",
	"剪刀": "Nos",
	"记事本": "Nos",
	"印泥": "Set",
	"档案盒": "Nos",
	"白板笔": "包",
	"标签贴纸": "张",
	"文件袋": "包",
	"复印纸": "张",
}


def generated_product_rows(count=436):
	"""Return deterministic realistic names and product keys for generated Items."""
	products = [(group, name) for group, names in GENERATED_PRODUCTS.items() for name in names]
	rows = []
	product_indices = {}
	for index in range(count):
		group, base_name = products[index % len(products)]
		variant_index = product_indices.get(base_name, 0)
		product_indices[base_name] = variant_index + 1
		spec = GENERATED_PRODUCT_SPECS[base_name][variant_index % len(GENERATED_PRODUCT_SPECS[base_name])]
		name = f"{base_name} {spec}"
		if (index + 1) % 7 == 0:
			name = {
				"日常用品": f"寺院客堂及公共区域日常保洁备用{base_name}{spec}物资",
				"厨房物资": f"寺院斋堂共餐及厨房备餐用{base_name}{spec}用品",
				"法会用品": f"大殿供奉及法会仪轨活动使用{base_name}{spec}物资",
				"办公物资": f"寺院库房台账和日常办公用{base_name}{spec}物资",
			}[group]
		rows.append(
			{
				"key": f"V{index + 1:04d}",
				"group": group,
				"base_key": f"P{products.index((group, base_name)) + 1:02d}",
				"base_name": base_name,
				"spec": spec,
				"item_name": name,
				"stock_uom": GENERATED_PRODUCT_UOM[base_name],
				"uncategorized": (index + 1) % 17 == 0,
				"batch_tracked": (index + 1) % 20 == 0,
				"has_alternate_uom": (index + 1) % 8 == 0,
			}
		)
	return rows


def generated_alternate_conversion(product):
	"""Return a plausible alternate stock conversion for one generated product."""
	stock_uom = product["stock_uom"]
	spec = product["spec"]
	if stock_uom == "Nos":
		return "Box", 12
	if stock_uom == "Pair":
		return "包", 50
	if stock_uom == "Set":
		return "Box", 6
	if stock_uom == "Box":
		return "包", 10
	if stock_uom == "包":
		return "Box", 10
	if stock_uom == "瓶":
		return "Box", 12
	if stock_uom == "Litre":
		milliliters = re.search(r"(\d+(?:\.\d+)?)\s*ml\b", spec, re.IGNORECASE)
		liters = re.search(r"(\d+(?:\.\d+)?)\s*L\b", spec, re.IGNORECASE)
		factor = (
			float(milliliters.group(1)) / 1000 if milliliters else float(liters.group(1)) if liters else 1
		)
		return "瓶", factor
	if stock_uom == "Meter":
		length = re.search(r"(\d+(?:\.\d+)?)\s*m\b", spec, re.IGNORECASE)
		factor = float(length.group(1)) if length else 5
		return "Nos", factor
	if stock_uom == "张":
		pack_size = re.search(r"(\d+)\s*张", spec)
		return "包", int(pack_size.group(1)) if pack_size else 500
	if stock_uom == "Kg":
		weight = re.search(r"(\d+(?:\.\d+)?)\s*kg\b", spec, re.IGNORECASE)
		return "包", float(weight.group(1)) if weight else 5
	raise ValueError(f"generated product has no alternate conversion: {product['base_name']}")


def _physical_leaves(company, root):
	"""Resolve enabled physical leaves below the configured root at runtime."""
	settings = frappe.get_single("Temple Inventory Settings")
	rows = frappe.get_all(
		"Warehouse",
		filters={
			"company": company,
			"is_group": 0,
			"disabled": 0,
			"lft": [">=", frappe.db.get_value("Warehouse", root, "lft")],
			"rgt": ["<=", frappe.db.get_value("Warehouse", root, "rgt")],
		},
		fields=["name", "ti_label", "ti_direct_storage", "parent_warehouse"],
	)
	blocked = {
		root,
		settings.root_warehouse,
		settings.physical_root_warehouse,
		settings.leased_warehouse,
		settings.damaged_warehouse,
	}
	return [row for row in rows if row.name not in blocked]


def _category_affinity(company, rooms):
	"""Build category leaf pools from current warehouse labels, never docnames."""
	settings = frappe.get_single("Temple Inventory Settings")
	leaves = _physical_leaves(company, settings.physical_root_warehouse)
	by_label = {}
	for row in leaves:
		label = row.ti_label
		if row.ti_direct_storage:
			label = frappe.db.get_value("Warehouse", row.parent_warehouse, "ti_label") or label
		by_label.setdefault(label, []).append(row.name)

	def choose(*labels):
		return [name for label in labels for name in by_label.get(label, [])]

	shared = {
		"食品": choose("冷藏柜", "上层", "下层", "干货架A", "干货架B", "干货架C", "干货架D"),
		"厨房物资": choose("冷藏柜", "上层", "下层", "干货架A", "干货架B", "干货架C", "干货架D"),
		"餐具与耗材": choose("餐具间", "厨房"),
		"佛事用品": choose(
			"供桌柜1", "供桌柜2", "供桌柜3", "第1格", "第2格", "第3格", "第4格", "第5格", "第6格", "大殿"
		),
		"法会用品": choose(
			"供桌柜1", "供桌柜2", "供桌柜3", "第1格", "第2格", "第3格", "第4格", "第5格", "第6格", "大殿"
		),
		"节日装饰": choose("法物流通处临时周转货架（节庆期间使用）", "广场帐篷A", "广场帐篷B"),
		"工具与设备": choose("106", "201", "C06", "C07"),
		"园艺与户外": choose("106", "201", "C06", "C07"),
		"建筑维护": choose("106", "201", "C06", "C07"),
		"电子与科技": choose("A07", "A14"),
		"办公物资": choose("A07", "A14"),
		"日常用品": choose("A02", "货架1", "货架2", "B01b", "临时存放", "A04"),
		"美妆个护": choose("B01b", "临时存放", "A04"),
		"药品与健康": choose("B01b", "临时存放", "A04"),
		"服装与纺织品": choose("B01b", "临时存放", "A04"),
		"无分类": choose("临时存放"),
	}
	all_leaves = [row.name for row in leaves]
	return {**{key: value for key, value in shared.items() if value}, "__default__": all_leaves}, all_leaves


def _leaf_neighbors(company, physical_root, leaves):
	root_bounds = frappe.db.get_value("Warehouse", physical_root, ["lft", "rgt"], as_dict=True)
	rows = frappe.get_all(
		"Warehouse",
		filters={
			"company": company,
			"lft": [">=", root_bounds.lft],
			"rgt": ["<=", root_bounds.rgt],
		},
		fields=["name", "parent_warehouse"],
	)
	parents = {row.name: row.parent_warehouse for row in rows}
	area_by_leaf = {}
	for leaf in leaves:
		cursor = leaf
		while parents.get(cursor) and parents[cursor] != physical_root:
			cursor = parents[cursor]
		area_by_leaf[leaf] = cursor
	return {
		leaf: [other for other in leaves if other != leaf and area_by_leaf[other] == area]
		for leaf, area in area_by_leaf.items()
	}


def _balance_change(balances, item_key, warehouse, quantity, batch=None):
	"""Apply one movement to the per-item, location and optional batch tracker."""
	key = (item_key, warehouse, batch)
	updated = balances.get(key, Decimal("0")) + Decimal(str(quantity))
	if updated < 0:
		raise ValueError(f"Sample generator would make {key!r} negative: {updated}")
	balances[key] = updated
	return updated


def _quantity_parts(quantity, count, whole):
	if whole:
		base, remainder = divmod(int(quantity), count)
		return [base + (1 if index < remainder else 0) for index in range(count)]
	amount = Decimal(str(quantity))
	part = (amount / count).quantize(Decimal("0.001"))
	parts = [part] * count
	parts[-1] = amount - sum(parts[:-1])
	return parts


def _date(days, origin=None):
	return str(getdate(origin or _SITE_DATE.get() or nowdate()) + timedelta(days=days))


def _hierarchy(company, data, *, full=True):
	settings = frappe.get_single("Temple Inventory Settings")
	if not settings.root_warehouse:
		configuration.initialize(company, configuration.status()["version"])
		settings.reload()
	if settings.company != company:
		frappe.throw("样例公司与库存配置不一致")
	if frappe.db.sql(
		"""select 1 from `tabStock Ledger Entry` s join `tabWarehouse` w on w.name=s.warehouse
		where w.lft >= (select lft from `tabWarehouse` where name=%s)
		and w.rgt <= (select rgt from `tabWarehouse` where name=%s) limit 1""",
		(settings.root_warehouse, settings.root_warehouse),
	):
		frappe.throw("样例安装要求配置范围内没有库存流水；请使用开发站点重置工具")
	physical = settings.physical_root_warehouse

	def add(kind, label, parent, short=None):
		warehouses.create_location(kind, label, parent, short)
		return frappe.db.get_value("Warehouse", {"parent_warehouse": parent, "ti_label": label}, "name")

	t1 = add("Area", "第1寺院", physical, "T1")
	add("Room", "106", t1)
	add("Room", "201", t1)
	t2 = add("Area", "第2寺院", physical, "T2")
	room_a02 = add("Room", "A02", t2)
	add("Shelf", "货架1", room_a02, "S1")
	add("Shelf", "货架2", room_a02, "S2")
	for label in ("A04", "A07", "A14", "B01b", "C06", "C07"):
		add("Room", label, t2)
	add("Room", "临时存放", t2, "TMP")
	room_a = room_a02
	room_b = frappe.db.get_value("Warehouse", {"parent_warehouse": t2, "ti_label": "A04"}, "name")
	demo_shelf = frappe.db.get_value("Warehouse", {"parent_warehouse": room_a, "ti_label": "货架1"}, "name")
	if full:
		ds = add("Area", "东山寺区", physical, "DS")
		zt = add("Area", "斋堂", ds, "ZT")
		kitchen = add("Room", "厨房", zt)
		fridge = add("Shelf", "冷藏柜", kitchen)
		warehouses.subdivide_shelf(fridge, str(frappe.db.get_value("Warehouse", fridge, "modified")))
		for label in ("上层", "下层"):
			add("Shelf", label, fridge)
		for label in ("干货架A", "干货架B", "干货架C", "干货架D"):
			add("Shelf", label, kitchen)
		add("Room", "餐具间", zt)
		hall = add("Room", "大殿", ds)
		for label in ("供桌柜1", "供桌柜2", "供桌柜3"):
			add("Shelf", label, hall)
		bookcase = add("Shelf", "经书柜", hall)
		warehouses.subdivide_shelf(bookcase, str(frappe.db.get_value("Warehouse", bookcase, "modified")))
		for index in range(1, 7):
			add("Shelf", f"第{index}格", bookcase)
		add("Room", "法物流通处临时周转货架（节庆期间使用）", ds)
		old = add("Room", "旧仓库", ds)
		warehouses.set_disabled(old, True, str(frappe.db.get_value("Warehouse", old, "modified")))
		ev = add("Area", "活动现场", physical, "EV")
		add("Room", "广场帐篷A", ev)
		add("Room", "广场帐篷B", ev)
	rooms = {
		"A02": frappe.db.get_value(
			"Warehouse", {"parent_warehouse": room_a02, "ti_direct_storage": 1}, "name"
		),
		"DEMO_A": frappe.db.get_value(
			"Warehouse", {"parent_warehouse": room_a, "ti_direct_storage": 1}, "name"
		),
		"DEMO_SHELF": demo_shelf,
		"DEMO_B": frappe.db.get_value(
			"Warehouse", {"parent_warehouse": room_b, "ti_direct_storage": 1}, "name"
		),
	}
	rooms["LEASE"] = settings.leased_warehouse
	rooms["DAMAGED"] = settings.damaged_warehouse
	if full:
		affinity, physical_leaves = _category_affinity(company, rooms)
		rooms["AFFINITY"] = affinity
		rooms["PHYSICAL_LEAVES"] = physical_leaves
		rooms["NEIGHBORS"] = _leaf_neighbors(company, settings.physical_root_warehouse, physical_leaves)
	return rooms


def _references(data, costumes, *, include_generated=True):
	for row in data["categories"] if include_generated else []:
		if not frappe.db.exists("Item Group", row["label"]):
			catalog.create_category(row["label"])
	if not frappe.db.exists("Item Group", "演出用品"):
		catalog.create_category("演出用品", is_group=True)
	for label in ("演出服装", "演出鞋袜", "演出头饰", "演出道具"):
		if not frappe.db.exists("Item Group", label):
			catalog.create_category(label, "演出用品")
	units = {row["stock_uom"] for row in data["items"]} if include_generated else set()
	units.update({"Kg", "Box"} if include_generated else {row["stock_uom"] for row in costumes})
	for unit in sorted(units):
		if not frappe.db.exists("UOM", unit):
			catalog.create_uom(unit, must_be_whole_number=unit != "Kg")
	activities.seed_activity_types()


def _attach_file(filename, content, doctype, name, field=None):
	# File.before_insert owns the single native write of these bytes. The
	# convenience save_file helper prewrites a second, unreferenced copy.
	return frappe.get_doc(
		{
			"doctype": "File",
			"file_name": filename,
			"content": content,
			"is_private": 1,
			"attached_to_doctype": doctype,
			"attached_to_name": name,
			"attached_to_field": field,
		}
	).insert()


def _items(data, costumes, *, attach_images, include_generated=True):
	result = {}
	costume_item_codes = {}
	for row in data["items"] if include_generated else []:
		code = allocate_item_code()
		result[row["key"]] = catalog.save_item(
			{
				"item_code": code,
				"item_name": row["item_name"],
				"item_group": row["item_group"],
				"description": row["description"],
				"stock_uom": row["stock_uom"],
				"has_batch_no": row["has_batch_no"],
				"has_expiry_date": row["has_expiry_date"],
				"barcodes": [code],
			}
		)
		if not attach_images:
			continue
		for image in row["images"]:
			path = ASSETS / image["output"]
			file = _attach_file(
				path.name,
				path.read_bytes(),
				"Item",
				code,
				field="image" if image["primary"] else None,
			)
			if image["primary"]:
				item = frappe.get_doc("Item", code)
				item.image = file.file_url
				item.save()
	for row in costumes:
		code = allocate_item_code()
		unit_suffix = "" if row["stock_uom"] == "Nos" else f"({row['stock_uom']})"
		item = catalog.save_item(
			{
				"item_code": code,
				"item_name": row["item_name"] + unit_suffix,
				"item_group": row["item_group"],
				"description": row["description"],
				"stock_uom": "Nos",
				"has_batch_no": row["has_batch_no"],
				"has_expiry_date": row["has_expiry_date"],
				"barcodes": [code, row["source_code"]],
			}
		)
		result[row["key"]] = item
		costume_item_codes[row["source_code"]] = item["item_code"]
		if not attach_images:
			continue
		for image in row["images"]:
			path = ASSETS / image["output"]
			file = _attach_file(
				path.name,
				path.read_bytes(),
				"Item",
				code,
				field="image" if image["primary"] else None,
			)
			if image["primary"]:
				item = frappe.get_doc("Item", code)
				item.image = file.file_url
				item.save()
	for key, label, unit, batch, expiry in EXTRA_ITEMS if include_generated else []:
		code = allocate_item_code()
		result[key] = catalog.save_item(
			{
				"item_code": code,
				"item_name": label,
				"item_group": "" if key == "N-ZERO" else "食品" if unit == "Kg" else "餐具与耗材",
				"stock_uom": unit,
				"has_batch_no": batch,
				"has_expiry_date": expiry,
				"barcodes": [code],
			}
		)
	if include_generated and attach_images:
		for image_key, item_key in (
			("C-HAT", "G-000016"),
			("C-ROBE", "G-000017"),
			("C-LAY", "G-000018"),
			("N-WORKFLOW", "N-WORKFLOW"),
			("N-WEIGHT", "N-WEIGHT"),
			("N-UNDATED", "N-UNDATED"),
		):
			image = generated_images().get(image_key)
			if not image:
				continue
			path = ASSETS / image["output"]
			item_code = result[item_key]["item_code"]
			file = _attach_file(path.name, path.read_bytes(), "Item", item_code, field="image")
			doc = frappe.get_doc("Item", item_code)
			doc.image = file.file_url
			doc.save()
			result[item_key]["version"] = str(doc.modified)
	return result, costume_item_codes


def _fiscal_years(company):
	for year in sorted(
		{
			getdate(_date(-600)).year,
			getdate(_date(-400)).year,
			getdate(_date(-60)).year,
			getdate(_date(0)).year,
		}
	):
		if not frappe.db.exists("Fiscal Year", str(year)):
			frappe.get_doc(
				{
					"doctype": "Fiscal Year",
					"year": str(year),
					"year_start_date": f"{year}-01-01",
					"year_end_date": f"{year}-12-31",
					"companies": [{"company": company}],
				}
			).insert()
		else:
			fiscal_year = frappe.get_doc("Fiscal Year", str(year))
			if fiscal_year.companies and company not in {row.company for row in fiscal_year.companies}:
				fiscal_year.append("companies", {"company": company})
				fiscal_year.save()


def _line(item, quantity, *, source=None, target=None, **values):
	return {
		"item_code": item["item_code"],
		"qty": quantity,
		"uom": item["stock_uom"],
		"conversion_factor": 1,
		"s_warehouse": source,
		"t_warehouse": target,
		"basic_rate": 10,
		**values,
	}


def _seed_users():
	users = []
	for first_name, email in (
		("陈明", "chen.ming@example.com"),
		("林慧", "lin.hui@example.com"),
		("王建国", "wang.jianguo@example.com"),
		("赵雅", "zhao.ya@example.com"),
		("周平", "zhou.ping@example.com"),
	):
		user_name = frappe.db.get_value("User", {"email": email}, "name")
		if not user_name:
			user_name = (
				frappe.get_doc(
					{
						"doctype": "User",
						"email": email,
						"first_name": first_name,
						"user_type": "System User",
						"send_welcome_email": 0,
						"roles": [
							{"role": "System Manager"},
							{"role": "Item Manager"},
							{"role": "Stock Manager"},
							{"role": "Stock User"},
						],
					}
				)
				.insert()
				.name
			)
		users.append(user_name)
	return users


def _as_user(user, method, *args):
	previous_user = frappe.session.user
	frappe.set_user(user)
	try:
		return method(*args)
	finally:
		frappe.set_user(previous_user)


def _batch_id(item, label):
	item_code = item["item_code"] if isinstance(item, dict) else item
	return f"{item_code} {str(label).replace('-', ' ')}"


def _batch_bundle(company, item, warehouse, day, transaction, allocations):
	return frappe.get_doc(
		{
			"doctype": "Serial and Batch Bundle",
			"voucher_type": "Stock Entry",
			"company": company,
			"item_code": item["item_code"],
			"warehouse": warehouse,
			"type_of_transaction": transaction,
			"posting_datetime": _date(day) + " 12:00:00",
			"entries": [
				{
					"batch_no": batch,
					"qty": quantity if transaction == "Inward" else -quantity,
				}
				for batch, quantity in allocations
			],
		}
	).insert()


def _entry(
	company,
	key,
	kind,
	lines,
	days,
	*,
	submit=True,
	attach_file=False,
	actor=None,
	posting_time="12:00:00",
	**context,
):
	previous_user = frappe.session.user
	if actor:
		frappe.set_user(actor)
	try:
		draft = native_api.create_document(
			"Stock Entry",
			REQUEST_PREFIX + key,
			{
				"company": company,
				"posting_date": _date(days),
				"posting_time": posting_time,
				"ti_time_mode": "Manual",
				"ti_movement_kind": kind,
				"ti_source_text": "库外接收" if kind == "Receive" else "",
				"ti_purpose_text": "活动用品",
				"remarks": key.replace("-", " ").title(),
				"items": lines,
				**context,
			},
		)
		if attach_file:
			_attach_file("ti-native-sample-receipt.txt", ATTACHMENT_CONTENT, "Stock Entry", draft.name)
		return native_api.submit_document("Stock Entry", draft.name, draft.version) if submit else draft
	finally:
		if actor:
			frappe.set_user(previous_user)


def _opening(company, data, costumes, items, rooms, *, include_generated=True):
	lines = []
	costume_lines = []
	expiry_index = 0
	category_map = rooms.get("AFFINITY", {})
	item_placements = {}

	def pool_for(category):
		return category_map.get(category or "无分类") or category_map.get("__default__", [rooms["DEMO_A"]])

	def split_line(item, quantity, pool, *, batch_no=None, basic_rate=None):
		whole = bool(frappe.db.get_value("UOM", item["stock_uom"], "must_be_whole_number"))
		location_count = min(len(pool), 1 + (len(item["item_code"]) % 3))
		if whole:
			location_count = min(location_count, max(1, int(quantity)))
		item_code = item["item_code"]
		placement_pool = item_placements.get(item_code, pool)
		location_count = min(location_count, len(placement_pool))
		locations = random.Random(f"split:{item_code}").sample(placement_pool, location_count)
		item_placements.setdefault(item_code, locations)
		rooms.setdefault("OPENING_PLACEMENTS", {})[item_code] = list(item_placements[item_code])
		if batch_no:
			rooms.setdefault("BATCH_PLACEMENTS", {})[f"{item['item_code']}::{batch_no}"] = locations
		parts = _quantity_parts(quantity, len(locations), whole)
		return [
			_line(
				item,
				part,
				target=warehouse,
				batch_no=batch_no,
				use_serial_batch_fields=1 if batch_no else 0,
				basic_rate=basic_rate,
			)
			for warehouse, part in zip(locations, parts, strict=True)
		]

	for row in data["opening"] if include_generated else []:
		if row["key"] in data["batches"]:
			continue
		item = items[row["key"]]
		pool = pool_for(next(entry["item_group"] for entry in data["items"] if entry["key"] == row["key"]))
		lines.extend(split_line(item, row["quantity"], pool, basic_rate=row["rate"]))
	by_key = {row["key"]: row for row in data["items"]}
	for key, batches in data["batches"].items() if include_generated else []:
		item = items[key]
		for batch in batches:
			batch_id = _batch_id(item, batch["key"])
			catalog.create_batch(
				item["item_code"],
				batch_id,
				_date(MANUFACTURING_OFFSETS[expiry_index % len(MANUFACTURING_OFFSETS)]),
				_date(EXPIRY_OFFSETS[expiry_index % len(EXPIRY_OFFSETS)]),
			)
			expiry_index += 1
			lines.extend(
				split_line(
					item,
					batch["quantity"],
					pool_for(by_key[key]["item_group"]),
					batch_no=batch_id,
					basic_rate=by_key[key]["rate"],
				)
			)
	for row in data["items"] if include_generated else []:
		if row.get("opening_qty"):
			lines.extend(
				split_line(
					items[row["key"]],
					row["opening_qty"],
					pool_for(row["item_group"]),
				)
			)
	for row in costumes:
		costume_lines.append(
			_line(
				items[row["key"]],
				row["quantity"],
				target=rooms["A02"],
				basic_rate=row["rate"],
			)
		)
	if include_generated:
		lines.append(_line(items["N-WEIGHT"], 12.5, target=rooms["DEMO_B"], basic_rate=2))
		undated_batch = _batch_id(items["N-UNDATED"], "Undated Supply")
		catalog.create_batch(items["N-UNDATED"]["item_code"], undated_batch, _date(-600))
		lines.append(
			_line(
				items["N-UNDATED"],
				12,
				target=rooms["DEMO_A"],
				batch_no=undated_batch,
				use_serial_batch_fields=1,
			)
		)

	def submit_opening(key, entry_lines):
		draft = _entry(company, key, "Receive", entry_lines, -400, submit=False)
		doc = frappe.get_doc("Stock Entry", draft.name)
		doc.is_opening = "Yes"
		opening_account = frappe.db.get_value(
			"Account", {"company": company, "account_name": "Temporary Opening", "is_group": 0}, "name"
		)
		if not opening_account:
			frappe.throw("样例期初库存需要标准 Temporary Opening 科目")
		for line in doc.items:
			line.expense_account = opening_account
		doc.save()
		return native_api.submit_document("Stock Entry", doc.name, str(doc.modified))

	result = {"costumes": submit_opening("costume-opening", costume_lines)}
	if include_generated:
		result["general"] = submit_opening("catalog-opening", lines)
	return result


def _workflow(company, items, rooms, *, attach_files):
	item = items["N-WORKFLOW"]
	a, b, leased, damaged = (rooms[key] for key in ("DEMO_A", "DEMO_SHELF", "LEASE", "DAMAGED"))
	actors = _seed_users()
	activity = activities.save_activity(
		{
			"title": SAMPLE_ACTIVITY_TITLE,
			"activity_type": "TI-TYPE-PERFORMANCE",
			"status": "Active",
			"start_date": _date(-60),
			"end_date": _date(7),
			"description": "原生借出、部分归还、损坏与报损示例",
			"notes": "首次借出与追加借出属于同一活动。\n归还记录保留原借出明细；一张归还记录可结算多个兼容借出。",
		}
	)
	context = {"ti_activity": activity["name"], "ti_borrower": "演出团队"}
	conversions.save_item_conversions(
		item["item_code"], item["version"], [{"uom": "Box", "conversion_factor": 5}]
	)
	documents = [
		_entry(
			company,
			"workflow-opening",
			"Receive",
			[_line(item, 20, target=a, uom="Box", conversion_factor=5)],
			-60,
			attach_file=attach_files,
			ti_activity=activity["name"],
		),
		_entry(company, "issue", "Issue", [_line(item, 3, source=a)], -40, **context),
		_entry(company, "transfer", "Transfer", [_line(item, 15, source=a, target=b)], -30, **context),
	]
	loans = [
		_entry(company, "loan-first", "Loan", [_line(item, 20, source=a, target=leased)], -20, **context),
		_entry(company, "loan-second", "Loan", [_line(item, 10, source=b, target=leased)], -19, **context),
	]
	loans.extend(
		[
			_entry(
				company, "loan-untouched", "Loan", [_line(item, 2, source=a, target=leased)], -18, **context
			),
			_entry(
				company,
				"loan-fully-settled",
				"Loan",
				[_line(item, 5, source=b, target=leased)],
				-17,
				**context,
			),
		]
	)
	documents.extend(loans)

	def settle(loan, quantity, outcome, target):
		return _line(
			item,
			quantity,
			source=leased,
			target=target,
			ti_original_loan=loan.name,
			ti_original_loan_line=loan["items"][0].name,
			ti_settlement_outcome=outcome,
		)

	documents.extend(
		[
			_entry(
				company,
				"return-full",
				"Return",
				[settle(loans[3], 5, "Returned", a)],
				-16,
				**context,
			),
			_entry(
				company,
				"return-multiple",
				"Return",
				[settle(loans[0], 4, "Returned", b), settle(loans[1], 2, "Returned", b)],
				-15,
				**context,
			),
			_entry(
				company, "return-damaged", "Return", [settle(loans[0], 3, "Damaged", damaged)], -14, **context
			),
			_entry(company, "loan-loss", "Loss", [settle(loans[0], 2, "Lost", None)], -13, **context),
			_entry(company, "damage", "Damage", [_line(item, 2, source=a, target=damaged)], -12, **context),
			_entry(company, "repair", "Repair", [_line(item, 1, source=damaged, target=a)], -11, **context),
			_entry(company, "disposal", "Disposal", [_line(item, 1, source=damaged)], -10, **context),
		]
	)
	meal_activity = activities.save_activity(
		{
			"title": SAMPLE_MEAL_ACTIVITY_TITLE,
			"activity_type": "TI-TYPE-DISTRIBUTION",
			"status": "Active",
			"start_date": _date(-8),
			"end_date": _date(4),
			"description": "跨库位准备共餐物资并记录部分领用。",
		}
	)
	meal_item = items["G-000006"]
	documents.extend(
		[
			_entry(
				company,
				"meal-receipt",
				"Receive",
				[_line(meal_item, 4, target=rooms["DEMO_B"])],
				-7,
				ti_activity=meal_activity["name"],
			),
			_entry(
				company,
				"meal-issue",
				"Issue",
				[_line(meal_item, 1, source=rooms["DEMO_B"])],
				-5,
				ti_activity=meal_activity["name"],
			),
		]
	)
	history_activity = activities.save_activity(
		{
			"title": SAMPLE_HISTORY_ACTIVITY_TITLE,
			"activity_type": "TI-TYPE-DISTRIBUTION",
			"status": "Active",
			"start_date": _date(-56),
			"end_date": _date(-20),
			"description": "多次记录库位间的物资准备与发放。",
		}
	)
	for index in range(16):
		receipt_day = -56 + index * 2
		issue_day = receipt_day + 1
		documents.extend(
			[
				_entry(
					company,
					f"history-receive-{index + 1:02}",
					"Receive",
					[_line(item, 1, target=rooms["DEMO_B"])],
					receipt_day,
					ti_activity=history_activity["name"],
				),
				_entry(
					company,
					f"history-issue-{index + 1:02}",
					"Issue",
					[_line(item, 1, source=rooms["DEMO_B"])],
					issue_day,
					ti_activity=history_activity["name"],
				),
			]
		)
	batch_item = items["G-000001"]
	batches = [_batch_id(batch_item, "Event Bundle A"), _batch_id(batch_item, "Event Bundle B")]
	for batch in batches:
		catalog.create_batch(batch_item["item_code"], batch, _date(-500), _date(45))
	allocations = [(batches[0], 2), (batches[1], 3)]
	inbound_bundle = _batch_bundle(company, batch_item, rooms["DEMO_B"], -23, "Inward", allocations)
	documents.append(
		_entry(
			company,
			"bundle-receipt",
			"Receive",
			[
				_line(
					batch_item,
					5,
					target=rooms["DEMO_B"],
					serial_and_batch_bundle=inbound_bundle.name,
					use_serial_batch_fields=0,
				)
			],
			-23,
			ti_activity=history_activity["name"],
		)
	)
	outbound_bundle = _batch_bundle(company, batch_item, rooms["DEMO_B"], -22, "Outward", allocations)
	documents.append(
		_entry(
			company,
			"bundle-issue",
			"Issue",
			[
				_line(
					batch_item,
					5,
					source=rooms["DEMO_B"],
					serial_and_batch_bundle=outbound_bundle.name,
					use_serial_batch_fields=0,
				)
			],
			-22,
			ti_activity=history_activity["name"],
		)
	)
	# Keep a historical recorded factor distinct from the current reusable factor.
	current = frappe.get_doc("Item", item["item_code"])
	conversions.save_item_conversions(
		current.name, str(current.modified), [{"uom": "Box", "conversion_factor": 8}]
	)
	documents.append(
		_entry(
			company,
			"recorded-factor",
			"Receive",
			[_line(item, 1, target=a, uom="Box", conversion_factor=5)],
			-4,
		)
	)
	cancelled = _entry(
		company,
		"cancelled-receipt",
		"Receive",
		[_line(item, 2, target=a)],
		-2,
		actor=actors[0],
	)
	cancelled = _as_user(
		actors[0], native_api.cancel_document, "Stock Entry", cancelled.name, str(cancelled.modified)
	)
	documents.append(cancelled)
	# Keep a real typed amendment owned by the test user instead of Desk-only metadata.
	amended = _as_user(
		actors[0],
		native_api.amend_document,
		"Stock Entry",
		cancelled.name,
		cancelled.version,
		REQUEST_PREFIX + "cancelled-receipt-amended",
	)
	documents.append(amended)
	documents.append(
		_entry(
			company,
			"valid-draft",
			"Transfer",
			[_line(item, 1, source=a, target=b)],
			0,
			submit=False,
			actor=actors[1],
		)
	)
	return documents, loans, [activity["name"], meal_activity["name"], history_activity["name"]]


def _count(company, rooms, items):
	stamp = _date(-1) + " 12:00:00"
	warehouses = [rooms["DEMO_A"], rooms["DEMO_SHELF"]]
	selected_items = [items["N-WORKFLOW"]["item_code"], items["N-ZERO"]["item_code"]]
	baseline = counts.count_baseline(warehouses, stamp, "Selected", selected_items)
	rows = []
	for row in baseline["rows"]:
		copy = dict(row)
		if row["item_code"] == items["N-WORKFLOW"]["item_code"]:
			copy.update(
				actual_qty=float(row["baseline_qty"]) + (-1 if row["warehouse"] == rooms["DEMO_A"] else 1),
				review_state="Reviewed",
				reason="活动清点差异",
			)
		elif row["warehouse"] == rooms["DEMO_A"]:
			copy.update(actual_qty=float(row["baseline_qty"]), review_state="Reviewed", reason="核对无差异")
		else:
			copy.update(
				actual_qty=float(row["baseline_qty"]) + 2, review_state="Unreviewed", reason="待复核差异"
			)
		rows.append(copy)
	draft = counts.save_count(
		REQUEST_PREFIX + "count",
		{
			"company": company,
			"posting_date": _date(-1),
			"posting_time": "12:00:00",
			"ti_count_warehouses": warehouses,
			"ti_count_scope": "Selected",
			"ti_count_items": selected_items,
			"ti_baseline_timestamp": baseline["timestamp"],
			"ti_baseline_fingerprint": baseline["fingerprint"],
			"ti_count_review": rows,
			"ti_notes": "两个位置的联合盘点",
		},
	)
	return native_api.submit_document("Stock Reconciliation", draft["name"], draft["version"])


def _volume_counts(company, rooms, items, *, count_item=None, submitted=17, drafts=2):
	"""Add 18 native count submissions and two drafts across the sample period."""
	warehouses = [rooms["DEMO_A"], rooms["DEMO_SHELF"]]
	selected_items = [count_item or items["N-WORKFLOW"]["item_code"]]
	created = []
	actors = _seed_users()
	total = submitted + drafts
	for index in range(total):
		if index < submitted:
			days = -547 + index * 517 // max(1, submitted - 1)
		else:
			days = -8 + (index - submitted) * 6
		posting_date = _date(days)
		posting_time = "23:00:00"
		stamp = posting_date + " " + posting_time
		baseline = counts.count_baseline(warehouses, stamp, "Selected", selected_items)
		rows = []
		for row in baseline["rows"]:
			copy = dict(row)
			copy.update(
				actual_qty=float(row["baseline_qty"]),
				review_state="Reviewed",
				reason="日常库存抽查",
			)
			if row["item_code"] == selected_items[0] and row["warehouse"] == rooms["DEMO_A"]:
				copy["actual_qty"] = float(row["baseline_qty"]) + 1
			rows.append(copy)

		def save():
			return counts.save_count(
				REQUEST_PREFIX + f"volume-count-{index + 1:02}",
				{
					"company": company,
					"posting_date": posting_date,
					"posting_time": posting_time,
					"ti_count_warehouses": warehouses,
					"ti_count_scope": "Selected",
					"ti_count_items": selected_items,
					"ti_baseline_timestamp": baseline["timestamp"],
					"ti_baseline_fingerprint": baseline["fingerprint"],
					"ti_count_review": rows,
					"ti_notes": "日常库存抽查",
				},
			)

		actor = actors[index % len(actors)]
		draft = _as_user(actor, save)
		if index < submitted:
			draft = _as_user(
				actor,
				native_api.submit_document,
				"Stock Reconciliation",
				draft["name"],
				draft["version"],
			)
		created.append(draft)
	return created


def _volume_posting_time(index):
	seconds = index + 1
	return f"{12 + seconds // 3600:02d}:{(seconds % 3600) // 60:02d}:{seconds % 60:02d}"


def _volume_line(kind, items, rooms, rng, damaged_qty, open_loans, activity_names):
	if kind == "Return":
		loan = next((value for value in open_loans if value), None)
		if not loan:
			frappe.throw("生成归还记录时没有可结算的借用")
		loan_line = loan["items"][0]
		key = next(key for key, value in items.items() if value["item_code"] == loan_line.item_code)
		return _line(
			items[key],
			1,
			source=rooms["LEASE"],
			target=loan_line.s_warehouse,
			ti_original_loan=loan.name,
			ti_original_loan_line=loan_line.name,
			ti_settlement_outcome="Returned",
		), {"ti_activity": loan.ti_activity, "ti_borrower": loan.ti_borrower}
	key = None
	item = None
	warehouse = None
	if kind in ("Issue", "Transfer", "Loan", "Damage", "Loss"):
		candidates = [candidate for candidate in items if candidate.startswith("V")]
		rng.shuffle(candidates)
		for candidate in candidates:
			candidate_item = items[candidate]
			for location in rooms.get("ITEM_AFFINITY", {}).get(candidate, rooms.get("PHYSICAL_LEAVES", [])):
				if get_stock_balance(candidate_item["item_code"], location, _date(-3)) >= (
					2 if kind in ("Loan", "Damage") else 1
				):
					key, item, warehouse = candidate, candidate_item, location
					break
			if item:
				break
		if not item:
			frappe.throw("生成草稿或取消单时没有可用的真实库位库存")
	else:
		key = rng.choice(tuple(items))
		item = items[key]
	context = {"ti_activity": rng.choice(activity_names)}
	if kind == "Receive":
		line = _line(
			item, 1, target=rng.choice(rooms.get("ITEM_AFFINITY", {}).get(key, rooms["PHYSICAL_LEAVES"]))
		)
	elif kind == "Issue":
		line = _line(item, 1, source=warehouse)
	elif kind == "Transfer":
		targets = [value for value in rooms.get("ITEM_AFFINITY", {}).get(key, []) if value != warehouse]
		if not targets:
			targets = rooms.get("NEIGHBORS", {}).get(warehouse, [])
		line = _line(item, 1, source=warehouse, target=rng.choice(targets))
	elif kind == "Loan":
		line = _line(item, 2, source=warehouse, target=rooms["LEASE"])
		context["ti_borrower"] = rng.choice(BORROWERS)
	elif kind == "Damage":
		line = _line(item, 2, source=warehouse, target=rooms["DAMAGED"])
	elif kind in ("Repair", "Disposal"):
		available = [name for name, quantity in damaged_qty.items() if quantity > 0]
		if not available:
			frappe.throw("生成维修或报废记录时没有真实损坏库存")
		key = rng.choice(available)
		item = items[key]
		line = _line(
			item,
			1,
			source=rooms["DAMAGED"],
			**(
				{"target": rng.choice(rooms.get("ITEM_AFFINITY", {}).get(key, rooms["PHYSICAL_LEAVES"]))}
				if kind == "Repair"
				else {}
			),
		)
	elif kind == "Loss":
		line = _line(item, 1, source=warehouse)
	else:
		frappe.throw(f"不支持的生成货物流动：{kind}")
	return line, context


def _volume_lifecycle(company, items, rooms, actors, rng, damaged_qty, open_loans, activity_names):
	"""Add actor-owned native drafts, cancellations and amendments for UI stress."""
	documents = []
	draft_kinds = (
		"Receive",
		"Issue",
		"Transfer",
		"Loan",
		"Return",
		"Damage",
		"Loss",
		"Repair",
		"Disposal",
		"Transfer",
	)
	for index, kind in enumerate(draft_kinds):
		line, context = _volume_line(kind, items, rooms, rng, damaged_qty, open_loans, activity_names)
		if kind == "Return":
			loan = next(value for value in open_loans if value)
			context.update({"ti_activity": loan.ti_activity, "ti_borrower": loan.ti_borrower})
		if kind == "Loan":
			context["ti_borrower"] = rng.choice(BORROWERS)
		actor = actors[index % len(actors)]
		documents.append(
			_entry(
				company,
				f"volume-draft-{index + 1:02}",
				kind,
				[line],
				-3,
				submit=False,
				actor=actor,
				**context,
			)
		)

	cancel_kinds = ("Receive", "Issue", "Transfer", "Loan", "Damage", "Loss", "Repair", "Disposal", "Receive")
	for index, kind in enumerate(cancel_kinds):
		line, context = _volume_line(kind, items, rooms, rng, damaged_qty, open_loans, activity_names)
		if kind == "Loan":
			context["ti_borrower"] = rng.choice(BORROWERS)
		actor = actors[index % len(actors)]
		entry = _entry(
			company,
			f"volume-cancel-{index + 1:02}",
			kind,
			[line],
			-2,
			actor=actor,
			**context,
		)
		cancelled = _as_user(
			actor,
			native_api.cancel_document,
			"Stock Entry",
			entry.name,
			entry.version,
		)
		documents.append(cancelled)
		if index < 3:
			amended = _as_user(
				actor,
				native_api.amend_document,
				"Stock Entry",
				entry.name,
				cancelled.version,
				REQUEST_PREFIX + f"volume-amend-{index + 1:02}",
			)
			if index < 2:
				amended = _as_user(
					actor,
					native_api.submit_document,
					"Stock Entry",
					amended.name,
					amended.version,
				)
			documents.append(amended)
	return documents


def _generated_volume(company, rooms, catalog_data, costumes, *, movement_count=1500):
	"""Create deterministic, native volume data for full development installs."""
	rng = random.Random(20261023)
	unit_whole = {
		"Nos": True,
		"Pair": True,
		"Set": True,
		"Box": True,
		"包": True,
		"瓶": True,
		"Litre": False,
		"Meter": False,
		"张": True,
		"Kg": False,
	}
	for unit, whole in unit_whole.items():
		if not frappe.db.exists("UOM", unit):
			catalog.create_uom(unit, must_be_whole_number=whole)
	category_names = ("日常用品", "厨房物资", "法会用品", "办公物资")
	for label in category_names:
		if not frappe.db.exists("Item Group", label):
			catalog.create_category(label)
	users = _seed_users()
	activities_list = []
	for index in range(22):
		activity = activities.save_activity(
			{
				"title": f"秋季物资整理第{index + 1:02}组",
				"activity_type": "TI-TYPE-DISTRIBUTION" if index % 2 else "TI-TYPE-PERFORMANCE",
				"status": "Active",
				"start_date": _date(-547 + index * 22),
				"end_date": _date(-535 + index * 22),
				"description": "寺院日常活动物资登记与归还。",
			}
		)
		activities_list.append(activity["name"])
	products = generated_product_rows()
	image_manifest = generated_images()
	generated = {}
	conversion_rows = {}
	opening_lines = []
	batch_codes = set()
	opening_balances = {}
	affinity = rooms.get("AFFINITY", {})
	physical = rooms.get("PHYSICAL_LEAVES", [rooms["DEMO_A"], rooms["DEMO_B"], rooms["DEMO_SHELF"]])
	covered_leaves = set()
	for index, product in enumerate(products):
		key = product["key"]
		stock_uom = product["stock_uom"]
		group = product["group"]
		item_name = product["item_name"]
		batch_tracked = product["batch_tracked"]
		item = catalog.save_item(
			{
				"item_code": allocate_item_code(),
				"item_name": item_name,
				"item_group": "" if product["uncategorized"] else group,
				"description": "用于寺院日常管理与活动周转。",
				"stock_uom": stock_uom,
				"has_batch_no": batch_tracked,
				"has_expiry_date": batch_tracked,
			}
		)
		generated[key] = item
		image = image_manifest.get(product["base_key"])
		if image:
			path = ASSETS / image["output"]
			file = _attach_file(path.name, path.read_bytes(), "Item", item["item_code"], field="image")
			doc = frappe.get_doc("Item", item["item_code"])
			doc.image = file.file_url
			doc.save()
			item["version"] = str(doc.modified)
		conversions_for_item = [{"uom": stock_uom, "conversion_factor": 1}]
		if product["has_alternate_uom"]:
			alternate_uom, conversion_factor = generated_alternate_conversion(product)
			conversions_for_item.append({"uom": alternate_uom, "conversion_factor": conversion_factor})
			conversion_result = conversions.save_item_conversions(
				item["item_code"], item["version"], conversions_for_item
			)
			conversion_rows[key] = conversions_for_item
			item["version"] = conversion_result["version"]
		affinity_category = "无分类" if product["uncategorized"] else group
		pool = affinity.get(affinity_category) or physical
		# Guarantee broad shelf coverage, then retain category affinity for the other slots.
		forced = next(
			(warehouse for warehouse in physical if warehouse not in covered_leaves and warehouse in pool),
			None,
		)
		chosen = [forced] if forced else []
		if forced:
			covered_leaves.add(forced)
		remaining = [warehouse for warehouse in pool if warehouse not in chosen]
		chosen.extend(rng.sample(remaining, min(2, len(remaining))))
		chosen = list(dict.fromkeys(chosen))
		rooms.setdefault("ITEM_AFFINITY", {})[key] = list(pool)
		rooms.setdefault("OPENING_PLACEMENTS", {})[item["item_code"]] = chosen
		opening_quantity = 200.5 if stock_uom in {"Kg", "Litre", "Meter"} else 200
		if batch_tracked:
			batch_id = _batch_id(item, f"Lot {index + 1:04d}")
			catalog.create_batch(item["item_code"], batch_id, _date(-730 - index), _date(60 + index))
			batch_codes.add(key)
			parts = _quantity_parts(opening_quantity, len(chosen), stock_uom not in {"Kg", "Litre", "Meter"})
			for warehouse, quantity in zip(chosen, parts, strict=True):
				opening_lines.append(
					_line(item, quantity, target=warehouse, batch_no=batch_id, use_serial_batch_fields=1)
				)
		else:
			parts = _quantity_parts(opening_quantity, len(chosen), stock_uom not in {"Kg", "Litre", "Meter"})
			for warehouse, quantity in zip(chosen, parts, strict=True):
				opening_lines.append(_line(item, quantity, target=warehouse))
		for warehouse, quantity in zip(chosen, parts, strict=True):
			opening_balances[(key, warehouse)] = quantity
	if opening_lines:
		draft = _entry(company, "volume-opening", "Receive", opening_lines, -547, submit=False)
		opening_doc = frappe.get_doc("Stock Entry", draft.name)
		opening_doc.is_opening = "Yes"
		opening_account = frappe.db.get_value(
			"Account", {"company": company, "account_name": "Temporary Opening", "is_group": 0}, "name"
		)
		if not opening_account:
			frappe.throw("期初库存需要标准 Temporary Opening 科目")
		for line in opening_doc.items:
			line.expense_account = opening_account
		opening_doc.save()
		opening = native_api.submit_document("Stock Entry", opening_doc.name, str(opening_doc.modified))
	else:
		opening = None
	actors = users
	physical = rooms.get("PHYSICAL_LEAVES", [rooms["DEMO_A"], rooms["DEMO_B"], rooms["DEMO_SHELF"]])
	kind_weights = (
		("Receive", 0.23),
		("Issue", 0.21),
		("Transfer", 0.15),
		("Loan", 0.12),
		("Return", 0.10),
		("Damage", 0.06),
		("Repair", 0.06),
		("Loss", 0.04),
		("Disposal", 0.03),
	)
	kind_counts = {kind: int(movement_count * weight) for kind, weight in kind_weights}
	for index in range(movement_count - sum(kind_counts.values())):
		kind_counts[("Receive", "Issue", "Transfer")[index % 3]] += 1
	monthly_kinds = [[] for _ in range(18)]
	for kind, count in kind_counts.items():
		for month in range(18):
			portion = count * (month + 1) // 18 - count * month // 18
			monthly_kinds[month].extend([kind] * portion)
	kind_order = ("Receive", "Issue", "Transfer", "Loan", "Loss", "Damage", "Repair", "Disposal", "Return")
	schedule = []
	for month_kinds in monthly_kinds:
		for kind in kind_order:
			selected = [value for value in month_kinds if value == kind]
			rng.shuffle(selected)
			schedule.extend(selected)
	open_loans = []
	damaged_qty = {}
	damaged_home = {}
	balances = {}
	for (item_key, warehouse), quantity in opening_balances.items():
		_balance_change(balances, item_key, warehouse, quantity)
	documents = [opening] if opening else []
	activity_names = [*activities_list]
	available_items = {key: value for key, value in generated.items() if key not in batch_codes}
	count_item_key = next(
		key
		for (key, warehouse), quantity in opening_balances.items()
		if warehouse == rooms["DEMO_A"] and key in available_items and quantity > 0
	)
	count_item = available_items[count_item_key]["item_code"]
	for index, kind in enumerate(schedule):
		key = rng.choice(tuple(available_items))
		item = available_items[key]
		context = {"ti_activity": rng.choice(activity_names)}
		if kind == "Loan":
			source = rng.choice(
				[
					warehouse
					for (item_key, warehouse, batch), qty in balances.items()
					if item_key == key and warehouse in physical and batch is None and qty >= 2
				]
			)
			context["ti_borrower"] = rng.choice(BORROWERS)
			line = _line(item, 2, source=source, target=rooms["LEASE"])
			loan = _entry(
				company,
				f"volume-{index + 1:04d}",
				kind,
				[line],
				-547 + index * 547 // movement_count,
				actor=rng.choice(actors),
				posting_time=_volume_posting_time(index),
				**context,
			)
			documents.append(loan)
			_balance_change(balances, key, source, -2)
			_balance_change(balances, key, rooms["LEASE"], 2)
			open_loans.append((loan, key, source))
			continue
		if kind == "Return":
			loan, item_key, return_home = open_loans.pop(0)
			loan_line = loan["items"][0]
			key = item_key
			item = available_items[item_key]
			context.update({"ti_activity": loan.ti_activity, "ti_borrower": loan.ti_borrower})
			line = _line(
				item,
				1,
				source=rooms["LEASE"],
				target=return_home,
				ti_original_loan=loan.name,
				ti_original_loan_line=loan_line.name,
				ti_settlement_outcome="Returned",
			)
		elif kind in ("Receive", "Issue", "Transfer", "Loss"):
			if kind == "Receive":
				target = rng.choice(rooms["ITEM_AFFINITY"][key])
				line = _line(item, 1, target=target)
			else:
				required = 2
				sources = [
					warehouse
					for (item_key, warehouse, batch), qty in balances.items()
					if item_key == key and warehouse in physical and batch is None and qty >= required
				]
				if not sources:
					key = next(
						candidate
						for candidate in available_items
						if any(
							i == candidate and warehouse in physical and b is None and qty >= required
							for (i, warehouse, b), qty in balances.items()
						)
					)
					item = available_items[key]
					sources = [
						warehouse
						for (item_key, warehouse, batch), qty in balances.items()
						if item_key == key and warehouse in physical and batch is None and qty >= required
					]
				source = rng.choice(sources)
				if kind == "Transfer":
					candidates = [
						warehouse for warehouse in rooms["ITEM_AFFINITY"][key] if warehouse != source
					]
					if not candidates:
						candidates = rooms.get("NEIGHBORS", {}).get(source, [])
					target = rng.choice(candidates)
					line = _line(item, 1, source=source, target=target)
				else:
					line = _line(item, 1, source=source)
		elif kind == "Damage":
			source = next(
				(
					warehouse
					for (item_key, warehouse, batch), qty in balances.items()
					if item_key == key and warehouse in physical and batch is None and qty >= 2
				),
				None,
			)
			if source is None:
				key = next(
					candidate
					for candidate in available_items
					if any(
						i == candidate and warehouse in physical and b is None and qty >= 2
						for (i, warehouse, b), qty in balances.items()
					)
				)
				item = available_items[key]
				source = next(
					warehouse
					for (item_key, warehouse, batch), qty in balances.items()
					if item_key == key and warehouse in physical and batch is None and qty >= 2
				)
			line = _line(item, 2, source=source, target=rooms["DAMAGED"])
			damaged_qty[key] = damaged_qty.get(key, 0) + 2
			damaged_home[key] = source
		elif kind in ("Repair", "Disposal"):
			pool = [name for name, quantity in damaged_qty.items() if quantity > 0]
			pool_key = rng.choice(pool)
			item = available_items[pool_key]
			line = _line(
				item,
				1,
				source=rooms["DAMAGED"],
				**({"target": damaged_home[pool_key]} if kind == "Repair" else {}),
			)
			damaged_qty[pool_key] -= 1
			key = pool_key
		# Alternate-UOM receipts can add an entire pack; transfers stay in stock UOM
		# so their source-balance check matches the physical quantity moved.
		if key in conversion_rows and kind == "Receive":
			conversion = rng.choice(conversion_rows[key])
			line["uom"] = conversion["uom"]
			line["conversion_factor"] = conversion["conversion_factor"]
		created = _entry(
			company,
			f"volume-{index + 1:04d}",
			kind,
			[line],
			-547 + index * 547 // movement_count,
			actor=rng.choice(actors),
			posting_time=_volume_posting_time(index),
			**context,
		)
		documents.append(created)
		actual_qty = Decimal(str(line["qty"])) * Decimal(str(line.get("conversion_factor", 1)))
		if kind == "Receive":
			_balance_change(balances, key, line["t_warehouse"], actual_qty)
		elif kind in ("Issue", "Loss"):
			_balance_change(balances, key, line["s_warehouse"], -actual_qty)
		elif kind == "Transfer":
			_balance_change(balances, key, line["s_warehouse"], -actual_qty)
			_balance_change(balances, key, line["t_warehouse"], actual_qty)
		elif kind == "Return":
			_balance_change(balances, key, rooms["LEASE"], -actual_qty)
			_balance_change(balances, key, line["t_warehouse"], actual_qty)
		elif kind == "Damage":
			_balance_change(balances, key, line["s_warehouse"], -actual_qty)
			_balance_change(balances, key, rooms["DAMAGED"], actual_qty)
		elif kind == "Repair":
			_balance_change(balances, key, rooms["DAMAGED"], -actual_qty)
			_balance_change(balances, key, line["t_warehouse"], actual_qty)
		elif kind == "Disposal":
			_balance_change(balances, key, rooms["DAMAGED"], -actual_qty)
	lifecycle = _volume_lifecycle(
		company,
		available_items,
		rooms,
		actors,
		rng,
		damaged_qty,
		[loan for loan, _, _ in open_loans],
		activity_names,
	)
	documents.extend(lifecycle)
	return {
		"items": generated,
		"documents": documents,
		"activities": activities_list,
		"users": users,
		"batch_items": batch_codes,
		"conversions": conversion_rows,
		"count_item": count_item,
	}


def install(company, *, data="full", attach_images=True, attach_files=True, generate_volume=False):
	"""Install examples using one site-date anchor for every relative date."""
	token = _SITE_DATE.set(getdate(nowdate()))
	try:
		return _install(
			company,
			data=data,
			attach_images=attach_images,
			attach_files=attach_files,
			generate_volume=generate_volume,
		)
	finally:
		_SITE_DATE.reset(token)


def _install(company, *, data="full", attach_images=True, attach_files=True, generate_volume=False):
	"""Called only by the guarded installer; never commits independently."""
	from temple_inventory.sample_install import assert_development_site

	assert_development_site()
	if data not in ("real", "full"):
		frappe.throw("样例数据模式必须是 real 或 full")
	catalog_data = sample_catalog()
	costumes = costume_catalog()
	_fiscal_years(company)
	rooms = _hierarchy(company, catalog_data, full=data == "full")
	include_generated = data == "full"
	_references(catalog_data, costumes, include_generated=include_generated)
	items, costume_item_codes = _items(
		catalog_data, costumes, attach_images=attach_images, include_generated=include_generated
	)
	opening = _opening(company, catalog_data, costumes, items, rooms, include_generated=include_generated)
	if not include_generated:
		return {
			"items": len(items),
			"item_codes": {key: item["item_code"] for key, item in items.items()},
			"costume_item_codes": costume_item_codes,
			"images": sum(len(row["images"]) for row in costumes) if attach_images else 0,
			"transactions": 1,
			"costume_opening": opening["costumes"].name,
			"stock_entries": [opening["costumes"].name],
			"rooms": rooms,
		}
	documents, loans, activity = _workflow(company, items, rooms, attach_files=attach_files)
	volume = None
	volume_counts = []
	if generate_volume:
		volume = _generated_volume(company, rooms, catalog_data, costumes)
		items.update(volume["items"])
		documents.extend(volume["documents"])
		activity.extend(volume["activities"])
	if generate_volume:
		volume_counts = _volume_counts(company, rooms, items, count_item=volume["count_item"])
	depleted_batch = _batch_id(items["G-000001"], catalog_data["batches"]["G-000001"][0]["key"])
	depleted_placements = rooms.get("BATCH_PLACEMENTS", {}).get(
		f"{items['G-000001']['item_code']}::{depleted_batch}", [rooms["DEMO_A"]]
	)
	depleted_parts = _quantity_parts(
		catalog_data["batches"]["G-000001"][0]["quantity"],
		len(depleted_placements),
		True,
	)
	depleted_batch_issue = _entry(
		company,
		"deplete-batch",
		"Issue",
		[
			_line(
				items["G-000001"],
				quantity,
				source=warehouse,
				batch_no=depleted_batch,
				use_serial_batch_fields=1,
			)
			for warehouse, quantity in zip(depleted_placements, depleted_parts, strict=True)
		],
		-390,
	)
	documents.append(depleted_batch_issue)
	reconciliation = _count(company, rooms, items)
	assert_balances(rooms, loans, items)
	return {
		"items": len(items),
		"item_codes": {key: item["item_code"] for key, item in items.items()},
		"costume_item_codes": costume_item_codes,
		"images": (
			sum(len(row["images"]) for row in catalog_data["items"] + costumes) if attach_images else 0
		),
		"transactions": len(documents) + 3,
		"volume_counts": len(volume_counts),
		"opening": opening["general"].name,
		"costume_opening": opening["costumes"].name,
		"stock_entries": [
			opening["general"].name,
			opening["costumes"].name,
			*[doc.name for doc in documents],
		],
		"reconciliation": reconciliation.name,
		"loans": [loan.name for loan in loans],
		"activity": activity,
		"rooms": rooms,
	}


def assert_balances(rooms, loans, items):
	for key, expected in (("DEMO_A", 68), ("DEMO_SHELF", 7), ("LEASE", 21), ("DAMAGED", 3)):
		actual = get_stock_balance(items["N-WORKFLOW"]["item_code"], rooms[key])
		if actual != expected:
			raise AssertionError(f"Native sample balance mismatch at {key}: {actual} != {expected}")
	for loan, expected in zip(loans, (11, 8, 2, 0), strict=True):
		settled = sum(sum(values.values()) for values in loan_balances(loan.name).values())
		if Decimal(str(loan.get("items")[0].transfer_qty)) - settled != expected:
			raise AssertionError("Native sample original-loan balance mismatch")
