import test,{after} from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {createServer} from 'vite'
const server=await createServer({configFile:false,server:{middlewareMode:true},logLevel:'silent'})
after(()=>server.close())
const {frontDispatchProfileIds,readFrontDispatchCache,saveFrontDispatchCache,clearFrontDispatchCache}=await server.ssrLoadModule('/lib/front-dispatch-data.ts')
const {assignSchedulesToDispatchBlocks}=await server.ssrLoadModule('/lib/dispatch-schedule-assignment.ts')
const employees=JSON.parse(readFileSync('output/employee-master.json','utf8'))
const blocks=JSON.parse(readFileSync('output/dispatch-blocks-20260909-simulation.json','utf8')).blocks
const source=JSON.parse(readFileSync('public/september-schedules.json','utf8'))
test('partial profile set produces identical assignments for both shifts across the source month',()=>{
 let reduced=0;
 for(let day=0;day<30;day++){
   const schedules=['morning','night'].flatMap(shift=>source[shift].map(row=>({employeeId:row.employeeId,employeeName:row.name,shiftType:shift,scheduleCode:row.shifts[day]||''})));
   const ids=new Set(frontDispatchProfileIds(schedules)),partial=employees.filter(e=>ids.has(e.employeeId));if(partial.length<employees.length)reduced++;
   for(const shift of ['day','night'])assert.deepEqual(assignSchedulesToDispatchBlocks({blocks,schedules,employees:partial,shift}),assignSchedulesToDispatchBlocks({blocks,schedules,employees,shift}));
 }
 assert.equal(reduced,30);
 assert.deepEqual(frontDispatchProfileIds([{employeeId:'compound',scheduleCode:'休／O1'},{employeeId:'empty',scheduleCode:''},{employeeId:'off',scheduleCode:'休'}]),['compound','empty']);
})
test('front cache is bounded, employee/date scoped, expires at 30 seconds, and clears on logout',()=>{
 clearFrontDispatchCache();const data={blocks:[],schedules:[],profiles:[],isPreview:false};
 saveFrontDispatchCache('A','2026-09-09',data,1000);
 assert.equal(readFrontDispatchCache('A','2026-09-09',30999),data);assert.equal(readFrontDispatchCache('B','2026-09-09',1001),null);assert.equal(readFrontDispatchCache('A','2026-09-10',1001),null);
 assert.equal(readFrontDispatchCache('A','2026-09-09',31000),null);
 for(let i=0;i<4;i++)saveFrontDispatchCache('A',String(i),data,1000);
 assert.equal(readFrontDispatchCache('A','0',1001),null);assert.equal(readFrontDispatchCache('A','3',1001),data);
 clearFrontDispatchCache();assert.equal(readFrontDispatchCache('A','3',1001),null);
})
