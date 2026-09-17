import { describe,it,expect,vi,beforeEach } from 'vitest'
import { mount,flushPromises } from '@vue/test-utils'
import Scanner from '../src/components/Scanner.vue'
const stop=vi.fn(async()=>{}),clear=vi.fn(),start=vi.fn(async()=>{});let onScan:(r:any)=>void
vi.mock('../src/lib/scanner',()=>({cameraError:(e:any)=>String(e),loadScanner:async()=>class{handler:any;scan_area_id='test';constructor(options:any){onScan=options.on_scan}start_scan(){return this.handler.start().catch(()=>{})}}}))
beforeEach(()=>{vi.clearAllMocks();Object.defineProperty(window,'isSecureContext',{value:true,configurable:true});Object.defineProperty(navigator,'mediaDevices',{value:{},configurable:true});(window as any).Html5Qrcode=class{start=start;stop=stop;clear=clear;isScanning=true};delete (window as any).BarcodeDetector})
describe('Framework scanner wrapper',()=>{
 it('works without BarcodeDetector and suppresses repeated frames',async()=>{const w=mount(Scanner);await flushPromises();onScan({decodedText:'123'});onScan({decodedText:'123'});expect(w.emitted('scan')).toEqual([['123']]);await w.setProps({paused:true});onScan({decodedText:'456'});expect(w.emitted('scan')).toHaveLength(1);w.unmount();await flushPromises();expect(stop).toHaveBeenCalledOnce()})
 it('keeps manual entry when the camera cannot start',async()=>{start.mockRejectedValueOnce(new Error('Permission denied'));const w=mount(Scanner);await flushPromises();expect(w.text()).toContain('Permission denied');await w.find('input').setValue('A001');await w.find('form').trigger('submit');expect(w.emitted('scan')).toEqual([['A001']]);w.unmount()})
 it('stops a camera whose startup finishes after closing',async()=>{let resolve!:()=>void;start.mockImplementationOnce(()=>new Promise<void>(r=>resolve=r));const w=mount(Scanner);await flushPromises();w.unmount();resolve();await flushPromises();expect(stop).toHaveBeenCalledOnce()})
})
