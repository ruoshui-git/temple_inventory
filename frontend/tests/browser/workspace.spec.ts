import {test,expect} from '@playwright/test'
import {readFile} from 'node:fs/promises'
import path from 'node:path'
const tree=[{name:'root',warehouse_name:'寺院仓库',is_group:1,lft:1,rgt:8},{name:'room',warehouse_name:'A01',warehouse_type:'Room',is_group:1,lft:2,rgt:7,parent_warehouse:'root'},{name:'shelf',warehouse_name:'东架',warehouse_type:'Location',is_group:0,lft:3,rgt:4,parent_warehouse:'room'},{name:'west',warehouse_name:'西架',warehouse_type:'Location',is_group:0,lft:5,rgt:6,parent_warehouse:'room'}]
const item={item_code:'RICE',item_name:'大米',item_group:'食品',stock_uom:'Nos',has_batch_no:false,uoms:[],stock:[{warehouse:'shelf',actual_qty:8}],total_stock:8,available_stock:8,history:[]}
const boot={user:'volunteer@example.invalid',is_manager:true,capabilities:{Item:true,UOM:true,Batch:true,'Inventory Activity':true,Warehouse:true},settings:{company:'Temple',root_warehouse:'root',pending_warehouse:'shelf'},warehouse_tree:tree,warehouses:tree.filter(w=>!w.is_group),item_groups:[{name:'食品',item_group_name:'食品'}],uoms:[{name:'Nos',uom_name:'Nos'}],batch:{enabled:true}}
test.beforeEach(async({page})=>{
 let workspace:any={name:'IW-test',revision:1,docstatus:0,stock_entry:null,sync_error:'',attachments:[],data:{movement_kind:'Receive',posting_date:'2026-09-17',posting_time:'12:00:00',source_text:'Donation',responsible_person:boot.user,recorder_signature:'',notes:'',items:[],sections:[]}}
 await page.route('**/api/method/**',async route=>{
  const method=route.request().url().split('.').pop();let args:any={};try{args=route.request().postDataJSON()||{}}catch{}
  let result:any
  switch(method){
   case 'bootstrap':result=boot;break
   case 'inventory':result=[];break
   case 'responsible_people':result=[{name:boot.user,full_name:'王某'}];break
   case 'activities':result=[];break
   case 'create_workspace':workspace={...workspace,data:args.data,revision:workspace.revision+1};result=workspace;break
   case 'load_workspace':result=workspace;break
   case 'save_workspace':workspace={...workspace,data:args.data,revision:workspace.revision+1,stock_entry:args.data.items.length?'STE-test':null};result=workspace;break
   case 'confirm_workspace':workspace={...workspace,docstatus:1,revision:workspace.revision+1};result=workspace;break
   case 'search_items':result={results:[item],total:1};break
   case 'item_detail':result=item;break
   case 'scan':result=args.value==='6931234567890'?{item_code:'RICE'}:{unknown:true,barcode:args.value};break
   case 'session_info':result={user:boot.user,csrf_token:'test'};break
   default:result=[]
  }
  await route.fulfill({json:{message:result}})
 })
 await page.route('**/assets/frappe/**',async route=>{const url=new URL(route.request().url());const relative=url.pathname.replace('/assets/frappe/','');const file=path.resolve('../..','frappe','frappe','public',relative);try{await route.fulfill({body:await readFile(file),contentType:'application/javascript'})}catch{await route.abort()}})
})
test('mobile receiving retains state through item selection, autosaves and confirms',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message))
 await page.goto('/inventory/new/Receive');await expect(page.getByRole('heading',{name:'入库',exact:true})).toBeVisible()
 await page.getByRole('button',{name:'添加详细信息',exact:true}).click();await page.getByLabel('来源').fill('张三');await page.getByLabel('无独立鉴证人').check()
 await page.getByRole('button',{name:'＋添加物品',exact:true}).click()
 await page.getByRole('button',{name:/大米/}).click()
 await page.getByRole('dialog',{name:'数量与位置'}).getByRole('spinbutton').fill('3')
 await page.getByRole('button',{name:'添加',exact:true}).click()
 await expect(page.getByText('3 Nos',{exact:false})).toBeVisible()
 await expect(page.getByRole('status')).toHaveText('✓ 已保存');await expect(page).toHaveURL(/\/inventory\/workspace\/IW-test$/)
 await page.reload();await page.getByRole('button',{name:'添加详细信息',exact:true}).click();await expect(page.getByLabel('来源')).toHaveValue('张三');await expect(page.getByText('3 Nos',{exact:false})).toBeVisible()
 await page.getByLabel('手写签名').scrollIntoViewIfNeeded();const box=await page.getByLabel('手写签名').boundingBox();await page.mouse.move(box!.x+20,box!.y+30);await page.mouse.down();await page.mouse.move(box!.x+130,box!.y+70,{steps:5});await page.mouse.up()
 await page.getByRole('button',{name:'查看确认摘要'}).click();await expect(page.getByText('✓ 已签名',{exact:true})).toBeVisible();await page.getByRole('button',{name:'确认入库',exact:true}).click();await expect(page.getByRole('status')).toHaveText('已完成 ✓');expect(errors).toEqual([])
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
})
test('unknown scanned code prefills inline creation and preserves donor',async({page})=>{
 await page.goto('/inventory/new/Receive');await page.getByRole('button',{name:'添加详细信息',exact:true}).click();await page.getByLabel('来源').fill('张三');await page.getByLabel('无独立鉴证人').check();await page.getByRole('button',{name:'▣ 连续扫码'}).click();await page.getByLabel('条码 / 编号 / 扫码枪').fill('999999');await page.getByRole('button',{name:'查找',exact:true}).click();await expect(page.getByRole('heading',{name:'创建新物品'})).toBeVisible();await expect(page.getByLabel('条码',{exact:true})).toHaveValue('999999');await page.getByRole('button',{name:'×',exact:true}).click();await expect(page.getByLabel('来源')).toHaveValue('张三')
})
test('real Framework scanner decodes camera frames without BarcodeDetector',async({page})=>{
 test.skip(!process.env.SCAN_VIDEO,'Set SCAN_VIDEO to a Y4M containing barcode 6931234567890')
 await page.addInitScript(()=>{delete (window as any).BarcodeDetector})
 await page.goto('/inventory/new/Receive');await page.getByRole('button',{name:'▣ 连续扫码'}).click();await expect(page.getByRole('heading',{name:'大米',exact:true})).toBeVisible({timeout:30000});await page.getByRole('button',{name:'添加',exact:true}).click();await expect(page.locator('.location-section .item-card')).toHaveCount(1);await page.getByRole('button',{name:'关闭相机'}).click();await expect(page.locator('.scanner-camera video')).toHaveCount(0)
})
