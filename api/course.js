import {randomUUID,createHash} from 'node:crypto';

const fail=(m,s=400)=>{throw Object.assign(new Error(m),{status:s})};
const uuid=x=>/^[0-9a-f-]{36}$/i.test(x||'');
const COURSE_IDS=new Set(['disturbi-personalita','educazione-sessuo-affettiva','neurodivergenze']);
const SAVE_KINDS=new Set(['course-enrollments','course-installments','course-attendance','course-settings']);
const json=x=>JSON.stringify(x);

async function sb(path,options={}){
  const r=await fetch(process.env.SUPABASE_URL+path,{
    ...options,
    headers:{
      apikey:process.env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization:'Bearer '+process.env.SUPABASE_SERVICE_ROLE_KEY,
      'Content-Type':'application/json',
      ...options.headers
    }
  });
  const t=await r.text();let data;try{data=JSON.parse(t)}catch{data=t}
  if(!r.ok)fail(data?.message||data?.msg||data?.error_description||'Operazione non riuscita',r.status===401?401:400);
  return data;
}

function validateRecord(r){
  if(!r||!uuid(r.id)||!SAVE_KINDS.has(r.kind)||!r.data||typeof r.data!=='object')fail('Dati corso non validi');
  if(JSON.stringify(r.data).length>50000)fail('Scheda corso troppo grande');
  const d=r.data;
  if(r.kind==='course-enrollments'){
    if(!COURSE_IDS.has(d.courseId))fail('Corso non valido');
    if(!String(d.firstName||'').trim()||!String(d.lastName||'').trim())fail('Nome e cognome obbligatori');
    if(d.amount!==undefined&&(!Number.isFinite(Number(d.amount))||Number(d.amount)<0))fail('Importo non valido');
  }
  if(r.kind==='course-installments'){
    if(!uuid(d.enrollmentId))fail('Iscritto non valido');
    if(!Number.isFinite(Number(d.amount))||Number(d.amount)<0)fail('Importo rata non valido');
    if(!['due','paid'].includes(d.status))fail('Stato rata non valido');
  }
  if(r.kind==='course-attendance'){
    if(!uuid(d.enrollmentId))fail('Iscritto non valido');
    if(!/^\d{4}-\d{2}-\d{2}$/.test(d.date||''))fail('Data presenza non valida');
  }
  if(r.kind==='course-settings'&&!COURSE_IDS.has(d.courseId))fail('Corso non valido');
}

async function authenticated(req){
  const token=(req.headers.cookie||'').split('; ').find(x=>x.startsWith('studio_session='))?.slice(15);
  if(!token)fail('Accedi con email e password',401);
  const user=await sb('/auth/v1/user',{headers:{Authorization:'Bearer '+token}});
  const staff=(await sb('/rest/v1/staff?id=eq.'+user.id+'&active=eq.true'))[0];
  if(!staff)fail('Accesso disabilitato',403);
  return {user,staff};
}

const supportedName=n=>/\.(pdf|docx?|xlsx?|png|jpe?g|gif|webp|txt|odt)$/i.test(n||'');
const imageName=n=>/\.(png|jpe?g|webp)$/i.test(n||'');

export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Referrer-Policy','no-referrer');
  try{
    if(!(process.env.SUPABASE_URL&&process.env.SUPABASE_SERVICE_ROLE_KEY))fail('Archivio online non configurato',503);
    if(req.method!=='GET'&&req.headers.origin&&req.headers.origin!==`https://${req.headers.host}`&&req.headers.origin!==`http://${req.headers.host}`)fail('Origine non autorizzata',403);
    await authenticated(req);
    const url=new URL(req.url,'http://local');
    const action=url.searchParams.get('action')||'';
    const b=typeof req.body==='string'?JSON.parse(req.body):req.body||{};

    if(action==='cover'){
      if(req.method!=='GET')fail('Metodo non valido',405);
      const courseId=url.searchParams.get('courseId');
      if(!COURSE_IDS.has(courseId))fail('Corso non valido');
      const rows=await sb('/rest/v1/records?kind=eq.course-settings&data->>courseId=eq.'+encodeURIComponent(courseId)+'&limit=1');
      const path=rows[0]?.data?.coverPath;if(!path)fail('Copertina non trovata',404);
      const signed=await sb('/storage/v1/object/sign/patient-files/'+path,{method:'POST',body:json({expiresIn:300})});
      res.statusCode=302;res.setHeader('Location',process.env.SUPABASE_URL+'/storage/v1'+signed.signedURL);return res.end();
    }

    if(req.method!=='POST')fail('Metodo non valido',405);

    if(action==='save'){
      if(!Array.isArray(b.items)||b.items.length>500)fail('Massimo 500 elementi');
      b.items.forEach(validateRecord);
      for(const r of b.items){
        if(r.kind==='course-installments'||r.kind==='course-attendance'){
          const e=await sb('/rest/v1/records?id=eq.'+r.data.enrollmentId+'&kind=eq.course-enrollments&limit=1');
          if(!e.length)fail('Iscritto non trovato');
        }
      }
      await sb('/rest/v1/rpc/save_records',{method:'POST',body:json({items:b.items})});
      return res.json({ok:true});
    }

    if(action==='upload-cover'){
      if(!COURSE_IDS.has(b.courseId)||!b.name||!b.base64)fail('Copertina non valida');
      if(!imageName(b.name)||!['image/jpeg','image/png','image/webp',''].includes(String(b.mime||'')))fail('Formato copertina non supportato');
      const bytes=Buffer.from(b.base64,'base64');if(!bytes.length||bytes.length>3*1024*1024)fail('Dimensione massima copertina: 3 MB');
      const id=randomUUID(),ext=(String(b.name).match(/\.(png|jpe?g|webp)$/i)?.[1]||'jpg').toLowerCase(),path=`courses/covers/${b.courseId}/${id}.${ext}`;
      await sb('/storage/v1/object/patient-files/'+path,{method:'POST',headers:{'Content-Type':b.mime||'application/octet-stream'},body:bytes});
      const old=(await sb('/rest/v1/records?kind=eq.course-settings&data->>courseId=eq.'+encodeURIComponent(b.courseId)+'&limit=1'))[0];
      const rec={id:old?.id||randomUUID(),kind:'course-settings',version:old?.version||0,data:{...(old?.data||{}),courseId:b.courseId,coverPath:path,coverName:String(b.name).slice(0,180),coverMime:String(b.mime||''),coverUpdatedAt:new Date().toISOString()}};
      try{await sb('/rest/v1/rpc/save_records',{method:'POST',body:json({items:[rec]})})}catch(e){await sb('/storage/v1/object/patient-files',{method:'DELETE',body:json({prefixes:[path]})});throw e}
      if(old?.data?.coverPath&&old.data.coverPath!==path){try{await sb('/storage/v1/object/patient-files',{method:'DELETE',body:json({prefixes:[old.data.coverPath]})})}catch{}}
      return res.json({ok:true});
    }

    if(action==='upload-document'){
      if(!uuid(b.enrollmentId)||!b.name||!b.base64)fail('Documento non valido');
      const enr=(await sb('/rest/v1/records?id=eq.'+b.enrollmentId+'&kind=eq.course-enrollments&limit=1'))[0];if(!enr)fail('Iscritto non trovato',404);
      if(!supportedName(b.name))fail('Formato non supportato');
      const bytes=Buffer.from(b.base64,'base64');if(!bytes.length||bytes.length>3*1024*1024)fail('Dimensione massima: 3 MB');
      const id=randomUUID(),path=`courses/enrollments/${b.enrollmentId}/${id}`;
      await sb('/storage/v1/object/patient-files/'+path,{method:'POST',headers:{'Content-Type':b.mime||'application/octet-stream'},body:bytes});
      const data={enrollmentId:b.enrollmentId,name:String(b.name).slice(0,180),path,mime:String(b.mime||'application/octet-stream').slice(0,100),size:bytes.length,note:String(b.note||'').slice(0,500),addedAt:new Date().toISOString(),sha256:createHash('sha256').update(bytes).digest('hex')};
      try{await sb('/rest/v1/records',{method:'POST',body:json({id,kind:'course-documents',data})})}catch(e){await sb('/storage/v1/object/patient-files',{method:'DELETE',body:json({prefixes:[path]})});throw e}
      return res.json({ok:true,id});
    }

    if(action==='download-document'){
      if(!uuid(b.id))fail('Documento non valido');
      const r=(await sb('/rest/v1/records?id=eq.'+b.id+'&kind=eq.course-documents&limit=1'))[0];if(!r?.data?.path)fail('Documento non trovato',404);
      const signed=await sb('/storage/v1/object/sign/patient-files/'+r.data.path,{method:'POST',body:json({expiresIn:60})});
      return res.json({url:process.env.SUPABASE_URL+'/storage/v1'+signed.signedURL});
    }

    fail('Operazione Corsi non trovata',404);
  }catch(e){res.status(e.status||500).json({error:e.status?e.message:'Servizio Corsi non disponibile. Riprova.'})}
}
