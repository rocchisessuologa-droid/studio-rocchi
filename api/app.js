import {randomUUID,timingSafeEqual} from 'node:crypto';
const fail=(m,s=400)=>{throw Object.assign(new Error(m),{status:s})};
const uuid=x=>/^[0-9a-f-]{36}$/i.test(x||'');
export function validate(r){
 if(!uuid(r.id)||!['patients','appointments','reminders','documents'].includes(r.kind)||!r.data||typeof r.data!=='object')fail('Dati non validi');
 const d=r.data;
 if(JSON.stringify(d).length>50000)fail('Scheda troppo grande');
 if(r.kind==='patients'&&(!d.firstName?.trim()||!d.lastName?.trim()))fail('Nome e cognome obbligatori');
 if(r.kind==='appointments'){
  if(!Number.isFinite(Date.parse(d.start))||!Number.isFinite(Date.parse(d.end))||new Date(d.end)<=new Date(d.start))fail('Intervallo non valido');
  if(!d.personal&&!uuid(d.patientId))fail('Seleziona il paziente');
  if(d.personal&&!d.title?.trim())fail('Descrivi il tuo impegno');
  if(!Number.isFinite(Number(d.fee))||Number(d.fee)<0)fail('Importo non valido');
  if(!['due','paid'].includes(d.payment))fail('Stato pagamento non valido');
  if(d.payment==='paid'&&(!d.paidDate||!d.method))fail('Data e metodo di pagamento obbligatori');
  if(d.method==='Altro'&&!d.paymentNote?.trim())fail('Specifica la modalità di pagamento');
 }
 if(r.kind==='reminders'&&!d.title?.trim())fail('Titolo obbligatorio');
}
async function sb(path,options={}){
 const r=await fetch(process.env.SUPABASE_URL+path,{...options,headers:{apikey:process.env.SUPABASE_SERVICE_ROLE_KEY,Authorization:'Bearer '+process.env.SUPABASE_SERVICE_ROLE_KEY,'Content-Type':'application/json',...options.headers}});
 const t=await r.text();let data;try{data=JSON.parse(t)}catch{data=t}
 if(!r.ok)fail(data.message||data.msg||data.error_description||'Operazione non riuscita',r.status===401?401:400);return data;
}
const json=b=>JSON.stringify(b);
const same=(a,b)=>a&&b&&a.length===b.length&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
export default async function handler(req,res){
 res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
 const url=new URL(req.url,'http://local');const action=url.searchParams.get('action')||'state';
 try{
  const configured=!!(process.env.SUPABASE_URL&&process.env.SUPABASE_SERVICE_ROLE_KEY);
  if(action==='config')return res.json({configured});
  if(!configured)fail('Archivio online da configurare. Consulta ATTIVAZIONE.md.',503);
  if(req.method!=='GET'&&req.headers.origin&&req.headers.origin!==`https://${req.headers.host}`&&req.headers.origin!==`http://${req.headers.host}`)fail('Origine non autorizzata',403);
  const b=typeof req.body==='string'?JSON.parse(req.body):req.body||{};
  if(action==='login'){
   if(req.method!=='POST')fail('Metodo non valido',405);
   const s=await sb('/auth/v1/token?grant_type=password',{method:'POST',body:json({email:b.email,password:b.password})});
   const staff=await sb('/rest/v1/staff?id=eq.'+s.user.id+'&active=eq.true');if(!staff.length)fail('Accesso non abilitato',403);
   res.setHeader('Set-Cookie',`studio_session=${s.access_token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=3600${process.env.VERCEL?'; Secure':''}`);return res.json({ok:true});
  }
  if(action==='calendar-hook'){
   if(req.method!=='POST'||!process.env.CALENDAR_WEBHOOK_SECRET||!same(req.headers.authorization,'Bearer '+process.env.CALENDAR_WEBHOOK_SECRET))fail('Non autorizzato',401);
   if(!b.externalId||String(b.externalId).length>200)fail('externalId obbligatorio');
   const prior=await sb('/rest/v1/records?kind=eq.appointments&data->>externalId=eq.'+encodeURIComponent(b.externalId));
   const old=prior[0];if(old&&!old.data.external)fail('Evento non importabile');
   const r={id:old?.id||randomUUID(),version:old?.version||0,kind:'appointments',data:{personal:true,external:true,externalId:String(b.externalId),title:String(b.title||'Impegno calendario'),start:b.start,end:b.end,cancelled:b.cancelled===true,fee:0,payment:'due'}};validate(r);
   await sb('/rest/v1/rpc/save_records',{method:'POST',body:json({items:[r]})});return res.json({ok:true,id:r.id});
  }
  const token=(req.headers.cookie||'').split('; ').find(x=>x.startsWith('studio_session='))?.slice(15);if(!token)fail('Accedi con email e password',401);
  const user=await sb('/auth/v1/user',{headers:{Authorization:'Bearer '+token}});
  const staff=(await sb('/rest/v1/staff?id=eq.'+user.id+'&active=eq.true'))[0];if(!staff)fail('Accesso disabilitato',403);
  const admin=()=>{if(staff.role!=='admin')fail('Solo gli amministratori possono gestire gli accessi',403)};
  if(action==='logout'){if(req.method!=='POST')fail('Metodo non valido',405);await sb('/auth/v1/logout',{method:'POST',headers:{Authorization:'Bearer '+token}});res.setHeader('Set-Cookie','studio_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');return res.json({ok:true})}
  if(action==='state'){
   const all=[];for(let offset=0;;offset+=1000){const rows=await sb(`/rest/v1/records?select=*&order=id&offset=${offset}&limit=1000`);all.push(...rows);if(rows.length<1000)break;}
   return res.json({user:staff,records:all});
  }
  if(req.method!=='POST'&&action!=='users')fail('Metodo non valido',405);
  if(action==='save'){
   if(!Array.isArray(b.items)||b.items.length>500)fail('Massimo 500 elementi');b.items.forEach(validate);
   for(const r of b.items){if(r.kind==='documents')fail('Usa il caricamento allegati');if(r.kind==='appointments'&&!r.data.personal){const p=await sb('/rest/v1/records?id=eq.'+r.data.patientId+'&kind=eq.patients');if(!p.length)fail('Paziente non trovato')}}
   await sb('/rest/v1/rpc/save_records',{method:'POST',body:json({items:b.items})});return res.json({ok:true});
  }
  if(action==='delete-reminders'){
   if(!Array.isArray(b.ids)||b.ids.length>500||b.ids.some(x=>!uuid(x)))fail('Selezione non valida');
   for(const id of b.ids)await sb('/rest/v1/records?id=eq.'+id+'&kind=eq.reminders&data->>done=eq.true',{method:'DELETE'});return res.json({ok:true});
  }
  if(action==='users'){admin();return res.json(await sb('/rest/v1/staff?order=email'))}
  if(action==='user-save'){
   admin();if(!['admin','operator'].includes(b.role))fail('Ruolo non valido');if(b.password&&b.password.length<12)fail('Password: almeno 12 caratteri');
   if(b.id){if(!uuid(b.id)||b.id===user.id)fail('Non puoi modificare il tuo accesso');await sb('/rest/v1/staff?id=eq.'+b.id,{method:'PATCH',body:json({role:b.role,active:b.active===true})});if(b.password){if(b.password.length<12)fail('Password: almeno 12 caratteri');await sb('/auth/v1/admin/users/'+b.id,{method:'PUT',body:json({password:b.password})})}}
   else{if(!b.email||!b.password||b.password.length<12)fail('Email e password di almeno 12 caratteri richieste');const u=await sb('/auth/v1/admin/users',{method:'POST',body:json({email:b.email,password:b.password,email_confirm:true})});try{await sb('/rest/v1/staff',{method:'POST',body:json({id:u.id,email:b.email,role:b.role})})}catch(e){await sb('/auth/v1/admin/users/'+u.id,{method:'DELETE'});throw e}}
   return res.json({ok:true});
  }
  if(action==='upload'){
   if(!uuid(b.patientId)||!b.name||!b.base64)fail('Allegato non valido');
   const p=await sb('/rest/v1/records?id=eq.'+b.patientId+'&kind=eq.patients');if(!p.length)fail('Paziente non trovato');
   if(!/\.(pdf|docx?|xlsx?|png|jpe?g|gif|webp|txt|odt)$/i.test(b.name))fail('Formato non supportato');
   const bytes=Buffer.from(b.base64,'base64');if(bytes.length>3*1024*1024)fail('Dimensione massima: 3 MB');
   const id=randomUUID(),path=b.patientId+'/'+id;await sb('/storage/v1/object/patient-files/'+path,{method:'POST',headers:{'Content-Type':'application/octet-stream'},body:bytes});
   try{await sb('/rest/v1/records',{method:'POST',body:json({id,kind:'documents',data:{patientId:b.patientId,name:b.name,path,uploadedAt:new Date().toISOString()}})})}catch(e){await sb('/storage/v1/object/patient-files',{method:'DELETE',body:json({prefixes:[path]})});throw e}return res.json({ok:true});
  }
  if(action==='download'){
   if(!uuid(b.id))fail('Allegato non valido');const r=(await sb('/rest/v1/records?id=eq.'+b.id+'&kind=eq.documents'))[0];if(!r)fail('Non trovato',404);
   const signed=await sb('/storage/v1/object/sign/patient-files/'+r.data.path,{method:'POST',body:json({expiresIn:60})});return res.json({url:process.env.SUPABASE_URL+'/storage/v1'+signed.signedURL});
  }
  fail('Operazione non trovata',404);
 }catch(e){res.status(e.status||500).json({error:e.status?e.message:'Servizio non disponibile. Riprova.'})}
}
