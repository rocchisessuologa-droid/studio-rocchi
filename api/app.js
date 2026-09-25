import {randomUUID,timingSafeEqual,createHash,randomBytes} from 'node:crypto';
const fail=(m,s=400)=>{throw Object.assign(new Error(m),{status:s})};
const uuid=x=>/^[0-9a-f-]{36}$/i.test(x||'');
const CONSENT_VERSION='2026-09-25-modulo-prestazione';
const CONSENT_MODEL={
 title:'MODULO PER LA PRESTAZIONE PROFESSIONALE PSICOLOGICA',
 subtitle:'Consenso informato + condizioni economiche',
 professional:'Dott.ssa Stefania Rocchi - Psicologa ad indirizzo clinico-dinamico - Psicologa Giuridica - Consulente Sessuologa',
 offices:'Studio: Via II Agosto, 4 Collecchio (PR) - Via Ganaceto, 114 Modena',
 contacts:'e-mail: stefaniarocchi83@gmail.com - PEC: stefaniarocchi@psy.pec.it - Cel: 3291907991',
 services:['consulenza psicologica individuale','consulenza/counseling di coppia','consulenza familiare','consulenza psico-giuridica','valutazione psicodiagnostica','consulenza sessuologica'],
 modes:['in presenza','online']
};
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
const tokenHash=t=>createHash('sha256').update(String(t||'')).digest('hex');
const safeText=(v,n=180)=>String(v||'').trim().slice(0,n);
const latin=s=>String(s??'').replace(/[–—]/g,'-').replace(/’/g,"'").replace(/“|”/g,'"').replace(/€/g,'EUR').replace(/[^\u0000-\u00ff]/g,'?');
const pdfEscape=s=>latin(s).replace(/\\/g,'\\\\').replace(/\(/g,'\\(').replace(/\)/g,'\\)');
const wrapText=(text,max=88)=>{const words=latin(text).split(/\s+/),out=[];let line='';for(const w of words){const t=line?line+' '+w:w;if(t.length<=max)line=t;else{if(line)out.push(line);line=w}}if(line)out.push(line);return out};
function simplePdf(pages){
 const objects=[null];const add=x=>(objects.push(x),objects.length-1);const font=add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');const fontB=add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');const pageRefs=[];
 for(const lines of pages){let y=790,stream='';for(const item of lines){const size=item.size||10,fontRef=item.bold?'F2':'F1',leading=item.leading||size+4;for(const line of wrapText(item.text,item.max||88)){stream+=`BT /${fontRef} ${size} Tf 48 ${y} Td (${pdfEscape(line)}) Tj ET\n`;y-=leading}y-=item.after||0}const content=add(`<< /Length ${Buffer.byteLength(stream,'latin1')} >>\nstream\n${stream}endstream`);const page=add(`__PAGE__${content}`);pageRefs.push(page)}
 const pagesObj=add(`<< /Type /Pages /Kids [${pageRefs.map(r=>r+' 0 R').join(' ')}] /Count ${pageRefs.length} >>`);for(const r of pageRefs){const content=objects[r].replace('__PAGE__','');objects[r]=`<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${font} 0 R /F2 ${fontB} 0 R >> >> /Contents ${content} 0 R >>`}
 const catalog=add(`<< /Type /Catalog /Pages ${pagesObj} 0 R >>`);let chunks=[Buffer.from('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n','binary')],offsets=[0],pos=chunks[0].length;for(let i=1;i<objects.length;i++){offsets[i]=pos;const b=Buffer.from(`${i} 0 obj\n${objects[i]}\nendobj\n`,'latin1');chunks.push(b);pos+=b.length}const xref=pos;let tail=`xref\n0 ${objects.length}\n0000000000 65535 f \n`;for(let i=1;i<objects.length;i++)tail+=String(offsets[i]).padStart(10,'0')+' 00000 n \n';tail+=`trailer\n<< /Size ${objects.length} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF`;chunks.push(Buffer.from(tail,'latin1'));return Buffer.concat(chunks)
}
export function createConsentPdf(patient,f){
 const pages=[[]];let page=pages[0],used=0;const add=(text,opts={})=>{const count=wrapText(text,opts.max||88).length,need=count*(opts.leading||(opts.size||10)+4)+(opts.after||0);if(used+need>735){page=[];pages.push(page);used=0}page.push({text,...opts});used+=need};const sec=h=>add(h,{bold:true,size:11,after:3});const field=(l,v)=>add(l+': '+(v||'________________________________________'),{after:2});const box=(c,l)=>add((c?'[X] ':'[ ] ')+l,{after:1});
 add(CONSENT_MODEL.title,{bold:true,size:14,after:2,max:68});add('('+CONSENT_MODEL.subtitle+')',{bold:true,size:11,after:8});add(CONSENT_MODEL.professional,{size:9,after:1,max:100});add(CONSENT_MODEL.offices,{size:9,after:1,max:100});add(CONSENT_MODEL.contacts,{size:9,after:10,max:100});field('La/il sottoscritt*',f.fullName);field('nat* a',f.birthPlace+'    il '+f.birthDate);field('residente a',f.residenceCity+'    via '+f.address);field('C.F.',f.taxCode);field('SDI/PEC per fatturazione (se necessario)',f.sdiPec);add('dichiara di essere informato/a e di accettare quanto segue:',{after:5});sec('1) Prestazione');for(const x of CONSENT_MODEL.services)box(f.service===x,x);add('La prestazione potrà includere colloqui e, se necessario, test/strumenti psicodiagnostici.',{after:5});sec('2) Modalità');for(const x of CONSENT_MODEL.modes)box(f.mode===x,x);add('Durata e obiettivi vengono concordati e possono essere rimodulati nel corso del percorso.',{after:5});sec('3) Interruzione');add('Il/la cliente può interrompere il percorso in qualsiasi momento comunicandolo alla professionista.');add('La professionista può proporre l’interruzione qualora non vi siano benefici ragionevolmente prevedibili.',{after:5});sec('4) Riservatezza');add('La professionista è tenuta al segreto professionale secondo Codice Deontologico e normativa vigente.',{after:5});sec('5) Appuntamenti e disdette');add('Il/la cliente si impegna al rispetto degli orari concordati.');add('In caso di disdetta con meno di 24 ore, la seduta è da considerarsi dovuta, salvo comprovata urgenza.',{after:5});sec('6) Compenso');add('Seduta individuale: Euro 65,00 + 2% ENPAP');add('Seduta di coppia: Euro 90,00 + 2% ENPAP');add('Il compenso non può essere condizionato all’esito della prestazione. Per la detraibilità sanitaria è richiesto pagamento tracciabile.',{after:5});sec('7) Trattamento dati personali (GDPR)');add('I dati personali e quelli relativi alla salute verranno trattati esclusivamente per finalità professionali, con adeguate misure di sicurezza e nel rispetto della normativa vigente (Reg. UE 2016/679 e D.Lgs. 101/2018).',{after:5});sec('8) Assicurazione professionale');add('Polizza RC professionale UNIPOL SAI n. 1/2545/122/198921942.',{after:8});sec('CONSENSI (barrare)');box(f.consentProfessional,'Acconsento alla prestazione professionale');box(f.consentPrivacy,'Acconsento al trattamento dei dati personali e dei dati relativi alla salute');box(f.consentTs,'(se prestazione sanitaria) Acconsento all’invio dei dati al Sistema Tessera Sanitaria');field('Luogo e data',f.placeDate);field('Firma Cliente',f.clientSignature);field('Firma Professionista','');add('PDF generato dal form online Studio Rocchi. Il nominativo digitato nel campo Firma Cliente non costituisce firma digitale qualificata; il documento può essere stampato per firma autografa.',{size:8,after:2,max:105});add('Generato il '+new Date().toLocaleString('it-IT')+' - versione '+CONSENT_VERSION,{size:8,max:105});return simplePdf(pages)
}
async function getConsentLinkByToken(token){
 if(!token||token.length<32||token.length>256)fail('Link non valido',404);
 const h=tokenHash(token);const rows=await sb('/rest/v1/consent_links?token_hash=eq.'+h+'&limit=1');const link=rows[0];if(!link)fail('Link non valido o scaduto',404);
 if(link.used_at)fail('Questo consenso è già stato completato',410);
 if(new Date(link.expires_at)<=new Date())fail('Questo link è scaduto',410);
 return link;
}
export default async function handler(req,res){
 res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
 const url=new URL(req.url,'http://local');const action=url.searchParams.get('action')||'state';
 try{
  const configured=!!(process.env.SUPABASE_URL&&process.env.SUPABASE_SERVICE_ROLE_KEY);
  if(action==='config')return res.json({configured});
  if(!configured)fail('Archivio online da configurare. Consulta ATTIVAZIONE.md.',503);
  if(req.method!=='GET'&&req.headers.origin&&req.headers.origin!==`https://${req.headers.host}`&&req.headers.origin!==`http://${req.headers.host}`)fail('Origine non autorizzata',403);
  const b=typeof req.body==='string'?JSON.parse(req.body):req.body||{};
  if(action==='consent-view'){
   if(req.method!=='GET')fail('Metodo non valido',405);const link=await getConsentLinkByToken(url.searchParams.get('token'));
   const p=(await sb('/rest/v1/records?id=eq.'+link.patient_id+'&kind=eq.patients&select=id,data'))[0];if(!p)fail('Paziente non trovato',404);
   return res.json({patient:{firstName:p.data.firstName||'',lastName:p.data.lastName||'',birthDate:p.data.birthDate||'',birthPlace:p.data.birthPlace||'',address:p.data.address||'',residenceCity:p.data.city||'',taxCode:p.data.taxCode||'',mode:String(p.data.mode||'').toLowerCase()==='online'?'online':'in presenza'},expiresAt:link.expires_at,version:CONSENT_VERSION,model:CONSENT_MODEL});
  }
  if(action==='consent-submit'){
   if(req.method!=='POST')fail('Metodo non valido',405);const link=await getConsentLinkByToken(b.token);
   const p=(await sb('/rest/v1/records?id=eq.'+link.patient_id+'&kind=eq.patients'))[0];if(!p)fail('Paziente non trovato',404);
   const f={fullName:safeText(b.fullName),birthPlace:safeText(b.birthPlace),birthDate:safeText(b.birthDate,20),residenceCity:safeText(b.residenceCity),address:safeText(b.address),taxCode:safeText(b.taxCode,32).toUpperCase(),sdiPec:safeText(b.sdiPec),service:safeText(b.service),mode:safeText(b.mode),consentProfessional:b.consentProfessional===true,consentPrivacy:b.consentPrivacy===true,consentTs:b.consentTs===true,placeDate:safeText(b.placeDate),clientSignature:safeText(b.clientSignature)};
   if(f.fullName.length<3||!f.birthPlace||!f.residenceCity||!f.address||!f.taxCode||!f.placeDate||!f.clientSignature)fail('Compila tutti i campi obbligatori');
   if(!/^\d{4}-\d{2}-\d{2}$/.test(f.birthDate)||!Number.isFinite(Date.parse(f.birthDate)))fail('Data di nascita non valida');
   if(!CONSENT_MODEL.services.includes(f.service)||!CONSENT_MODEL.modes.includes(f.mode))fail('Seleziona prestazione e modalità');
   if(!f.consentProfessional||!f.consentPrivacy)fail('Per procedere occorre acconsentire alla prestazione e al trattamento dei dati');
   const expected=(safeText(p.data.firstName)+' '+safeText(p.data.lastName)).toLocaleLowerCase('it').replace(/\s+/g,' '),got=f.fullName.toLocaleLowerCase('it').replace(/\s+/g,' ');if(got!==expected)fail('Il nominativo non corrisponde a quello associato al link');
   const acceptedAt=new Date().toISOString(),core={patientId:p.id,...f,acceptedAt,consentVersion:CONSENT_VERSION,acceptanceMethod:'Modulo online compilato con consensi selezionati e nominativo digitato'};const evidenceHash=createHash('sha256').update(json(core)).digest('hex');
   const pdfBytes=await createConsentPdf(p,f),id=randomUUID(),path=p.id+'/'+id+'.pdf';await sb('/storage/v1/object/patient-files/'+path,{method:'POST',headers:{'Content-Type':'application/pdf'},body:pdfBytes});
   const data={patientId:p.id,name:'Modulo prestazione e consenso '+acceptedAt.slice(0,10)+'.pdf',path,uploadedAt:acceptedAt,sha256:createHash('sha256').update(pdfBytes).digest('hex'),documentType:'consent-online',signatureType:'Modulo online compilato - nominativo digitato, non firma digitale qualificata',acceptedAt,consentVersion:CONSENT_VERSION,evidenceHash,formData:f};
   try{await sb('/rest/v1/records',{method:'POST',body:json({id,kind:'documents',data})});await sb('/rest/v1/consent_links?id=eq.'+link.id,{method:'PATCH',body:json({used_at:acceptedAt,document_id:id})})}catch(e){await sb('/storage/v1/object/patient-files',{method:'DELETE',body:json({prefixes:[path]})});throw e}
   const signed=await sb('/storage/v1/object/sign/patient-files/'+path,{method:'POST',body:json({expiresIn:600})});return res.json({ok:true,acceptedAt,documentId:id,downloadUrl:process.env.SUPABASE_URL+'/storage/v1'+signed.signedURL});
  }
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
  if(action==='consent-create'){
   if(!uuid(b.patientId))fail('Paziente non valido');const p=(await sb('/rest/v1/records?id=eq.'+b.patientId+'&kind=eq.patients'))[0];if(!p)fail('Paziente non trovato');
   await sb('/rest/v1/consent_links?patient_id=eq.'+b.patientId+'&used_at=is.null',{method:'DELETE'});
   const raw=randomBytes(32).toString('base64url'),id=randomUUID(),expires=new Date(Date.now()+7*24*3600*1000).toISOString();await sb('/rest/v1/consent_links',{method:'POST',body:json({id,patient_id:b.patientId,token_hash:tokenHash(raw),created_by:user.id,expires_at:expires})});
   const proto=(req.headers['x-forwarded-proto']||'https').split(',')[0],host=req.headers['x-forwarded-host']||req.headers.host;return res.json({url:`${proto}://${host}/?consent=${encodeURIComponent(raw)}`,expiresAt:expires});
  }
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
   const consent=b.documentType==='consent-autograph';
   if(b.documentType&&!consent)fail('Tipo di documento non valido');
   if(consent&&(!['email','whatsapp','mano','altro'].includes(b.receivedVia)||!/^\d{4}-\d{2}-\d{2}$/.test(b.receivedDate||'')||!Number.isFinite(Date.parse(b.receivedDate))))fail('Indica la data e il canale di ricezione');
   if(consent&&!/\.pdf$/i.test(b.name))fail('Per il consenso carica un PDF');
   if(!/\.(pdf|docx?|xlsx?|png|jpe?g|gif|webp|txt|odt)$/i.test(b.name))fail('Formato non supportato');
   const bytes=Buffer.from(b.base64,'base64');if(bytes.length>3*1024*1024)fail('Dimensione massima: 3 MB');
   if(consent&&(!bytes.subarray(0,5).equals(Buffer.from('%PDF-'))||bytes.length<100))fail('Il file non sembra un PDF valido');
   const id=randomUUID(),path=b.patientId+'/'+id;await sb('/storage/v1/object/patient-files/'+path,{method:'POST',headers:{'Content-Type':'application/octet-stream'},body:bytes});
   const data={patientId:b.patientId,name:String(b.name).slice(0,180),path,uploadedAt:new Date().toISOString(),sha256:createHash('sha256').update(bytes).digest('hex')};
   if(consent)Object.assign(data,{documentType:'consent-autograph',signatureType:'Firma autografa su carta — copia PDF',receivedVia:b.receivedVia,receivedDate:b.receivedDate});
   try{await sb('/rest/v1/records',{method:'POST',body:json({id,kind:'documents',data})})}catch(e){await sb('/storage/v1/object/patient-files',{method:'DELETE',body:json({prefixes:[path]})});throw e}return res.json({ok:true});
  }
  if(action==='download'){
   if(!uuid(b.id))fail('Allegato non valido');const r=(await sb('/rest/v1/records?id=eq.'+b.id+'&kind=eq.documents'))[0];if(!r)fail('Non trovato',404);
   const signed=await sb('/storage/v1/object/sign/patient-files/'+r.data.path,{method:'POST',body:json({expiresIn:60})});return res.json({url:process.env.SUPABASE_URL+'/storage/v1'+signed.signedURL});
  }
  fail('Operazione non trovata',404);
 }catch(e){res.status(e.status||500).json({error:e.status?e.message:'Servizio non disponibile. Riprova.'})}
}
