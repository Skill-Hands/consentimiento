import express from 'express';
import pg from 'pg';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';

const { Pool } = pg;
const app = express();
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const LINK_SECRET = process.env.LINK_SECRET || '';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

app.use(express.json({ limit: '1mb' }));
app.disable('x-powered-by');

function safeEqual(a,b){
  const A=Buffer.from(a||''),B=Buffer.from(b||'');
  return A.length===B.length && crypto.timingSafeEqual(A,B);
}
function sign(profileId,version){
  return crypto.createHmac('sha256',LINK_SECRET).update(`profile:${profileId}:v:${version}`).digest('base64url');
}
async function auth(req,res,next){
  try{
    if(!LINK_SECRET) return res.status(503).json({error:'Servicio no configurado'});
    const profileId=Number(req.get('x-profile-id'));
    const signature=req.get('x-link-signature')||'';
    if(!Number.isInteger(profileId)||profileId<1||!signature) return res.status(401).json({error:'Enlace privado requerido'});
    const {rows}=await pool.query('SELECT id,access_version FROM profiles WHERE id=$1',[profileId]);
    if(!rows.length) return res.status(401).json({error:'Acceso inválido'});
    const expected=sign(profileId,rows[0].access_version||1);
    if(!safeEqual(signature,expected)) return res.status(401).json({error:'Enlace inválido o revocado'});
    req.profileId=profileId;
    next();
  }catch(e){console.error(e);res.status(500).json({error:'Error de acceso'});}
}
function refRange(low,high){
  if(low==null&&high==null)return null;
  if(low==null)return `<${high}`;
  if(high==null)return `≥${low}`;
  return `${low}–${high}`;
}
async function audit(profileId,action,entityType,entityId,source,beforeJson,afterJson,note){
  await pool.query('INSERT INTO audit_log(profile_id,action,entity_type,entity_id,source,before_json,after_json,note) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[profileId,action,entityType,entityId||null,source||null,beforeJson||null,afterJson||null,note||null]);
}
const n=v=>v===undefined||v===null||v===''?null:Number(v);
const bool=v=>v===true||v==='true'||v==='1'||v==='on'||v==='yes';

app.get('/health',(req,res)=>res.json({ok:true}));
app.use('/api',auth);

app.get('/api/dashboard',async(req,res)=>{
  try{
    const p=req.profileId;
    const [profile,m,d,l,no,s,a]=await Promise.all([
      pool.query('SELECT display_name,baseline_date,height_m,baseline_weight_kg,baseline_waist_cm,baseline_body_fat_pct,baseline_muscle_pct,baseline_visceral_fat,baseline_resting_metabolism_kcal,baseline_body_age FROM profiles WHERE id=$1',[p]),
      pool.query('SELECT id,measured_at,weight_kg,waist_cm,body_fat_pct,muscle_pct,visceral_fat,bmi,resting_metabolism_kcal,COALESCE(body_age,metabolic_age) AS body_age,fasting,after_voiding,morning,device,source,notes AS note FROM measurements WHERE profile_id=$1 AND is_void=false ORDER BY measured_at DESC LIMIT 300',[p]),
      pool.query('SELECT id,administered_at,medication_name AS medication,dose,dose_unit AS unit,dose_number,route,source,notes AS note FROM medication_doses WHERE profile_id=$1 AND is_void=false ORDER BY administered_at DESC LIMIT 200',[p]),
      pool.query('SELECT id,collected_at,panel,test_name,value_numeric AS value,value_text,unit,reference_low,reference_high,fasting,source,notes AS note FROM lab_results WHERE profile_id=$1 AND is_void=false ORDER BY collected_at DESC,id DESC LIMIT 500',[p]),
      pool.query('SELECT id,noted_at,category,note,source FROM notes WHERE profile_id=$1 AND is_void=false ORDER BY noted_at DESC LIMIT 200',[p]),
      pool.query('SELECT id,reported_at,symptom,severity,value_numeric,unit,note,source FROM symptoms WHERE profile_id=$1 AND is_void=false ORDER BY reported_at DESC LIMIT 200',[p]),
      pool.query('SELECT id,alert_code,occurred_at,source_record,category,priority,message,status,review_result FROM alerts WHERE profile_id=$1 ORDER BY occurred_at DESC,id DESC LIMIT 100',[p])
    ]);
    const labs=l.rows.map(x=>({...x,reference_range:refRange(x.reference_low,x.reference_high)}));
    res.set('Cache-Control','no-store');
    res.json({profile:profile.rows[0]||null,measurements:m.rows,doses:d.rows,labs,notes:no.rows,symptoms:s.rows,alerts:a.rows});
  }catch(e){console.error(e);res.status(500).json({error:'No se pudo cargar el seguimiento'});}
});

app.post('/api/measurements',async(req,res)=>{
  try{
    const p=req.profileId,b=req.body||{};
    const has=['weight_kg','waist_cm','body_fat_pct','muscle_pct','visceral_fat','resting_metabolism_kcal','body_age','note'].some(k=>b[k]!==undefined&&b[k]!==null&&String(b[k]).trim()!=='');
    if(!has)return res.status(400).json({error:'Ingresa al menos una medición o nota'});
    const weight=n(b.weight_kg);if(weight!==null&&(weight<30||weight>350))return res.status(400).json({error:'Peso fuera de rango esperado'});
    if(b.measured_at){const ex=await pool.query('SELECT * FROM measurements WHERE profile_id=$1 AND is_void=false AND measured_at=$2::timestamptz AND weight_kg IS NOT DISTINCT FROM $3 LIMIT 1',[p,b.measured_at,weight]);if(ex.rows.length)return res.json({...ex.rows[0],duplicate:true});}
    let bmi=n(b.bmi);if(bmi===null&&weight!==null){const pr=await pool.query('SELECT height_m FROM profiles WHERE id=$1',[p]);const h=Number(pr.rows[0]?.height_m||0);if(h)bmi=weight/(h*h)}
    const q=`INSERT INTO measurements(profile_id,measured_at,weight_kg,waist_cm,bmi,body_fat_pct,muscle_pct,visceral_fat,resting_metabolism_kcal,body_age,fasting,after_voiding,morning,device,source,notes) VALUES($1,COALESCE($2::timestamptz,now()),$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`;
    const vals=[p,b.measured_at||null,weight,n(b.waist_cm),bmi,n(b.body_fat_pct),n(b.muscle_pct),n(b.visceral_fat),n(b.resting_metabolism_kcal),n(b.body_age),bool(b.fasting),bool(b.after_voiding),bool(b.morning),b.device||null,b.source||'manual_app',b.note||null];
    const out=(await pool.query(q,vals)).rows[0];await audit(p,'create','measurement',out.id,b.source||'manual_app',null,out,null);res.status(201).json(out);
  }catch(e){console.error(e);res.status(500).json({error:'No se pudo guardar la medición'});}
});

app.post('/api/doses',async(req,res)=>{
  try{
    const p=req.profileId,b=req.body||{},dose=Number(b.dose);if(!b.medication||!Number.isFinite(dose)||dose<=0)return res.status(400).json({error:'Medicamento y dosis son obligatorios'});
    if(b.administered_at){const ex=await pool.query('SELECT * FROM medication_doses WHERE profile_id=$1 AND is_void=false AND administered_at=$2::timestamptz AND medication_name=$3 AND dose=$4 LIMIT 1',[p,b.administered_at,b.medication,dose]);if(ex.rows.length)return res.json({...ex.rows[0],duplicate:true});}
    const q='INSERT INTO medication_doses(profile_id,medication_name,dose,dose_unit,administered_at,route,dose_number,source,notes) VALUES($1,$2,$3,$4,COALESCE($5::timestamptz,now()),$6,$7,$8,$9) RETURNING *';
    const out=(await pool.query(q,[p,b.medication,dose,b.unit||'mg',b.administered_at||null,b.route||'Subcutánea',b.dose_number?Number(b.dose_number):null,b.source||'manual_app',b.note||null])).rows[0];await audit(p,'create','dose',out.id,b.source||'manual_app',null,out,null);res.status(201).json(out);
  }catch(e){console.error(e);res.status(500).json({error:'No se pudo guardar la dosis'});}
});

app.post('/api/labs',async(req,res)=>{
  try{
    const p=req.profileId,b=req.body||{};if(!b.test_name)return res.status(400).json({error:'Nombre del examen obligatorio'});const value=n(b.value);if(value!==null&&!Number.isFinite(value))return res.status(400).json({error:'Valor numérico no válido'});
    const fasting=b.fasting===undefined||b.fasting===null||b.fasting===''?null:bool(b.fasting);
    if(b.collected_at){const ex=await pool.query('SELECT * FROM lab_results WHERE profile_id=$1 AND is_void=false AND collected_at=$2::timestamptz AND test_name=$3 AND value_numeric IS NOT DISTINCT FROM $4 AND value_text IS NOT DISTINCT FROM $5 LIMIT 1',[p,b.collected_at,b.test_name,value,b.value_text||null]);if(ex.rows.length)return res.json({...ex.rows[0],duplicate:true});}
    let low=null,high=null;const rr=String(b.reference_range||'').trim();if(rr){const m=rr.match(/^\s*([<>≤≥]?)[ ]*([0-9.,]+)(?:\s*[–-]\s*([0-9.,]+))?/);if(m){const a=Number(m[2].replace(',','.'));const c=m[3]?Number(m[3].replace(',','.')):null;if(m[1]==='< '||m[1]==='<'||m[1]==='≤')high=a;else if(m[1]==='>'||m[1]==='≥')low=a;else if(c!==null){low=a;high=c;}}}
    const q='INSERT INTO lab_results(profile_id,collected_at,panel,test_name,value_numeric,value_text,unit,reference_low,reference_high,fasting,source,notes) VALUES($1,COALESCE($2::timestamptz,now()),$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *';
    const out=(await pool.query(q,[p,b.collected_at||null,b.panel||null,b.test_name,value,b.value_text||null,b.unit||null,low,high,fasting,b.source||'manual_app',b.note||null])).rows[0];await audit(p,'create','lab',out.id,b.source||'manual_app',null,out,null);res.status(201).json(out);
  }catch(e){console.error(e);res.status(500).json({error:'No se pudo guardar el laboratorio'});}
});

app.post('/api/notes',async(req,res)=>{
  try{
    const p=req.profileId,b=req.body||{};if(!b.note)return res.status(400).json({error:'La nota es obligatoria'});
    if(b.noted_at){const ex=await pool.query('SELECT * FROM notes WHERE profile_id=$1 AND is_void=false AND noted_at=$2::timestamptz AND category=$3 AND note=$4 LIMIT 1',[p,b.noted_at,b.category||'general',b.note]);if(ex.rows.length)return res.json({...ex.rows[0],duplicate:true});}
    const out=(await pool.query('INSERT INTO notes(profile_id,noted_at,category,note,source) VALUES($1,COALESCE($2::timestamptz,now()),$3,$4,$5) RETURNING *',[p,b.noted_at||null,b.category||'general',b.note,b.source||'manual_app'])).rows[0];await audit(p,'create','note',out.id,b.source||'manual_app',null,out,null);res.status(201).json(out);
  }catch(e){console.error(e);res.status(500).json({error:'No se pudo guardar la nota'});}
});

app.post('/api/symptoms',async(req,res)=>{
  try{
    const p=req.profileId,b=req.body||{};if(!b.symptom)return res.status(400).json({error:'Síntoma obligatorio'});const severity=b.severity===''||b.severity==null?null:Number(b.severity);if(severity!==null&&(!Number.isInteger(severity)||severity<0||severity>3))return res.status(400).json({error:'Severidad debe estar entre 0 y 3'});
    if(b.reported_at){const ex=await pool.query('SELECT * FROM symptoms WHERE profile_id=$1 AND is_void=false AND reported_at=$2::timestamptz AND symptom=$3 LIMIT 1',[p,b.reported_at,b.symptom]);if(ex.rows.length)return res.json({...ex.rows[0],duplicate:true});}
    const out=(await pool.query('INSERT INTO symptoms(profile_id,reported_at,symptom,severity,value_numeric,unit,note,source) VALUES($1,COALESCE($2::timestamptz,now()),$3,$4,$5,$6,$7,$8) RETURNING *',[p,b.reported_at||null,b.symptom,severity,n(b.value_numeric),b.unit||null,b.note||null,b.source||'manual_app'])).rows[0];await audit(p,'create','symptom',out.id,b.source||'manual_app',null,out,null);res.status(201).json(out);
  }catch(e){console.error(e);res.status(500).json({error:'No se pudo guardar el síntoma'});}
});

app.post('/api/alerts',async(req,res)=>{
  try{
    const p=req.profileId,b=req.body||{};if(!b.id)return res.status(400).json({error:'ID de alerta obligatorio'});const before=(await pool.query('SELECT * FROM alerts WHERE id=$1 AND profile_id=$2',[b.id,p])).rows[0];if(!before)return res.status(404).json({error:'Alerta no encontrada'});const status=b.status||before.status;const out=(await pool.query('UPDATE alerts SET status=$1,review_result=$2 WHERE id=$3 AND profile_id=$4 RETURNING *',[status,b.review_result||before.review_result||null,b.id,p])).rows[0];await audit(p,'update','alert',b.id,'manual_app',before,out,b.review_result||null);res.json(out);
  }catch(e){console.error(e);res.status(500).json({error:'No se pudo actualizar la alerta'});}
});

app.post('/api/void',async(req,res)=>{
  try{
    const p=req.profileId,b=req.body||{},map={measurement:'measurements',dose:'medication_doses',lab:'lab_results',note:'notes',symptom:'symptoms'},table=map[b.type];if(!table||!b.id||!b.reason)return res.status(400).json({error:'Tipo, ID y motivo son obligatorios'});const before=(await pool.query(`SELECT * FROM ${table} WHERE id=$1 AND profile_id=$2`,[b.id,p])).rows[0];if(!before)return res.status(404).json({error:'Registro no encontrado'});if(before.is_void)return res.json({ok:true,already_void:true});await pool.query(`UPDATE ${table} SET is_void=true,voided_at=now(),void_reason=$1 WHERE id=$2 AND profile_id=$3`,[b.reason,b.id,p]);await audit(p,'void',b.type,b.id,'manual_app',before,null,b.reason);res.json({ok:true});
  }catch(e){console.error(e);res.status(500).json({error:'No se pudo anular el registro'});}
});

app.get('/api/export',async(req,res)=>{
  try{
    const p=req.profileId;const [profile,m,d,l,note,s,a,u]=await Promise.all([pool.query('SELECT * FROM profiles WHERE id=$1',[p]),pool.query('SELECT * FROM measurements WHERE profile_id=$1 ORDER BY measured_at',[p]),pool.query('SELECT * FROM medication_doses WHERE profile_id=$1 ORDER BY administered_at',[p]),pool.query('SELECT * FROM lab_results WHERE profile_id=$1 ORDER BY collected_at,id',[p]),pool.query('SELECT * FROM notes WHERE profile_id=$1 ORDER BY noted_at',[p]),pool.query('SELECT * FROM symptoms WHERE profile_id=$1 ORDER BY reported_at',[p]),pool.query('SELECT * FROM alerts WHERE profile_id=$1 ORDER BY occurred_at,id',[p]),pool.query('SELECT * FROM audit_log WHERE profile_id=$1 ORDER BY created_at,id',[p])]);res.set('Cache-Control','no-store');res.json({exported_at:new Date().toISOString(),profile:profile.rows[0]||null,measurements:m.rows,doses:d.rows,labs:l.rows,notes:note.rows,symptoms:s.rows,alerts:a.rows,audit:u.rows});
  }catch(e){console.error(e);res.status(500).json({error:'No se pudo generar el respaldo'});}
});

app.use(express.static(path.join(__dirname,'public'),{maxAge:'1h',etag:true}));
app.get('*',(req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));

const port=process.env.PORT||3000;
app.listen(port,()=>console.log(`Mi Peso escuchando en ${port}`));
