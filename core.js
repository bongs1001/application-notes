export const STATUSES=['관심','지원 준비','지원 완료','서류 통과','면접','최종 합격','불합격','보류','지원 철회'];
export const FIELDS=['company','role','status','source','applied_on','deadline','next_at','next_label','url','receipt_number','notes','body','years'];
export function safeURL(value){try{const u=new URL(value);return ['http:','https:'].includes(u.protocol)?u.href:''}catch{return ''}}
export function localDate(d=new Date()){return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-')}
export function matches(j,search,status,source){return (!search||`${j.company} ${j.role}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()))&&(!status||j.status===status)&&(!source||j.source===source)}
export function validateJob(j){
 for(const key of ['company','role'])if(typeof j[key]!=='string'||!j[key].trim()||j[key].length>200)throw Error('회사와 직무를 200자 이내로 입력하세요.');
 if(!STATUSES.includes(j.status))throw Error('지원하지 않는 진행 상태입니다.');
 if(j.url&&!safeURL(j.url))throw Error('공고 URL은 http 또는 https 주소여야 합니다.');
 for(const [key,max] of Object.entries({source:100,next_label:200,url:2000,receipt_number:200,notes:20000,body:100000,years:20}))if(typeof j[key]!=='string'||j[key].length>max)throw Error(`${key} 형식 또는 길이를 확인하세요.`);
 for(const key of ['applied_on','deadline'])if(j[key]&&(!/^\d{4}-\d{2}-\d{2}$/.test(j[key])||Number.isNaN(Date.parse(j[key]))||new Date(j[key]).toISOString().slice(0,10)!==j[key]))throw Error('날짜 형식을 확인하세요.');
 if(j.next_at&&Number.isNaN(Date.parse(j.next_at)))throw Error('일정 시간을 확인하세요.');
 return j;
}
export async function normalizeBackup(data){
 if(!data||![1,2].includes(data.version)||!Array.isArray(data.jobs)||data.jobs.length>5000)throw Error('지원하지 않는 백업 형식입니다.');
 if(data.version===2&&data.format!=='application-notes')throw Error('지원하지 않는 백업 형식입니다.');
 if(typeof data.profile!=='string'||data.profile.length>100000)throw Error('경력 근거 형식을 확인하세요.');
 const ids=new Set(), jobs=[];
 for(const old of data.jobs){
   if(!old||typeof old.id!=='string'||!old.id||ids.has(old.id))throw Error('중복되거나 잘못된 공고 ID입니다.');ids.add(old.id);
   if(data.version===1&&['company','role','url','deadline','years','status','body','analysis'].some(k=>typeof old[k]!=='string'))throw Error('기존 보관함의 필수 항목이 없습니다.');
   let id=old.id;
   if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)){
     const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode('job-vault-v1:'+id));
     const h=Array.from(new Uint8Array(digest)).map(x=>x.toString(16).padStart(2,'0')).join('');id=`${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`;
   }
   const j={id};for(const key of FIELDS)j[key]=old[key]??(['applied_on','deadline','next_at'].includes(key)?null:'');
   if(data.version===1){j.status=({'검토 전':'관심','분석 완료':'지원 준비'})[old.status]||old.status;j.notes=old.analysis+(old.status==='검토 전'||old.status==='분석 완료'?`\n[이전 상태: ${old.status}]`:'');j.source='기존 보관함';}
   j.deadline=j.deadline||null;j.applied_on=j.applied_on||null;j.next_at=j.next_at||null;
   jobs.push(validateJob(j));
 }
 const events=data.version===2?(data.mail_events??[]):[];
 if(!Array.isArray(events)||events.length>10000)throw Error('메일 확인 기록 형식을 확인하세요.');
 for(const e of events)if(!e||typeof e.id!=='string'||! /^[a-f0-9]{64}$/.test(e.message_key)||!['receipt','update','unknown','ignored'].includes(e.kind)||!['pending','resolved','ignored','automatic'].includes(e.review_state))throw Error('메일 확인 기록 형식을 확인하세요.');
 return {jobs,profile:data.profile,events};
}
