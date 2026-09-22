"""
ERPNext / Frappe Phase 1 样本库存导入脚本
========================================

建议位置：
    apps/temple_inventory/temple_inventory/setup/sample_inventory_data.py

运行示例：
    bench --site development.localhost execute \
      temple_inventory.setup.sample_inventory_data.import_sample_data \
      --kwargs "{'company': '你的公司全称'}"

说明：
1. 创建/更新 Item Group（分类）及其 Description。
2. 创建 Item 时通过 Temple Inventory 的共享并发安全分配器生成 ITM-xxxxxx；样本数据中的 ITM-xxxxxx 仅作为内部样本键。
3. 自动创建缺失的仓库层级：第1寺院、第2寺院为组仓库，A02/A04/... 为第2寺院下的实际仓库。
4. 创建 Batch，包括已经过期的测试批次。
5. 使用 Stock Reconciliation（Purpose=Opening Stock）建立初始库存，并自动使用公司的 Temporary Opening 账户作为 Difference Account。
6. 批次物品按所需历史过账日期分组创建 Stock Reconciliation；脚本会自动确保这些日期所属的 Fiscal Year 已存在并分配给当前 Company，并默认提交库存凭证。
7. 默认不会重复建立已有库存：如果该物品在对应仓库已有非零库存，脚本会跳过。
   因此最适合空白测试站点或刚 reinstall 的站点。
8. 如果 setup/sample_images/approved_images.json 存在，则把人工审核通过的图片作为公开 File 附件上传并设置为 Item.image。

ERPNext v15+ 使用 Serial and Batch Bundle。脚本通过 Stock Reconciliation Item 的 batch_no /
use_serial_batch_fields 让 ERPNext 自己创建相关 Bundle，而不是直接写 Stock Ledger。
"""

from __future__ import annotations

from datetime import date, datetime, timedelta
from pathlib import Path
import json

import frappe
from frappe.utils import flt, getdate
from frappe.utils.file_manager import save_file
from temple_inventory.item_code import allocate_item_code


AS_OF_DATE = "2026-09-18"

# 图片工具 finalize 后，把整个 image_review 目录复制/改名为本模块旁的 sample_images：
# temple_inventory/setup/sample_images/approved_images.json
# temple_inventory/setup/sample_images/approved_images/ITM-xxxxxx.jpg
# SAMPLE_IMAGE_DIR = Path(__file__).resolve().parent / "sample_assets" / "images" / "general"
SAMPLE_IMAGE_DIR = Path(__file__).resolve().parent / "sample_assets" / "images"
SAMPLE_ASSET_ROOT = Path(__file__).resolve().parent / "sample_assets"
SAMPLE_IMAGE_MANIFEST = Path(__file__).resolve().parent / "sample_assets" / "manifest.json"

CATEGORIES = [('食品', '食品、饮料、调味品及其他可食用物资。'), ('餐具与耗材', '餐盘、杯子、餐盒、一次性手套等日常使用或一次性消耗物资。'), ('佛事用品', '海青、居士服、僧帽、香、念珠等佛事及宗教活动相关用品。'), ('家具与大型用品', '桌椅、垃圾桶、储物箱等体积较大的通用用品。'), ('节日装饰', '灯笼、莲花、大型金属骨架装饰、彩灯等节日或活动装饰用品。'), ('电子与科技', '电脑周边、数据线、扩展坞、UPS、摄像头及小型电子设备。'), ('建筑维护', '灯泡、窗帘、吊顶材料、空调过滤材料等建筑及设施维护用品。'), ('园艺与户外', '肥料、耙子及园林、草坪、户外维护相关物资。'), ('工具与设备', '手工具、电动或燃油设备、电池、油壶等维修及作业设备。'), ('美妆个护', '眼影、腮红、口红、粉底、润唇膏等美妆及个人护理用品。'), ('药品与健康', '药膏、洗手液及其他健康、卫生、急救相关物资。'), ('服装与纺织品', '冬季裤装、保暖手套等非佛事用途的普通服装及纺织品。')]

WAREHOUSE_METADATA = [('第1寺院', '场所', '', '预留用于未来扩展。'), ('第2寺院', '场所', '', '目前主要库存及日常运营地点。'), ('A02', '房间', '第2寺院', '一般用品、餐具耗材、部分药品及近期捐赠箱。'), ('A04', '房间', '第2寺院', '佛事用品、演出服装、节日装饰、部分大型用品及近期捐赠箱。'), ('A14', '房间', '第2寺院', '建筑维护材料。'), ('B01b', '房间', '第2寺院', '电子及科技用品。'), ('C01', '房间', '第2寺院', '一般备用储物空间；本样本仅少量使用。'), ('C02', '房间', '第2寺院', '餐盒及一次性食品包装用品。'), ('C03', '房间', '第2寺院', '食品、主食、调味品及部分餐具耗材。'), ('D01', '房间', '第2寺院', '肥料、园艺用品及美妆个护用品。'), ('D02', '房间', '第2寺院', '户外设备、电池、铲子及其他作业工具。'), ('D03', '房间', '第2寺院', '手工具。')]

ITEMS = [('ITM-000001', '婴儿配方奶粉 800克', '食品', 'C03', 1, 18.0, '混合捐赠', '有有效期，使用批次管理。'), ('ITM-000002', '牛奶巧克力 盒装', '食品', 'C03', 1, 6.5, '混合捐赠', '有最佳食用日期，使用批次管理。'), ('ITM-000003', '食用植物油 1加仑', '食品', 'C03', 1, 12.0, '混合捐赠', '有最佳食用日期，使用批次管理。'), ('ITM-000004', '白砂糖 50磅袋', '食品', 'C03', 0, 29.0, '混合捐赠', '库存单位为整袋。'), ('ITM-000005', '榨菜 80克包', '食品', 'C03', 1, 0.85, '混合捐赠', '有有效期，使用批次管理。'), ('ITM-000006', '大米 25磅袋', '食品', 'C03', 0, 19.0, '混合捐赠', '一般主食库存。'), ('ITM-000007', '面粉 25磅袋', '食品', 'C03', 0, 15.0, '混合捐赠', '一般主食库存。'), ('ITM-000008', '白色一次性餐盘', '餐具与耗材', 'A02', 0, 0.08, '混合捐赠', '库存单位为单个餐盘。'), ('ITM-000009', '万圣节主题餐盘', '餐具与耗材', 'A04', 0, 0.12, '王喆媛公司', '近期成箱捐赠物资。'), ('ITM-000010', '圣诞节主题餐盘', '餐具与耗材', 'A02', 0, 0.12, '王喆媛公司', '近期成箱捐赠物资。'), ('ITM-000011', '塑料汤匙', '餐具与耗材', 'C03', 0, 0.03, '混合捐赠', '库存单位为单个汤匙。'), ('ITM-000012', '透明塑料杯 16盎司', '餐具与耗材', 'A02', 0, 0.07, '混合捐赠', '一次性饮用杯。'), ('ITM-000013', '塑料餐盒 带盖', '餐具与耗材', 'C02', 0, 0.22, '混合捐赠', '一次性打包餐盒。'), ('ITM-000014', '一次性塑料手套', '餐具与耗材', 'A02', 0, 0.04, '王喆媛公司', '近期成箱捐赠物资。'), ('ITM-000015', '纸巾盒', '餐具与耗材', 'C01', 0, 1.2, '混合捐赠', '用于让 C01 也有少量测试库存。'), ('ITM-000016', '僧帽', '佛事用品', 'A04', 0, 14.0, '寺院原有库存', ''), ('ITM-000017', '海青', '佛事用品', 'A04', 0, 28.0, '寺院原有库存', ''), ('ITM-000018', '居士服', '佛事用品', 'A04', 0, 24.0, '寺院原有库存', ''), ('ITM-000019', '线香 一盒', '佛事用品', 'A04', 0, 3.5, '混合捐赠', ''), ('ITM-000020', '念珠', '佛事用品', 'A04', 0, 5.0, '混合捐赠', ''), ('ITM-000021', '折叠桌 6英尺', '家具与大型用品', 'A02', 0, 55.0, '寺院原有库存', ''), ('ITM-000022', '折叠椅', '家具与大型用品', 'A04', 0, 18.0, '寺院原有库存', ''), ('ITM-000023', '大塑料垃圾桶 32加仑', '家具与大型用品', 'A04', 0, 27.0, '寺院原有库存', 'A04 与 A02 均有库存。'), ('ITM-000024', '塑料储物箱 27加仑', '家具与大型用品', 'A02', 0, 14.0, '混合捐赠', ''), ('ITM-000025', '红色灯笼', '节日装饰', 'A04', 0, 4.5, '寺院原有库存', ''), ('ITM-000026', '大莲花装饰', '节日装饰', 'A04', 0, 45.0, '寺院原有库存', ''), ('ITM-000027', '大型金属骨架节日装饰', '节日装饰', 'A04', 0, 85.0, '寺院原有库存', '大型装饰内部带金属支撑结构。'), ('ITM-000028', '彩灯串 100灯', '节日装饰', 'A04', 0, 9.0, '混合捐赠', ''), ('ITM-000029', 'USB-C 数据线', '电子与科技', 'B01b', 0, 4.0, '混合捐赠', ''), ('ITM-000030', 'HDMI 线 6英尺', '电子与科技', 'B01b', 0, 6.0, '混合捐赠', ''), ('ITM-000031', 'USB-C 扩展坞', '电子与科技', 'B01b', 0, 38.0, '寺院原有库存', ''), ('ITM-000032', 'UPS 不间断电源', '电子与科技', 'B01b', 0, 90.0, '寺院原有库存', ''), ('ITM-000033', 'USB 摄像头', '电子与科技', 'B01b', 0, 25.0, '混合捐赠', ''), ('ITM-000034', '有线鼠标', '电子与科技', 'B01b', 0, 7.0, '混合捐赠', ''), ('ITM-000035', '无线鼠标', '电子与科技', 'B01b', 0, 11.0, '混合捐赠', ''), ('ITM-000036', '小型太阳能充电板', '电子与科技', 'A04', 0, 24.0, '混合捐赠', '用于给小型电子产品充电。'), ('ITM-000037', 'LED 灯泡 A19', '建筑维护', 'A14', 0, 2.5, '寺院原有库存', ''), ('ITM-000038', '卷帘窗帘', '建筑维护', 'A14', 0, 22.0, '寺院原有库存', ''), ('ITM-000039', '吊顶板 2×4英尺', '建筑维护', 'A14', 0, 8.0, '寺院原有库存', ''), ('ITM-000040', '吊顶主龙骨 12英尺', '建筑维护', 'A14', 0, 7.5, '寺院原有库存', ''), ('ITM-000041', '吊顶副龙骨 4英尺', '建筑维护', 'A14', 0, 2.5, '寺院原有库存', ''), ('ITM-000042', '大型空调过滤网', '建筑维护', 'A14', 0, 28.0, '寺院原有库存', '用于大型空调/压缩机系统。'), ('ITM-000043', 'Milorganite 缓释肥 32磅', '园艺与户外', 'D01', 0, 17.0, '寺院原有库存', ''), ('ITM-000044', '10-10-10 复合肥 40磅', '园艺与户外', 'D01', 0, 21.0, '寺院原有库存', ''), ('ITM-000045', 'Vigoro 速效肥 30-0-2', '园艺与户外', 'D01', 0, 19.0, '寺院原有库存', ''), ('ITM-000046', '塑料耙子', '园艺与户外', 'D01', 0, 13.0, '寺院原有库存', ''), ('ITM-000047', '汽油油壶 5加仑', '工具与设备', 'D02', 0, 18.0, '寺院原有库存', ''), ('ITM-000048', 'EGO 电池 7.5Ah', '工具与设备', 'D02', 0, 220.0, '寺院原有库存', ''), ('ITM-000049', 'EGO 电池 2.5Ah', '工具与设备', 'D02', 0, 120.0, '寺院原有库存', ''), ('ITM-000050', 'Ryobi 燃油手持吹风机', '工具与设备', 'D02', 0, 95.0, '寺院原有库存', ''), ('ITM-000051', '尖头铁铲', '工具与设备', 'D02', 0, 24.0, '寺院原有库存', ''), ('ITM-000052', '圆头铁铲', '工具与设备', 'D02', 0, 24.0, '寺院原有库存', ''), ('ITM-000053', '篱笆剪', '工具与设备', 'D02', 0, 28.0, '寺院原有库存', ''), ('ITM-000054', '铁锤', '工具与设备', 'D03', 0, 12.0, '寺院原有库存', ''), ('ITM-000055', '钳子', '工具与设备', 'D03', 0, 10.0, '寺院原有库存', ''), ('ITM-000056', '眼影盘', '美妆个护', 'D01', 0, 8.0, '混合捐赠', ''), ('ITM-000057', '腮红', '美妆个护', 'D01', 0, 6.0, '混合捐赠', ''), ('ITM-000058', '口红', '美妆个护', 'D01', 0, 5.0, '混合捐赠', ''), ('ITM-000059', '粉底液', '美妆个护', 'D01', 0, 9.0, '混合捐赠', ''), ('ITM-000060', '润唇膏', '美妆个护', 'D01', 0, 2.5, '混合捐赠', ''), ('ITM-000061', '外用药膏 30克', '药品与健康', 'A02', 1, 4.0, '混合捐赠', '有有效期，使用批次管理。'), ('ITM-000062', '免洗洗手液 8盎司', '药品与健康', 'A02', 1, 2.0, '王喆媛公司', '近期捐赠；有有效期，使用批次管理。'), ('ITM-000063', '冬季长裤', '服装与纺织品', 'A04', 0, 14.0, '王喆媛公司', '近期成箱捐赠物资。'), ('ITM-000064', '保暖手套', '服装与纺织品', 'A02', 0, 6.0, '王喆媛公司', '近期成箱捐赠物资。')]

OPENING_STOCK = [('ITM-000004', '白砂糖 50磅袋', 'C03', 18, 29.0, '', '', '混合捐赠', '否', '库存单位为整袋。'), ('ITM-000006', '大米 25磅袋', 'C03', 22, 19.0, '', '', '混合捐赠', '否', '一般主食库存。'), ('ITM-000007', '面粉 25磅袋', 'C03', 14, 15.0, '', '', '混合捐赠', '否', '一般主食库存。'), ('ITM-000008', '白色一次性餐盘', 'A02', 480, 0.08, '', '', '混合捐赠', '否', '库存单位为单个餐盘。'), ('ITM-000009', '万圣节主题餐盘', 'A04', 360, 0.12, '', '', '王喆媛公司', '否', '近期成箱捐赠物资。'), ('ITM-000010', '圣诞节主题餐盘', 'A02', 420, 0.12, '', '', '王喆媛公司', '否', '近期成箱捐赠物资。'), ('ITM-000011', '塑料汤匙', 'C03', 900, 0.03, '', '', '混合捐赠', '否', '库存单位为单个汤匙。'), ('ITM-000012', '透明塑料杯 16盎司', 'A02', 650, 0.07, '', '', '混合捐赠', '否', '一次性饮用杯。'), ('ITM-000013', '塑料餐盒 带盖', 'C02', 310, 0.22, '', '', '混合捐赠', '否', '一次性打包餐盒。'), ('ITM-000014', '一次性塑料手套', 'A02', 1600, 0.04, '', '', '王喆媛公司', '否', '近期成箱捐赠物资。'), ('ITM-000015', '纸巾盒', 'C01', 36, 1.2, '', '', '混合捐赠', '否', '用于让 C01 也有少量测试库存。'), ('ITM-000016', '僧帽', 'A04', 9, 14.0, '', '', '寺院原有库存', '否', ''), ('ITM-000017', '海青', 'A04', 28, 28.0, '', '', '寺院原有库存', '否', ''), ('ITM-000018', '居士服', 'A04', 34, 24.0, '', '', '寺院原有库存', '否', ''), ('ITM-000019', '线香 一盒', 'A04', 75, 3.5, '', '', '混合捐赠', '否', ''), ('ITM-000020', '念珠', 'A04', 41, 5.0, '', '', '混合捐赠', '否', ''), ('ITM-000021', '折叠桌 6英尺', 'A02', 14, 55.0, '', '', '寺院原有库存', '否', ''), ('ITM-000022', '折叠椅', 'A04', 86, 18.0, '', '', '寺院原有库存', '否', ''), ('ITM-000023', '大塑料垃圾桶 32加仑', 'A04', 6, 27.0, '', '', '寺院原有库存', '否', '分布在 A04 与 A02。'), ('ITM-000023', '大塑料垃圾桶 32加仑', 'A02', 3, 27.0, '', '', '寺院原有库存', '否', '分布在 A04 与 A02。'), ('ITM-000024', '塑料储物箱 27加仑', 'A02', 18, 14.0, '', '', '混合捐赠', '否', ''), ('ITM-000025', '红色灯笼', 'A04', 72, 4.5, '', '', '寺院原有库存', '否', ''), ('ITM-000026', '大莲花装饰', 'A04', 4, 45.0, '', '', '寺院原有库存', '否', ''), ('ITM-000027', '大型金属骨架节日装饰', 'A04', 3, 85.0, '', '', '寺院原有库存', '否', '大型装饰内部带金属支撑结构。'), ('ITM-000028', '彩灯串 100灯', 'A04', 24, 9.0, '', '', '混合捐赠', '否', ''), ('ITM-000029', 'USB-C 数据线', 'B01b', 48, 4.0, '', '', '混合捐赠', '否', ''), ('ITM-000030', 'HDMI 线 6英尺', 'B01b', 31, 6.0, '', '', '混合捐赠', '否', ''), ('ITM-000031', 'USB-C 扩展坞', 'B01b', 7, 38.0, '', '', '寺院原有库存', '否', ''), ('ITM-000032', 'UPS 不间断电源', 'B01b', 5, 90.0, '', '', '寺院原有库存', '否', ''), ('ITM-000033', 'USB 摄像头', 'B01b', 12, 25.0, '', '', '混合捐赠', '否', ''), ('ITM-000034', '有线鼠标', 'B01b', 26, 7.0, '', '', '混合捐赠', '否', ''), ('ITM-000035', '无线鼠标', 'B01b', 19, 11.0, '', '', '混合捐赠', '否', ''), ('ITM-000036', '小型太阳能充电板', 'A04', 6, 24.0, '', '', '混合捐赠', '否', '用于给小型电子产品充电。'), ('ITM-000037', 'LED 灯泡 A19', 'A14', 96, 2.5, '', '', '寺院原有库存', '否', ''), ('ITM-000038', '卷帘窗帘', 'A14', 17, 22.0, '', '', '寺院原有库存', '否', ''), ('ITM-000039', '吊顶板 2×4英尺', 'A14', 44, 8.0, '', '', '寺院原有库存', '否', ''), ('ITM-000040', '吊顶主龙骨 12英尺', 'A14', 19, 7.5, '', '', '寺院原有库存', '否', ''), ('ITM-000041', '吊顶副龙骨 4英尺', 'A14', 38, 2.5, '', '', '寺院原有库存', '否', ''), ('ITM-000042', '大型空调过滤网', 'A14', 12, 28.0, '', '', '寺院原有库存', '否', '用于大型空调/压缩机系统。'), ('ITM-000043', 'Milorganite 缓释肥 32磅', 'D01', 11, 17.0, '', '', '寺院原有库存', '否', ''), ('ITM-000044', '10-10-10 复合肥 40磅', 'D01', 7, 21.0, '', '', '寺院原有库存', '否', ''), ('ITM-000045', 'Vigoro 速效肥 30-0-2', 'D01', 8, 19.0, '', '', '寺院原有库存', '否', ''), ('ITM-000046', '塑料耙子', 'D01', 6, 13.0, '', '', '寺院原有库存', '否', ''), ('ITM-000047', '汽油油壶 5加仑', 'D02', 4, 18.0, '', '', '寺院原有库存', '否', ''), ('ITM-000048', 'EGO 电池 7.5Ah', 'D02', 2, 220.0, '', '', '寺院原有库存', '否', ''), ('ITM-000049', 'EGO 电池 2.5Ah', 'D02', 3, 120.0, '', '', '寺院原有库存', '否', ''), ('ITM-000050', 'Ryobi 燃油手持吹风机', 'D02', 2, 95.0, '', '', '寺院原有库存', '否', ''), ('ITM-000051', '尖头铁铲', 'D02', 5, 24.0, '', '', '寺院原有库存', '否', ''), ('ITM-000052', '圆头铁铲', 'D02', 4, 24.0, '', '', '寺院原有库存', '否', ''), ('ITM-000053', '篱笆剪', 'D02', 3, 28.0, '', '', '寺院原有库存', '否', ''), ('ITM-000054', '铁锤', 'D03', 7, 12.0, '', '', '寺院原有库存', '否', ''), ('ITM-000055', '钳子', 'D03', 9, 10.0, '', '', '寺院原有库存', '否', ''), ('ITM-000056', '眼影盘', 'D01', 36, 8.0, '', '', '混合捐赠', '否', ''), ('ITM-000057', '腮红', 'D01', 33, 6.0, '', '', '混合捐赠', '否', ''), ('ITM-000058', '口红', 'D01', 47, 5.0, '', '', '混合捐赠', '否', ''), ('ITM-000059', '粉底液', 'D01', 26, 9.0, '', '', '混合捐赠', '否', ''), ('ITM-000060', '润唇膏', 'D01', 54, 2.5, '', '', '混合捐赠', '否', ''), ('ITM-000063', '冬季长裤', 'A04', 68, 14.0, '', '', '王喆媛公司', '否', '近期成箱捐赠物资。'), ('ITM-000064', '保暖手套', 'A02', 42, 6.0, '', '', '王喆媛公司', '否', '近期成箱捐赠物资。'), ('ITM-000001', '婴儿配方奶粉 800克', 'C03', 6, 18.0, 'BAT-000001', '2025-08-31', '混合捐赠', '是', '有有效期，使用批次管理。'), ('ITM-000001', '婴儿配方奶粉 800克', 'C03', 9, 18.0, 'BAT-000002', '2026-06-30', '混合捐赠', '是', '有有效期，使用批次管理。'), ('ITM-000001', '婴儿配方奶粉 800克', 'C03', 17, 18.0, 'BAT-000003', '2027-03-31', '混合捐赠', '否', '有有效期，使用批次管理。'), ('ITM-000002', '牛奶巧克力 盒装', 'C03', 24, 6.5, 'BAT-000004', '2025-12-31', '混合捐赠', '是', '有最佳食用日期，使用批次管理。'), ('ITM-000002', '牛奶巧克力 盒装', 'C03', 18, 6.5, 'BAT-000005', '2026-08-31', '混合捐赠', '是', '有最佳食用日期，使用批次管理。'), ('ITM-000002', '牛奶巧克力 盒装', 'C03', 42, 6.5, 'BAT-000006', '2027-05-31', '混合捐赠', '否', '有最佳食用日期，使用批次管理。'), ('ITM-000003', '食用植物油 1加仑', 'C03', 4, 12.0, 'BAT-000007', '2026-05-31', '混合捐赠', '是', '有最佳食用日期，使用批次管理。'), ('ITM-000003', '食用植物油 1加仑', 'C03', 11, 12.0, 'BAT-000008', '2027-01-31', '混合捐赠', '否', '有最佳食用日期，使用批次管理。'), ('ITM-000003', '食用植物油 1加仑', 'C03', 8, 12.0, 'BAT-000009', '2028-02-29', '混合捐赠', '否', '有最佳食用日期，使用批次管理。'), ('ITM-000005', '榨菜 80克包', 'C03', 35, 0.85, 'BAT-000010', '2025-10-31', '混合捐赠', '是', '有有效期，使用批次管理。'), ('ITM-000005', '榨菜 80克包', 'C03', 48, 0.85, 'BAT-000011', '2026-07-31', '混合捐赠', '是', '有有效期，使用批次管理。'), ('ITM-000005', '榨菜 80克包', 'C03', 96, 0.85, 'BAT-000012', '2027-04-30', '混合捐赠', '否', '有有效期，使用批次管理。'), ('ITM-000061', '外用药膏 30克', 'A02', 8, 4.0, 'BAT-000013', '2025-09-30', '混合捐赠', '是', '有有效期，使用批次管理。'), ('ITM-000061', '外用药膏 30克', 'A02', 11, 4.0, 'BAT-000014', '2026-08-31', '混合捐赠', '是', '有有效期，使用批次管理。'), ('ITM-000061', '外用药膏 30克', 'A02', 21, 4.0, 'BAT-000015', '2027-11-30', '混合捐赠', '否', '有有效期，使用批次管理。'), ('ITM-000062', '免洗洗手液 8盎司', 'A02', 24, 2.0, 'BAT-000016', '2026-03-31', '王喆媛公司', '是', '近期捐赠；有有效期，使用批次管理。'), ('ITM-000062', '免洗洗手液 8盎司', 'A02', 60, 2.0, 'BAT-000017', '2027-08-31', '王喆媛公司', '否', '近期捐赠；有有效期，使用批次管理。'), ('ITM-000062', '免洗洗手液 8盎司', 'A02', 84, 2.0, 'BAT-000018', '2028-04-30', '王喆媛公司', '否', '近期捐赠；有有效期，使用批次管理。')]

BATCH_SPECS = {'ITM-000001': [('BAT-000001', '2025-01-15', '2025-08-31', 6), ('BAT-000002', '2025-09-01', '2026-06-30', 9), ('BAT-000003', '2026-04-10', '2027-03-31', 17)], 'ITM-000002': [('BAT-000004', '2025-02-01', '2025-12-31', 24), ('BAT-000005', '2025-11-01', '2026-08-31', 18), ('BAT-000006', '2026-06-15', '2027-05-31', 42)], 'ITM-000003': [('BAT-000007', '2025-05-01', '2026-05-31', 4), ('BAT-000008', '2026-01-15', '2027-01-31', 11), ('BAT-000009', '2026-08-01', '2028-02-29', 8)], 'ITM-000005': [('BAT-000010', '2025-01-10', '2025-10-31', 35), ('BAT-000011', '2025-08-15', '2026-07-31', 48), ('BAT-000012', '2026-05-20', '2027-04-30', 96)], 'ITM-000061': [('BAT-000013', '2024-10-01', '2025-09-30', 8), ('BAT-000014', '2025-08-01', '2026-08-31', 11), ('BAT-000015', '2026-05-01', '2027-11-30', 21)], 'ITM-000062': [('BAT-000016', '2025-03-01', '2026-03-31', 24), ('BAT-000017', '2026-01-01', '2027-08-31', 60), ('BAT-000018', '2026-06-01', '2028-04-30', 84)]}


def _get_company(company: str | None = None) -> str:
    if company:
        if not frappe.db.exists("Company", company):
            frappe.throw(f"找不到 Company：{company}")
        return company

    companies = frappe.get_all("Company", pluck="name")
    if len(companies) == 1:
        return companies[0]

    frappe.throw(
        "站点中存在多个 Company。请运行时传入 company，例如："
        "--kwargs \"{'company': '你的公司全称'}\""
    )


def _find_warehouse(warehouse_name: str, company: str) -> str | None:
    """
    按 warehouse_name + company 查找仓库。
    ERPNext 实际 name 通常带公司缩写，例如：
      A02 - ABC
    但 warehouse_name 字段仍然是 A02。
    """
    return frappe.db.get_value(
        "Warehouse",
        {"warehouse_name": warehouse_name, "company": company},
        "name",
    )


def _ensure_warehouses(company: str) -> None:
    """
    根据 WAREHOUSE_METADATA 创建缺失的仓库层级。

    约定：
    - location_type == "场所"：创建为 is_group = 1
    - location_type == "房间"：创建为 is_group = 0
    - 第1寺院、第2寺院挂在公司的根仓库（例如 All Warehouses - ABC）下面
    - A02/A04/... 挂在第2寺院下面

    已存在的仓库不会重复创建。
    """
    # The application installer creates the canonical hierarchy. Never downgrade room groups
    # back to the legacy flat warehouse model.
    if frappe.db.exists("Warehouse", {"warehouse_name": "寺院仓库", "company": company}):
        return
    company_abbr = frappe.db.get_value("Company", company, "abbr")
    if not company_abbr:
        frappe.throw(f"Company {company} 没有设置 abbreviation，无法创建仓库。")

    root_warehouse = frappe.db.get_value(
        "Warehouse",
        {"warehouse_name": "All Warehouses", "company": company},
        "name",
    )
    if not root_warehouse:
        # 标准 ERPNext 通常为 "All Warehouses - <abbr>"
        possible_root = f"All Warehouses - {company_abbr}"
        if frappe.db.exists("Warehouse", possible_root):
            root_warehouse = possible_root

    if not root_warehouse:
        frappe.throw(
            f"找不到 {company} 的根仓库 All Warehouses。"
            "请先确认 Company 已正确创建并完成 ERPNext 初始化。"
        )

    # 先创建父级，再创建子级
    pending = list(WAREHOUSE_METADATA)
    created_or_found = {}

    while pending:
        progressed = False

        for row in pending[:]:
            warehouse_name, location_type, parent_code, description = row

            existing = _find_warehouse(warehouse_name, company)
            if existing:
                created_or_found[warehouse_name] = existing
                pending.remove(row)
                progressed = True
                continue

            if parent_code:
                parent_warehouse = created_or_found.get(parent_code) or _find_warehouse(parent_code, company)
                if not parent_warehouse:
                    # 父仓库尚未创建，留到下一轮
                    continue
            else:
                parent_warehouse = root_warehouse

            doc = frappe.get_doc({
                "doctype": "Warehouse",
                "warehouse_name": warehouse_name,
                "company": company,
                "parent_warehouse": parent_warehouse,
                "is_group": 1 if location_type == "场所" else 0,
            })

            # 某些 ERPNext 版本 Warehouse 有 description 字段，存在则写入。
            if doc.meta.has_field("description") and description:
                doc.description = description

            doc.insert(ignore_permissions=True)
            created_or_found[warehouse_name] = doc.name

            pending.remove(row)
            progressed = True

        if not progressed:
            unresolved = ", ".join(r[0] for r in pending)
            frappe.throw(
                "无法创建完整仓库层级。以下仓库的父级无法解析："
                f"{unresolved}"
            )


def _get_warehouse(room_code: str, company: str) -> str:
    """
    返回实际 ERPNext Warehouse name。
    若不存在，先补齐整个样本仓库层级，再重试。
    """
    name = _find_warehouse(f"{room_code} / 未指定", company) or _find_warehouse(room_code, company)
    if name:
        return name

    _ensure_warehouses(company)

    name = _find_warehouse(f"{room_code} / 未指定", company) or _find_warehouse(room_code, company)
    if name:
        return name

    frappe.throw(f"创建后仍找不到仓库 {room_code}。")


def _ensure_item_groups() -> None:
    for group_name, description in CATEGORIES:
        if frappe.db.exists("Item Group", group_name):
            doc = frappe.get_doc("Item Group", group_name)
            changed = False
            # if (doc.description or "") != description:
            #     doc.description = description
            #     changed = True
            if changed:
                doc.save(ignore_permissions=True)
            continue

        doc = frappe.get_doc({
            "doctype": "Item Group",
            "item_group_name": group_name,
            "parent_item_group": "All Item Groups",
            "is_group": 0,
            "description": description,
        })
        doc.insert(ignore_permissions=True)


def _find_existing_sample_item(item_name: str, item_group: str) -> str | None:
    """
    脚本重复运行时，用 item_name + item_group 唯一匹配既有样本物品。
    如果存在多个匹配项则停止，不进行猜测。
    """
    matches = frappe.get_all(
        "Item",
        filters={"item_name": item_name, "item_group": item_group},
        pluck="name",
    )
    if not matches:
        return None
    if len(matches) == 1:
        return matches[0]
    frappe.throw(
        f"发现多个同名同分类 Item：{item_name} / {item_group}。"
        "无法安全判断哪个是此前导入的样本物品。"
    )


def _ensure_items() -> dict[str, str]:
    """
    创建样本 Item，并返回 {样本键: 实际 ERPNext Item Code}。

    样本数据里的 ITM-000001、ITM-000002... 只是内部样本键，
    不会直接作为新 Item Code 写入系统。

    新编号策略：
    1. 若相同 item_name + item_group 已存在，则直接复用，保证重复运行幂等。
    2. 新物品统一通过共享并发安全分配器取得 ITM-######。
    3. 每次 insert 前再次检查候选编号；若发生 DuplicateEntryError，继续使用共享分配器。
    """
    sample_to_actual: dict[str, str] = {}
    for sample_key, name, category, default_room, batched, rate, source, note in ITEMS:
        existing_code = _find_existing_sample_item(name, category)
        if existing_code:
            sample_to_actual[sample_key] = existing_code
            continue

        item_code = allocate_item_code()

        doc = frappe.get_doc({
            "doctype": "Item",
            "item_code": item_code,
            "item_name": name,
            "item_group": category,
            "stock_uom": "Nos",
            "is_stock_item": 1,
            "has_batch_no": 1 if batched else 0,
            "description": note or name,
        })

        if doc.meta.has_field("valuation_rate"):
            doc.valuation_rate = rate
        if doc.meta.has_field("allow_negative_stock"):
            doc.allow_negative_stock = 0

        while True:
            try:
                doc.item_code = item_code
                doc.name = item_code
                doc.insert(ignore_permissions=True)
                break
            except frappe.DuplicateEntryError:
                item_code = allocate_item_code()
                doc.name = None

        sample_to_actual[sample_key] = item_code

    return sample_to_actual


def _ensure_batches(item_code_map: dict[str, str]) -> None:
    for sample_key, specs in BATCH_SPECS.items():
        item_code = item_code_map[sample_key]
        for batch_no, manufacturing_date, expiry_date, qty in specs:
            if frappe.db.exists("Batch", batch_no):
                batch = frappe.get_doc("Batch", batch_no)
                if batch.item != item_code:
                    frappe.throw(
                        f"Batch {batch_no} 已存在，但属于 {batch.item}，"
                        f"样本数据当前映射要求属于 {item_code}。"
                    )
                continue

            batch = frappe.get_doc({
                "doctype": "Batch",
                "batch_id": batch_no,
                "item": item_code,
                "manufacturing_date": manufacturing_date,
                "expiry_date": expiry_date,
            })
            batch.insert(ignore_permissions=True)


def _posting_date_for_row(batch_no: str | None, expiry_date: str | None) -> str:
    """
    普通库存使用 AS_OF_DATE。
    已过期批次需要在有效期以前做历史入库，否则 ERPNext 会拒绝过期批次的新入库。
    """
    if not batch_no or not expiry_date:
        return AS_OF_DATE

    expiry = getdate(expiry_date)
    as_of = getdate(AS_OF_DATE)

    if expiry >= as_of:
        return AS_OF_DATE

    # 过期批次：在到期日前 30 天做历史 Opening Receipt。
    historical = expiry - timedelta(days=30)
    return historical.isoformat()


def _stock_already_exists(item_code: str, warehouse: str, batch_no: str | None = None) -> bool:
    from erpnext.stock.utils import get_stock_balance

    try:
        if batch_no:
            qty = get_stock_balance(
                item_code,
                warehouse,
                AS_OF_DATE,
                "23:59:59",
                with_valuation_rate=False,
                batch_no=batch_no,
            )
        else:
            qty = get_stock_balance(
                item_code,
                warehouse,
                AS_OF_DATE,
                "23:59:59",
                with_valuation_rate=False,
            )
    except TypeError:
        # 某些版本 get_stock_balance 的签名不接受 batch_no；
        # 对非空白站点保持安全：只检查总库存。
        qty = get_stock_balance(
            item_code,
            warehouse,
            AS_OF_DATE,
            "23:59:59",
            with_valuation_rate=False,
        )

    if isinstance(qty, (tuple, list)):
        qty = qty[0]
    return abs(flt(qty)) > 0.000001


def _fiscal_year_covers_date(fiscal_year_doc, posting_date, company: str) -> bool:
    """Return True when an existing Fiscal Year covers the date and applies to company."""
    posting_date = getdate(posting_date)
    if not (getdate(fiscal_year_doc.year_start_date) <= posting_date <= getdate(fiscal_year_doc.year_end_date)):
        return False

    # ERPNext treats an empty company table as generally applicable.
    companies = {row.company for row in (fiscal_year_doc.get("companies") or []) if row.company}
    return not companies or company in companies


def _ensure_fiscal_year_for_date(posting_date, company: str) -> str:
    """Ensure a usable Fiscal Year exists for one historical posting date.

    The sample data assumes a calendar-year fiscal year when a missing historical
    year must be created. Existing Fiscal Years are always reused when they already
    cover the date.
    """
    posting_date = getdate(posting_date)

    candidates = frappe.get_all(
        "Fiscal Year",
        filters={
            "year_start_date": ["<=", posting_date],
            "year_end_date": [">=", posting_date],
            "disabled": 0,
        },
        pluck="name",
    )

    for name in candidates:
        doc = frappe.get_doc("Fiscal Year", name)
        if _fiscal_year_covers_date(doc, posting_date, company):
            return doc.name

    # If a matching date range already exists but is only assigned to other companies,
    # reuse that Fiscal Year and add this company instead of creating an overlapping year.
    for name in candidates:
        doc = frappe.get_doc("Fiscal Year", name)
        companies = {row.company for row in (doc.get("companies") or []) if row.company}
        if company not in companies:
            doc.append("companies", {"company": company})
            doc.save(ignore_permissions=True)
            return doc.name

    # No Fiscal Year covers the date at all. For this sample/test dataset, create
    # the corresponding calendar year. This is correct for Org's current setup.
    year = posting_date.year
    start_date = date(year, 1, 1)
    end_date = date(year, 12, 31)

    name = str(year)
    if frappe.db.exists("Fiscal Year", name):
        name = f"{year} - {company}"
        suffix = 2
        while frappe.db.exists("Fiscal Year", name):
            name = f"{year} - {company} {suffix}"
            suffix += 1

    doc = frappe.get_doc({
        "doctype": "Fiscal Year",
        "year": name,
        "year_start_date": start_date,
        "year_end_date": end_date,
        "companies": [{"company": company}],
    })
    doc.insert(ignore_permissions=True)
    return doc.name


def _ensure_fiscal_years_for_dates(company: str, posting_dates) -> list[str]:
    """Ensure every Stock Reconciliation posting date has a Fiscal Year."""
    names = []
    for posting_date in sorted({str(getdate(d)) for d in posting_dates}):
        name = _ensure_fiscal_year_for_date(posting_date, company)
        if name not in names:
            names.append(name)
    return names


def _get_temporary_opening_account(company: str) -> str:
    """
    返回该公司的 Temporary Opening / Temporary 类型非组账户。

    ERPNext 的 Opening Stock 必须使用资产负债表类的临时开账账户
    来平衡库存价值，不能使用普通 P&L expense account。
    """
    # 优先按 ERPNext 标准 Account Type 查找。
    accounts = frappe.get_all(
        "Account",
        filters={
            "company": company,
            "account_type": "Temporary",
            "is_group": 0,
            "disabled": 0,
        },
        pluck="name",
    )

    if len(accounts) == 1:
        return accounts[0]

    # 如果有多个 Temporary 账户，优先选择标准的 Temporary Opening。
    if len(accounts) > 1:
        for account in accounts:
            account_name = frappe.db.get_value("Account", account, "account_name")
            if account_name == "Temporary Opening":
                return account

        frappe.throw(
            f"Company {company} 有多个 Temporary 类型账户，无法安全判断哪个用于 Opening Stock："
            + ", ".join(accounts)
        )

    frappe.throw(
        f"Company {company} 没有可用的 Temporary Opening 账户。"
        "请在 Chart of Accounts 中创建/启用一个非组账户，并将 Account Type 设置为 Temporary。"
    )


def _find_existing_sample_reconciliation(
    company: str,
    item_code_map: dict[str, str],
) -> str | None:
    """
    防止重复运行脚本时创建多个相同的通用样本 Stock Reconciliation。

    Stock Reconciliation 没有稳定可用的 remarks 字段，因此按子表中的 Item
    Code 区分导入来源。服装导入只包含服装 Item，不会阻止通用导入。
    """
    candidates = frappe.get_all(
        "Stock Reconciliation",
        {
            "company": company,
            "docstatus": 0,
            "purpose": "Opening Stock",
        },
        pluck="name",
    )
    if not candidates:
        return None

    generic_item_codes = set(item_code_map.values())
    rows = frappe.get_all(
        "Stock Reconciliation Item",
        filters={"parent": ["in", candidates]},
        fields=["parent", "item_code"],
        limit_page_length=0,
    )
    for row in rows:
        if row.item_code in generic_item_codes:
            return row.parent
    return None


def _create_opening_stock(
    company: str,
    item_code_map: dict[str, str],
    submit_stock: int | bool = 1,
) -> dict:
    """Create opening-stock reconciliations with valid historical dates.

    Expired batches are dated before their expiry; current/future batches and
    non-batch items use AS_OF_DATE. Separate documents are used because a
    Stock Reconciliation has one posting date for all rows. Required historical
    Fiscal Years are created/assigned automatically before the documents are inserted.
    Documents are submitted by default; pass ``submit_stock=0`` to leave drafts.
    """
    existing = _find_existing_sample_reconciliation(company, item_code_map)
    if existing:
        existing_doc = frappe.get_doc("Stock Reconciliation", existing)
        if int(submit_stock):
            existing_doc.submit()
        return {
            "stock_reconciliation": existing,
            "stock_reconciliations": [existing],
            "created": False,
            "row_count": frappe.db.count("Stock Reconciliation Item", {"parent": existing}),
            "skipped": [],
            "status": "Submitted" if int(submit_stock) else "Draft",
            "submitted": bool(int(submit_stock)),
            "原因": "已存在本样本数据创建的 Stock Reconciliation 草稿",
        }

    opening_account = _get_temporary_opening_account(company)
    grouped_rows: dict[str, list[dict]] = {}
    skipped = []

    for (
        sample_key,
        item_name,
        room_code,
        qty,
        valuation_rate,
        batch_no,
        expiry_date,
        source,
        expired,
        note,
    ) in OPENING_STOCK:
        item_code = item_code_map[sample_key]
        warehouse = _get_warehouse(room_code, company)
        if _stock_already_exists(item_code, warehouse, batch_no or None):
            skipped.append({
                "item_code": item_code,
                "warehouse": warehouse,
                "batch_no": batch_no or None,
                "原因": "检测到已有库存，未加入 Stock Reconciliation",
            })
            continue

        row = {
            "item_code": item_code,
            "warehouse": warehouse,
            "qty": flt(qty),
            "valuation_rate": flt(valuation_rate),
        }
        if batch_no:
            row["use_serial_batch_fields"] = 1
            row["batch_no"] = batch_no
        posting_date = _posting_date_for_row(batch_no, expiry_date)
        grouped_rows.setdefault(posting_date, []).append(row)

    if not grouped_rows:
        return {
            "stock_reconciliation": None,
            "stock_reconciliations": [],
            "created": False,
            "row_count": 0,
            "skipped": skipped,
            "原因": "没有需要建立的初始库存行",
        }

    fiscal_years = _ensure_fiscal_years_for_dates(company, grouped_rows.keys())

    names = []
    for posting_date in sorted(grouped_rows):
        doc = frappe.get_doc({
            "doctype": "Stock Reconciliation",
            "company": company,
            "purpose": "Opening Stock",
            "posting_date": posting_date,
            "posting_time": "12:00:00",
            "set_posting_time": 1,
            "expense_account": opening_account,
            "items": grouped_rows[posting_date],
        })
        doc.insert(ignore_permissions=True)
        if int(submit_stock):
            doc.submit()
        names.append(doc.name)

    return {
        "stock_reconciliation": names[0],
        "stock_reconciliations": names,
        "created": True,
        "row_count": sum(len(rows) for rows in grouped_rows.values()),
        "skipped": skipped,
        "purpose": "Opening Stock",
        "status": "Submitted" if int(submit_stock) else "Draft",
        "submitted": bool(int(submit_stock)),
        "fiscal_years": fiscal_years,
    }


def _attach_approved_images(
    item_code_map: dict[str, str],
    *,
    replace_existing: bool = False,
) -> dict:
    """
    读取 sample_images/approved_images.json，把已审核批准的图片上传给对应 Item。

    manifest 使用 sample_key（例如 ITM-000048）作为键；实际 ERPNext Item Code
    通过 item_code_map 动态解析，因此数据库现有编号不会影响图片映射。

    默认：
    - manifest 不存在：安全跳过；
    - Item 已经有 image：跳过；
    - approved image 文件缺失：记录 skipped，不中断整个 seed import；
    - 上传为 public File，因为这些只是普通库存展示图。
    """
    result = {"attached": [], "skipped": []}

    if not SAMPLE_IMAGE_MANIFEST.exists():
        result["skipped"].append({
            "原因": "未找到图片审核 manifest",
            "路径": str(SAMPLE_IMAGE_MANIFEST),
        })
        frappe.throw(f"找不到样例图片 manifest：{SAMPLE_IMAGE_MANIFEST}")

    try:
        manifest = json.loads(SAMPLE_IMAGE_MANIFEST.read_text(encoding="utf-8"))
    except Exception as exc:
        frappe.throw(f"无法读取图片 manifest：{SAMPLE_IMAGE_MANIFEST}；{exc}")

    images = {entry["key"]: entry for entry in manifest.get("images", []) if entry.get("dataset") == "general"}
    for sample_key, entry in images.items():

        actual_item_code = item_code_map.get(sample_key)
        if not actual_item_code:
            frappe.throw(f"图片 manifest 中的 {sample_key} 没有对应样例 Item")

        item = frappe.get_doc("Item", actual_item_code)
        if item.image and not replace_existing:
            result["skipped"].append({
                "sample_key": sample_key,
                "item_code": actual_item_code,
                "原因": "Item 已有图片",
                "现有图片": item.image,
            })
            continue

        rel_file = entry.get("output", "")
        if not rel_file:
            frappe.throw(f"图片 manifest 中的 {sample_key} 缺少 output")

        image_path = SAMPLE_ASSET_ROOT / rel_file
        if not image_path.is_file():
            frappe.throw(f"找不到优化图片：{image_path}")

        content = image_path.read_bytes()
        # 使用最终 ERPNext Item Code 命名实际附件，更方便 File Manager 中辨认。
        suffix = image_path.suffix.lower() or ".jpg"
        filename = f"{actual_item_code}{suffix}"
        file_doc = save_file(
            filename,
            content,
            "Item",
            actual_item_code,
            is_private=1,
            df="image",
        )

        item.image = file_doc.file_url
        item.save(ignore_permissions=True)

        result["attached"].append({
            "sample_key": sample_key,
            "item_code": actual_item_code,
            "file_url": file_doc.file_url,
            "source_page": entry.get("source_page", ""),
        })

    return result


@frappe.whitelist()
def import_sample_data(
    company: str | None = None,
    create_stock: int | bool = 1,
    submit_stock: int | bool = 1,
    attach_images: int | bool = 1,
    replace_images: int | bool = 0,
):
    """
    主要入口。

    示例：
      bench --site development.localhost execute \
        temple_inventory.setup.sample_inventory_data.import_sample_data \
        --kwargs "{'company': 'My Company'}"

    只建 master data，不建立库存：
      ... --kwargs "{'company': 'My Company', 'create_stock': 0}"

        建立库存但保留 Stock Reconciliation 草稿：
            ... --kwargs "{'company': 'My Company', 'submit_stock': 0}"
    """
    company = _get_company(company)

    _ensure_warehouses(company)
    _ensure_item_groups()
    item_code_map = _ensure_items()
    _ensure_batches(item_code_map)

    stock_result = {
        "stock_reconciliation": None,
        "created": False,
        "row_count": 0,
        "skipped": [],
    }
    if int(create_stock):
        stock_result = _create_opening_stock(
            company,
            item_code_map,
            submit_stock=submit_stock,
        )

    image_result = {"attached": [], "skipped": []}
    if int(attach_images):
        image_result = _attach_approved_images(
            item_code_map,
            replace_existing=bool(int(replace_images)),
        )

    return {
        "company": company,
        "仓库定义数量": len(WAREHOUSE_METADATA),
        "分类数量": len(CATEGORIES),
        "物品数量": len(ITEMS),
        "Item Code 映射": item_code_map,
        "批次数量": sum(len(v) for v in BATCH_SPECS.values()),
        "Stock Reconciliation": stock_result.get("stock_reconciliation"),
        "新建 Stock Reconciliation": stock_result.get("created", False),
        "Stock Reconciliation 行数": stock_result.get("row_count", 0),
        "库存凭证模式": "Stock Reconciliation（已提交）" if stock_result.get("submitted") else "Stock Reconciliation（草稿）",
        "跳过库存行数量": len(stock_result.get("skipped", [])),
        "库存结果": stock_result,
        "已附加图片数量": len(image_result["attached"]),
        "图片结果": image_result,
    }
