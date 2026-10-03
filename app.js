import {STATUSES,FIELDS,safeURL,matches,normalizeBackup,validateJob,localDate} from './core.js';
const $=id=>document.getElementById(id), form=$('editForm');
let db=null, user=null, jobs=[], events=[], sync=null, profile='', editing=null, reviewing=null, demo=false, authEpoch=0;
const el=(tag,text,parent,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;if(parent)parent.append(n);return n;};
function notice(s){$('notice').textContent=s}
function errorText(e){const s=String(e?.message||e);if(/EDIT_CONFLICT|REVIEW_CONFLICT/.test(s))return '다른 화면에서 이 기록이 변경되었습니다. 입력 내용을 복사해 둔 뒤, 창을 닫고 새로고침하여 다시 수정하세요.';if(/OWNER_ONLY|permission|policy/i.test(s))return '등록된 본인 계정만 접근할 수 있습니다.';return '처리하지 못했습니다. 연결 상태와 Supabase 프로젝트 실행 상태를 확인한 뒤 다시 시도하세요. 입력 내용은 유지됩니다.'}
function date(s,time=false){if(!s)return '—';if(!time)return s.slice(0,10).replaceAll('-','.');const d=new Date(s);return Number.isNaN(d.valueOf())?'—':new Intl.DateTimeFormat('ko-KR',{dateStyle:'short',timeStyle:'short',timeZone:'Asia/Seoul'}).format(d)}
function option(select,value,label=value){const n=el('option',label,select);n.value=value;}
STATUSES.forEach(s=>{option($('filterStatus'),s);option($('editStatus'),s)});
function enabled(value){for(const id of ['add','refresh','export','import'])$(id).disabled=!value;}
async function all(table,query=q=>q){let rows=[];for(let start=0;;start+=1000){const {data,error}=await query(db.from(table).select('*')).order('id').range(start,start+999);if(error)throw error;rows.push(...data);if(data.length<1000)return rows;}}
async function refresh(){
 if(demo)return render();if(!user)return;
 const epoch=authEpoch;
 $('refresh').disabled=true;
 try{
  const [j,e,s,p]=await Promise.all([all('jobs'),all('mail_events'),db.from('sync_state').select('*').maybeSingle(),db.from('profiles').select('*').maybeSingle()]);
  if(epoch!==authEpoch)return;if(s.error)throw s.error;if(p.error)throw p.error;jobs=j;events=e;sync=s.data;profile=p.data?.evidence||'';render();
 }catch(e){notice(errorText(e));$('syncBadge').textContent='연결 확인';$('syncDetail').textContent='Supabase가 일시 중지되었다면 프로젝트에서 Resume을 누르세요.';}finally{$('refresh').disabled=false;}
}
function render(){
 if(demo)$('setup').hidden=true;
 const pending=events.filter(e=>e.review_state==='pending');
 $('metricApplied').textContent=jobs.filter(j=>j.status==='지원 완료').length;
 $('metricProgress').textContent=jobs.filter(j=>['서류 통과','면접'].includes(j.status)).length;
 $('metricInterview').textContent=jobs.filter(j=>j.status==='면접'&&j.next_at&&new Date(j.next_at)>=new Date()).length;
 $('metricReview').textContent=pending.length;$('reviewCount').textContent=pending.length;
 const previous=$('filterSource').value;$('filterSource').replaceChildren();option($('filterSource'),'','모든 경로');[...new Set(jobs.map(j=>j.source).filter(Boolean))].sort().forEach(s=>option($('filterSource'),s));$('filterSource').value=previous;
 const visible=jobs.filter(j=>matches(j,$('search').value.trim(),$('filterStatus').value,$('filterSource').value)).sort((a,b)=>(b.applied_on||'').localeCompare(a.applied_on||'')||b.created_at.localeCompare(a.created_at));
 $('count').textContent=visible.length;$('rows').replaceChildren();$('empty').hidden=visible.length>0;
 for(const j of visible){const tr=el('tr',undefined,$('rows')),company=el('td',undefined,tr);el('strong',j.company,company);el('small',j.role,company);
  const td=el('td',undefined,tr);el('span',j.status,td,'status '+(j.status==='지원 완료'?'applied':['서류 통과','면접'].includes(j.status)?'progress':j.status==='불합격'?'rejected':''));
  el('td',j.source||'—',tr);const days=el('td',date(j.applied_on),tr);el('small','마감 '+date(j.deadline),days);const next=el('td',date(j.next_at,true),tr);el('small',j.next_label||'',next);
  const actions=el('td',undefined,tr);const b=el('button','수정',actions);b.disabled=demo;b.onclick=()=>openEditor(j);if(safeURL(j.url)){const a=el('a',' ↗',actions);a.href=safeURL(j.url);a.target='_blank';a.rel='noopener noreferrer';a.setAttribute('aria-label',j.company+' 공고 원문 열기');}
 }
 $('reviews').replaceChildren();if(!pending.length)el('p','확인할 업데이트가 없습니다.',$('reviews'),'muted compact');
 for(const event of pending.sort((a,b)=>b.created_at.localeCompare(a.created_at))){const box=el('article',undefined,$('reviews'),'review');el('strong',event.subject||'제목 없는 메일',box);el('p',event.evidence||'본문을 자동으로 읽지 못했습니다. 네이버 메일에서 확인하세요.',box);el('small',date(event.received_at,true),box);const b=el('button','확인 · 반영',box);b.disabled=demo;b.onclick=()=>review(event);const skip=el('button','제외',box);skip.disabled=demo;skip.onclick=async()=>{if(!confirm('이 업데이트를 확인 목록에서 제외할까요?'))return;try{const r=await db.from('mail_events').update({review_state:'ignored'}).eq('id',event.id).eq('review_state','pending').select('id');if(r.error)throw r.error;if(!r.data.length)throw Error('REVIEW_CONFLICT');await refresh()}catch(e){notice(errorText(e))}};}
 $('lastSync').textContent=sync?.last_success?date(sync.last_success,true):'아직 수집 기록이 없습니다';
 const stale=sync?.last_success&&Date.now()-Date.parse(sync.last_success)>3*3600000;
 $('syncBadge').textContent=demo?'예시':sync?.error_code?'연결 확인':stale?'수집 지연':sync?.last_success?'연동 중':'설정 대기';
 const errors={MAIL_AUTH:'네이버 IMAP 활성화와 앱 비밀번호를 확인하세요.',MAIL_FOLDER:'설정한 전용 메일함이 없습니다.',MAIL_NETWORK:'메일 서버 연결에 실패했습니다. 다음 실행에서 재시도합니다.',DATABASE:'저장소 연결을 확인하세요.',CONFIG:'수집 환경 설정을 확인하세요.',UNEXPECTED:'수집기 실행 기록을 확인하세요.'};
 $('syncDetail').textContent=demo?'예시 데이터 · 실제 메일 연동 전':sync?.error_code?(errors[sync.error_code]||'연결 설정을 확인하세요.'):stale?'3시간 이상 새 수집 기록이 없습니다. GitHub Actions 실행 상태를 확인하세요.':sync?.last_success?`${sync.mailbox} 메일함 · 최근 처리 ${sync.processed}건`:'연결 설정 후 첫 수집을 실행하세요.';
}
function fill(j={}){for(const field of FIELDS){let value=j[field]??'';if(field==='next_at'&&value){const d=new Date(value);value=new Date(d.valueOf()-d.getTimezoneOffset()*60000).toISOString().slice(0,16)}form.elements.namedItem(field).value=value;}form.elements.status.value=j.status||'관심';}
function openEditor(j=null){editing=j;reviewing=null;$('editorError').textContent='';$('editorTitle').textContent=j?'지원 기록 수정':'지원 기록 추가';$('linkLabel').hidden=true;$('deleteJob').hidden=!j;fill(j||{});$('editor').showModal();}
function review(event){openEditor();reviewing=event;$('editorTitle').textContent='메일 확인 · 기록 반영';$('linkLabel').hidden=false;$('linkJob').replaceChildren();option($('linkJob'),'','새 지원 기록으로 등록');jobs.forEach(j=>option($('linkJob'),j.id,`${j.company} · ${j.role} (${j.status})`));fill({...event.proposed,status:event.kind==='receipt'?'지원 완료':'관심',notes:event.evidence});}
function readForm(){const result={};for(const field of FIELDS){let v=form.elements.namedItem(field).value.trim();if(['applied_on','deadline','next_at'].includes(field))v=v||null;if(field==='next_at'&&v)v=new Date(v).toISOString();result[field]=v}return validateJob(result)}
$('linkJob').onchange=()=>{editing=jobs.find(j=>j.id===$('linkJob').value)||null;fill(editing||{...reviewing.proposed,status:reviewing.kind==='receipt'?'지원 완료':'관심',notes:reviewing.evidence});};
$('add').onclick=()=>openEditor();$('closeEditor').onclick=()=>$('editor').close();
form.onsubmit=async e=>{e.preventDefault();$('save').disabled=true;$('editorError').textContent='';try{const data=readForm();if(editing)data.id=editing.id;const r=await db.rpc('save_job',{p_job:data,p_expected:editing?.version??null,p_event:reviewing?.id??null});if(r.error)throw r.error;$('editor').close();notice('저장했습니다. 다른 PC에서도 새로고침하면 확인할 수 있습니다.');await refresh()}catch(e){$('editorError').textContent=e.message?.startsWith('회사')||e.message?.includes('형식')?e.message:errorText(e)}finally{$('save').disabled=false;}};
$('deleteJob').onclick=async()=>{if(!editing||!confirm('이 지원 기록을 삭제할까요?'))return;try{const r=await db.rpc('delete_job',{p_id:editing.id,p_expected:editing.version});if(r.error)throw r.error;$('editor').close();await refresh()}catch(e){$('editorError').textContent=errorText(e)}};
['search','filterStatus','filterSource'].forEach(id=>$(id).oninput=render);$('refresh').onclick=()=>{notice('');refresh()};
$('export').onclick=()=>{const backup={format:'application-notes',version:2,exported_at:new Date().toISOString(),profile,jobs,mail_events:events};const url=URL.createObjectURL(new Blob([JSON.stringify(backup,null,2)],{type:'application/json'}));const a=el('a');a.href=url;a.download=`지원노트_${localDate()}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
$('import').onclick=()=>$('importFile').click();$('importFile').onchange=async()=>{const file=$('importFile').files[0];if(!file)return;$('import').disabled=true;try{if(file.size>10*1024*1024)throw Error('백업은 10MB 이하여야 합니다.');const data=await normalizeBackup(JSON.parse(await file.text()));if(!confirm(`${data.jobs.length}개 지원과 ${data.events.length}개 메일 기록을 가져옵니다. 같은 ID는 건너뛰고 기존 기록은 유지합니다. 경력 근거는 백업 내용으로 바뀝니다. 계속할까요?`))return;const r=await db.rpc('import_jobs',{p_jobs:data.jobs,p_profile:data.profile,p_events:data.events});if(r.error)throw r.error;notice(`${r.data}개 지원과 중복되지 않는 메일 기록을 가져왔습니다.`);await refresh()}catch(e){notice('가져오기 실패: '+(e.code?errorText(e):e.message))}finally{$('importFile').value='';$('import').disabled=false;}};
$('demo').onclick=()=>{demo=true;const today=localDate(),future=new Date(Date.now()+2*86400000).toISOString();jobs=[{company:'예시 · 그린데이터',role:'AI 솔루션 엔지니어',status:'면접',source:'원티드',applied_on:today,next_at:future,next_label:'1차 인터뷰'},{company:'예시 · 노스랩',role:'AX 컨설턴트',status:'지원 완료',source:'기업 홈페이지',applied_on:today},{company:'예시 · 모먼트',role:'Data Engineer',status:'서류 통과',source:'사람인',applied_on:today},{company:'예시 · 스튜디오원',role:'AI Product Engineer',status:'지원 준비',source:'직접 지원',deadline:today}].map((j,i)=>({id:String(i),created_at:new Date().toISOString(),...j}));events=[{id:'demo',subject:'[예시] 지원 접수 확인',evidence:'직무 정보가 없어 확인이 필요합니다.',received_at:new Date().toISOString(),created_at:new Date().toISOString(),review_state:'pending'}];notice('예시 화면입니다. 실제 지원 기록이 아니며 저장·메일 수집은 실행되지 않습니다.');render()};
async function authenticate(session){const epoch=++authEpoch;user=session?.user??null;demo=false;enabled(false);if(!user){jobs=[];events=[];sync=null;profile='';$('editor').close();$('login').hidden=false;$('logout').hidden=true;render();return}const {data,error}=await db.rpc('is_dashboard_owner');if(epoch!==authEpoch)return;if(error||data!==true){user=null;await db.auth.signOut();notice('등록된 본인 GitHub 계정으로 로그인하세요.');return}$('login').hidden=true;$('logout').hidden=false;enabled(true);notice('');await refresh();}
async function boot(){
 const config=window.DASHBOARD_CONFIG||{};
 if(!config.supabaseUrl||!config.supabaseAnonKey){$('setup').hidden=false;$('login').disabled=true;return;}
 try{
  if(!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(config.supabaseUrl))throw Error('Invalid configuration');
  if(config.supabaseAnonKey.startsWith('sb_secret_'))throw Error('Private key forbidden');
  if(config.supabaseAnonKey.startsWith('eyJ')){const payload=JSON.parse(atob(config.supabaseAnonKey.split('.')[1].replaceAll('-','+').replaceAll('_','/')));if(payload.role!=='anon')throw Error('Private key forbidden');}
  const {createClient}=await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.57.4/+esm');
  db=createClient(config.supabaseUrl,config.supabaseAnonKey);
  $('login').onclick=async()=>{const r=await db.auth.signInWithOAuth({provider:'github',options:{redirectTo:location.origin+location.pathname}});if(r.error)notice(errorText(r.error))};
  $('logout').onclick=async()=>{const r=await db.auth.signOut();if(r.error)notice(errorText(r.error))};
  db.auth.onAuthStateChange((event,session)=>{if(['SIGNED_IN','SIGNED_OUT','INITIAL_SESSION'].includes(event))setTimeout(()=>authenticate(session).catch(e=>notice(errorText(e))),0)});
 }catch{notice('공개 연결 설정 또는 클라이언트 로딩을 확인하세요. 비밀 키는 화면 설정에 사용할 수 없습니다.');$('login').disabled=true;}
}
await boot();
