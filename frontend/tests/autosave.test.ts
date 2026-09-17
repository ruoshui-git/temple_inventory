import { describe,it,expect,vi,afterEach } from 'vitest'
import { SaveQueue } from '../src/lib/autosave'
afterEach(()=>vi.useRealTimers())
describe('autosave',()=>{
 it('debounces text and saves structural edits immediately',async()=>{vi.useFakeTimers();const save=vi.fn(async()=>{});const q=new SaveQueue(save,vi.fn());q.schedule();await vi.advanceTimersByTimeAsync(2000);q.schedule();await vi.advanceTimersByTimeAsync(2999);expect(save).not.toHaveBeenCalled();await vi.advanceTimersByTimeAsync(1);expect(save).toHaveBeenCalledTimes(1);q.schedule(true);await q.flush();expect(save).toHaveBeenCalledTimes(2);q.dispose()})
 it('serializes requests and retains edits made while saving',async()=>{let resolve!:()=>void;let active=0,max=0;const save=vi.fn(async()=>{active++;max=Math.max(max,active);if(save.mock.calls.length===1)await new Promise<void>(r=>resolve=r);active--});const q=new SaveQueue(save,vi.fn());q.schedule(true);q.schedule(true);resolve();await q.flush();expect(save).toHaveBeenCalledTimes(2);expect(max).toBe(1);q.dispose()})
 it('does not retry endlessly on failure and can recover',async()=>{const error=vi.fn(),save=vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined);const q=new SaveQueue(save,error);q.schedule(true);await q.flush();expect(error).toHaveBeenCalledTimes(1);expect(save).toHaveBeenCalledTimes(1);q.schedule(true);await q.flush();expect(save).toHaveBeenCalledTimes(2);q.dispose()})
 it('pauses during expired sessions',async()=>{let paused=true;const save=vi.fn(async()=>{});const q=new SaveQueue(save,vi.fn(),()=>paused);q.schedule(true);await q.flush();expect(save).not.toHaveBeenCalled();paused=false;await q.flush();expect(save).toHaveBeenCalledTimes(1);q.dispose()})
})
