/**
 * Oracle EBS AR Customer Balance Dashboard
 * Vite/React — with dark/light mode toggle
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell, Legend,
} from 'recharts';

const API = import.meta.env.VITE_API_URL || '';

// ── Auth helpers ──────────────────────────────────────────────────────────────
const TOKEN_KEY = 'ar_token';
const getToken  = () => sessionStorage.getItem(TOKEN_KEY);
const setToken  = (t) => sessionStorage.setItem(TOKEN_KEY, t);
const clearToken= () => sessionStorage.removeItem(TOKEN_KEY);

async function apiAuth(path, body) {
  const r = await fetch(API + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error || 'Request failed');
  return d;
}

// ── Excel Export Utility ──────────────────────────────────────────────────────
function exportToExcel(rows, headers, filename) {
  // Build CSV content (Excel opens CSV perfectly, no library needed)
  const escape = v => {
    if(v==null) return '';
    const s = String(v);
    return s.includes(',') || s.includes('"') || s.includes('\n')
      ? `"${s.replace(/"/g,'""')}"` : s;
  };
  const csv = [
    headers.map(h=>escape(h.label)).join(','),
    ...rows.map(r=>headers.map(h=>escape(r[h.key])).join(','))
  ].join('\r\n');
  const blob = new Blob(['\uFEFF'+csv], {type:'text/csv;charset=utf-8'});
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

const DARK = {
  bg:'#0f1117', surface:'#181c27', card:'#1e2336', border:'#2a3050',
  accent:'#4f8ef7', accentSoft:'#1a2d5a',
  teal:'#1dc9a4', tealSoft:'#0d3028',
  amber:'#f59e0b', coral:'#f06040', coralSoft:'#2d1510',
  purple:'#a78bfa', green:'#22c55e',
  muted:'#6b7a99', text:'#e8eaf2', textSec:'#9ba3bf',
  rowAlt:'#181c27', tooltip:'#1e2336', inputBg:'#181c27',
};
const LIGHT = {
  bg:'#f0f2f8', surface:'#ffffff', card:'#ffffff', border:'#d0d7e8',
  accent:'#2563eb', accentSoft:'#dbeafe',
  teal:'#0d9488', tealSoft:'#ccfbf1',
  amber:'#d97706', coral:'#dc2626', coralSoft:'#fee2e2',
  purple:'#7c3aed', green:'#16a34a',
  muted:'#94a3b8', text:'#0f172a', textSec:'#475569',
  rowAlt:'#f8fafc', tooltip:'#ffffff', inputBg:'#f8fafc',
};

const BUCKET_COLORS = {
  'Current':'#1dc9a4','1-30 days':'#4f8ef7','31-60 days':'#a78bfa',
  '61-90 days':'#f59e0b','91-180 days':'#f06040',
  '181-365 days':'#ef4444','365+ days':'#991b1b',
};
const BUCKET_ORDER = ['Current','1-30 days','31-60 days','61-90 days','91-180 days','181-365 days','365+ days'];
const CAT_COLORS   = ['#4f8ef7','#1dc9a4','#f59e0b','#f06040','#a78bfa','#e879f9','#34d399','#fb923c','#38bdf8'];

const fmt = (v, ccy='') => {
  if (v==null) return '—';
  const n=Number(v), p=ccy?`${ccy} `:'';
  if (Math.abs(n)>=1e6) return `${p}${(n/1e6).toFixed(2)}M`;
  if (Math.abs(n)>=1e3) return `${p}${(n/1e3).toFixed(1)}K`;
  return `${p}${n.toFixed(2)}`;
};
const fmtFull = (v,ccy='') => v==null?'—':
  `${ccy?ccy+' ':''}${Number(v).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}`;

const authHeaders = (extra={}) => {
  const tok = getToken();
  return tok ? {'Content-Type':'application/json','Authorization':'Bearer '+tok,...extra} : {'Content-Type':'application/json',...extra};
};

// Global 401 handler — clears token and triggers re-login without page reload
let _on401 = null;
const set401Handler = (fn) => { _on401 = fn; };

const apiGet  = async path => {
  const r=await fetch(`${API}${path}`,{headers:authHeaders()});
  if(r.status===401){clearToken(); if(_on401) _on401(); return {};}
  const j=await r.json(); if(!r.ok) throw new Error(j.error||`HTTP ${r.status}`); return j;
};
const apiPost = async (path,body) => {
  const r=await fetch(`${API}${path}`,{method:'POST',headers:authHeaders(),body:JSON.stringify(body)});
  if(r.status===401){clearToken(); if(_on401) _on401(); return {};}
  const j=await r.json(); if(!r.ok) throw new Error(j.error||`HTTP ${r.status}`); return j;
};

function processData({customerBalance,projectBalance,agingBuckets}) {
  const catMap={};
  customerBalance.forEach(r=>{ const c=r.category||'UNCLASSIFIED'; catMap[c]=(catMap[c]||0)+Number(r.func_outstanding||0); });
  const catPie=Object.entries(catMap).map(([name,value])=>({name,value:Math.round(value)})).sort((a,b)=>b.value-a.value);
  const bucketMap={};
  agingBuckets.forEach(r=>{ bucketMap[r.aging_bucket]=(bucketMap[r.aging_bucket]||0)+Number(r.func_outstanding||0); });
  const bucketPie=BUCKET_ORDER.filter(b=>bucketMap[b]).map(b=>({name:b,value:Math.round(bucketMap[b])}));
  const pivotMap={};
  agingBuckets.forEach(r=>{
    const key=r.account_number||r.customer_name;
    if(!pivotMap[key]) pivotMap[key]={customer_name:r.customer_name,account_number:r.account_number,company:r.company||''};
    pivotMap[key][r.aging_bucket]=(pivotMap[key][r.aging_bucket]||0)+Number(r.func_outstanding||0);
  });
  const totalOS  =customerBalance.reduce((s,r)=>s+Number(r.func_outstanding||0),0);
  const overdueOS=agingBuckets.filter(r=>r.aging_bucket!=='Current').reduce((s,r)=>s+Number(r.func_outstanding||0),0);
  return {customerBalance,projectBalance,agingBuckets,agingTable:Object.values(pivotMap),catPie,bucketPie,totalOS,overdueOS};
}

function makeS(C) {
  return {
    root:     {background:C.bg,minHeight:'100vh',fontFamily:"'Inter','Segoe UI',sans-serif",color:C.text,paddingBottom:48},
    header:   {background:C.surface,borderBottom:`1px solid ${C.border}`,padding:'0 12px',display:'flex',alignItems:'center',gap:8,height:56,position:'sticky',top:0,zIndex:30,boxShadow:'0 1px 4px rgba(0,0,0,0.07)',flexWrap:'wrap'},
    logo:     {width:30,height:30,borderRadius:7,flexShrink:0,background:`linear-gradient(135deg,${C.accent},${C.teal})`,display:'flex',alignItems:'center',justifyContent:'center',fontSize:13,fontWeight:700,color:'#fff'},
    slicerBar:{background:C.surface,borderBottom:`1px solid ${C.border}`,padding:'0 8px',display:'flex',alignItems:'stretch',gap:0,flexWrap:'wrap',boxShadow:'0 2px 8px rgba(0,0,0,0.06)',minHeight:48,overflowX:'auto',WebkitOverflowScrolling:'touch'},
    slicerSeg:{display:'flex',alignItems:'center',gap:8,padding:'0 10px',borderRight:`1px solid ${C.border}`},
    slicerLabel:{fontSize:10,fontWeight:700,color:C.accent,textTransform:'uppercase',letterSpacing:'0.1em'},
    select:   {background:C.inputBg,border:`1px solid ${C.border}`,borderRadius:8,color:C.text,padding:'7px 32px 7px 12px',fontSize:13,cursor:'pointer',outline:'none',appearance:'none',minWidth:140,maxWidth:'100%',backgroundImage:`url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%236b7a99' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E")`,backgroundRepeat:'no-repeat',backgroundPosition:'right 10px center'},
    ccyBadge: {fontSize:12,fontWeight:700,padding:'4px 10px',borderRadius:6,background:C.accentSoft,color:C.accent},
    main:     {maxWidth:'100%',margin:'0 auto',padding:'32px 40px 0'},
    grid2:    {display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(280px,1fr))',gap:16,marginBottom:20},
    grid4:    {display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(160px,1fr))',gap:14,marginBottom:20},
    card:     {background:C.card,border:`1px solid ${C.border}`,borderRadius:14,padding:'20px 22px',boxShadow:'0 4px 20px rgba(0,0,0,0.08)'},
    btnSm:    {background:'transparent',color:C.textSec,border:`1px solid ${C.border}`,borderRadius:8,padding:'7px 16px',fontSize:13,cursor:'pointer'},
    tab:      a=>({padding:'8px 16px',fontSize:13,cursor:'pointer',border:'none',background:'none',color:a?C.accent:C.muted,borderBottom:a?`2px solid ${C.accent}`:'2px solid transparent',fontWeight:a?600:400}),
    th:       {fontSize:11,color:C.muted,textTransform:'uppercase',letterSpacing:'0.06em',padding:'8px 10px',background:C.surface,borderBottom:`1px solid ${C.border}`,textAlign:'left'},
    td:       {fontSize:13,color:C.text,padding:'9px 10px',borderBottom:`1px solid ${C.border}`},
    tdR:      {fontSize:13,color:C.text,padding:'9px 10px',borderBottom:`1px solid ${C.border}`,textAlign:'right',fontVariantNumeric:'tabular-nums'},
    pill:     (c,bg)=>({fontSize:11,padding:'3px 8px',borderRadius:5,background:bg,color:c,fontWeight:500}),
    divider:  {width:1,height:24,background:C.border,flexShrink:0},
    overlay:  {position:'fixed',inset:0,background:'rgba(0,0,0,0.7)',zIndex:100,display:'flex',alignItems:'center',justifyContent:'center',padding:'12px'},
    modal:    {background:C.card,border:`1px solid ${C.border}`,borderRadius:16,width:'100%',maxWidth:720,maxHeight:'90vh',overflow:'auto'},
    searchBox:{width:'100%',background:C.inputBg,border:`1px solid ${C.border}`,borderRadius:8,color:C.text,padding:'8px 12px 8px 32px',fontSize:13,outline:'none',boxSizing:'border-box'},
  };
}

const KPI_GRADIENTS = [
  'linear-gradient(135deg, #16a34a 0%, #15803d 100%)',
  'linear-gradient(135deg, #e02424 0%, #9b1c1c 100%)',
  'linear-gradient(135deg, #d97706 0%, #b45309 100%)',
  'linear-gradient(135deg, #7e3af2 0%, #5521b5 100%)',
];

function KPI({label,value,sub,C,S,index=0}) {
  return (
    <div style={{...S.card,padding:'24px 24px',background:KPI_GRADIENTS[index%4],border:'none'}}>
      <div style={{fontSize:11,color:'rgba(255,255,255,0.75)',textTransform:'uppercase',letterSpacing:'0.08em',marginBottom:6}}>{label}</div>
      <div style={{fontSize:24,fontWeight:700,color:'#ffffff',fontVariantNumeric:'tabular-nums',lineHeight:1.2}}>{value}</div>
      {sub&&<div style={{fontSize:12,color:'rgba(255,255,255,0.65)',marginTop:5}}>{sub}</div>}
    </div>
  );
}

function SHead({title,sub,C}) {
  return <div style={{marginBottom:14}}><div style={{fontSize:14,fontWeight:600,color:C.text}}>{title}</div>{sub&&<div style={{fontSize:12,color:C.muted,marginTop:2}}>{sub}</div>}</div>;
}

function Tip({active,payload,label,ccy='',C}) {
  if(!active||!payload?.length) return null;
  return (
    <div style={{background:C.tooltip,border:`1px solid ${C.border}`,borderRadius:8,padding:'10px 14px',fontSize:12,boxShadow:'0 4px 12px rgba(0,0,0,0.15)'}}>
      {label&&<div style={{color:C.textSec,marginBottom:4}}>{label}</div>}
      {payload.map((p,i)=><div key={i} style={{color:p.fill||p.color||C.text,fontWeight:500}}>{p.name}: {ccy} {Number(p.value).toLocaleString('en-US',{minimumFractionDigits:0,maximumFractionDigits:0})}</div>)}
    </div>
  );
}

function FPill({label,active,onClick,C,S}) {
  return <button onClick={onClick} style={{...S.btnSm,fontSize:12,color:active?C.accent:C.muted,borderColor:active?C.accent:C.border,background:active?C.accentSoft:'transparent'}}>{label}</button>;
}

function Spinner({msg,C}) {
  return (
    <div style={{background:C.bg,minHeight:'100vh',fontFamily:"'Inter','Segoe UI',sans-serif",color:C.text,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:20}}>
      <style>{`@keyframes bounce{0%,100%{transform:translateY(0);opacity:.4}50%{transform:translateY(-9px);opacity:1}}`}</style>
      <div style={{width:48,height:48,borderRadius:12,flexShrink:0,background:`linear-gradient(135deg,${C.accent},${C.teal})`,display:'flex',alignItems:'center',justifyContent:'center',fontSize:18,fontWeight:700,color:'#fff'}}>AR</div>
      <div style={{color:C.textSec,fontSize:14}}>{msg}</div>
      <div style={{display:'flex',gap:7}}>{[0,1,2].map(i=><div key={i} style={{width:8,height:8,borderRadius:'50%',background:C.accent,animation:`bounce 1.2s ease-in-out ${i*0.2}s infinite`}}/>)}</div>
    </div>
  );
}

function ThemeToggle({dark,onToggle,C,S}) {
  return (
    <button onClick={onToggle} title={dark?'Switch to light mode':'Switch to dark mode'}
      style={{...S.btnSm,display:'flex',alignItems:'center',gap:6,padding:'6px 12px',color:C.accent,borderColor:C.accent}}>
      {dark?'☀️':'🌙'}<span style={{fontSize:12}}>{dark?'Light':'Dark'}</span>
    </button>
  );
}

function CustomerInfoModal({info,onClose,C,S}) {
  if(!info) return null;
  const row=(label,value,color)=>value?(
    <tr>
      <td style={{...S.td,color:C.muted,fontSize:12,width:160,whiteSpace:'nowrap'}}>{label}</td>
      <td style={{...S.td,color:color||C.text,fontWeight:color?600:400}}>{value}</td>
    </tr>
  ):null;
  const address=[info.address1,info.address2,info.address3,info.address4,info.city,info.country].filter(Boolean).join(', ');
  return (
    <div style={S.overlay} onClick={onClose}>
      <div style={S.modal} onClick={e=>e.stopPropagation()}>
        <div style={{padding:'20px 24px',borderBottom:`1px solid ${C.border}`,display:'flex',alignItems:'center',gap:16}}>
          <div style={{width:44,height:44,borderRadius:10,background:C.accentSoft,display:'flex',alignItems:'center',justifyContent:'center',fontSize:16,fontWeight:700,color:C.accent,flexShrink:0}}>
            {(info.party_name||'?').charAt(0).toUpperCase()}
          </div>
          <div style={{flex:1}}>
            <div style={{fontWeight:700,fontSize:17,color:C.text}}>{info.party_name}</div>
            <div style={{fontSize:12,color:C.muted,marginTop:2}}>Account: {info.account_number} · Created: {info.creation_date}</div>
          </div>
          <div style={{display:'flex',gap:8,alignItems:'center'}}>
            <span style={{...S.pill(info.status==='Active'?C.teal:C.coral,(info.status==='Active'?C.teal:C.coral)+'22'),fontSize:12,padding:'4px 12px'}}>{info.status||'—'}</span>
            <button onClick={onClose} style={{...S.btnSm,padding:'6px 12px'}}>✕ Close</button>
          </div>
        </div>
        <div style={{padding:'16px',display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(240px,1fr))',gap:16}}>
          <div>
            <div style={{fontSize:11,color:C.muted,textTransform:'uppercase',letterSpacing:'0.07em',marginBottom:10}}>General</div>
            <table style={{width:'100%',borderCollapse:'collapse'}}><tbody>
              {row('Customer name',info.party_name)}
              {row('Account number',info.account_number)}
              {row('Customer class',info.cust_class)}
              {row('Address',address)}
              {row('CPR / CR',info.cr_cpr)}
              {row('Created',info.creation_date)}
            </tbody></table>
          </div>
          <div>
            <div style={{fontSize:11,color:C.muted,textTransform:'uppercase',letterSpacing:'0.07em',marginBottom:10}}>Tax &amp; Credit</div>
            <table style={{width:'100%',borderCollapse:'collapse'}}><tbody>
              {row('Tax reg number',info.registration_number)}
              {row('Tax effective from',info.effective_from)}
              {row('Tax effective to',info.effective_to)}
              {row('Tax rep name',info.rep_name)}
              {row('Credit checking',info.credit_checking==='Y'?'Yes':'No')}
              {row('Credit hold',info.credit_hold==='Y'?'YES — On Hold':'No',info.credit_hold==='Y'?C.coral:C.teal)}
            </tbody></table>
          </div>
        </div>
        {info.emails&&info.emails.length>0&&(
          <div style={{padding:'0 24px 20px'}}>
            <div style={{borderTop:`1px solid ${C.border}`,paddingTop:16}}>
              <div style={{fontSize:11,color:C.muted,textTransform:'uppercase',letterSpacing:'0.07em',marginBottom:10}}>Email addresses ({info.emails.length})</div>
              <div style={{display:'flex',flexWrap:'wrap',gap:8}}>
                {info.emails.map((email,i)=>(
                  <a key={i} href={`mailto:${email}`} style={{display:'inline-flex',alignItems:'center',gap:6,background:C.accentSoft,border:`1px solid ${C.border}`,borderRadius:8,padding:'6px 12px',fontSize:13,color:C.accent,textDecoration:'none'}}>
                    <span style={{fontSize:14}}>✉</span> {email}
                  </a>
                ))}
              </div>
            </div>
          </div>
        )}
        {info.emails&&info.emails.length===0&&(
          <div style={{padding:'0 24px 20px'}}>
            <div style={{borderTop:`1px solid ${C.border}`,paddingTop:16,fontSize:13,color:C.muted}}>No active email addresses on file.</div>
          </div>
        )}
      </div>
    </div>
  );
}

function ProjectInfoModal({info,onClose,C,S,currency}) {
  if(!info) return null;
  const fmt=v=>v!=null?Number(v).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}):null;
  const row=(label,value,color)=>value!=null&&value!==''?(
    <tr>
      <td style={{...S.td,color:C.muted,fontSize:12,width:160,whiteSpace:'nowrap'}}>{label}</td>
      <td style={{...S.td,color:color||C.text,fontWeight:color?600:400}}>{value}</td>
    </tr>
  ):null;
  const statusColor=s=>{
    if(!s) return C.muted;
    const sl=s.toLowerCase();
    if(sl.includes('active')||sl.includes('approv')) return C.teal;
    if(sl.includes('close')||sl.includes('cancel')) return C.coral;
    if(sl.includes('hold')) return C.amber;
    return C.textSec;
  };
  return (
    <div style={S.overlay} onClick={onClose}>
      <div style={{...S.modal,maxWidth:680}} onClick={e=>e.stopPropagation()}>
        {/* Header */}
        <div style={{padding:'20px 24px',borderBottom:`1px solid ${C.border}`,display:'flex',alignItems:'center',gap:16}}>
          <div style={{width:44,height:44,borderRadius:10,background:C.tealSoft||C.accentSoft,display:'flex',alignItems:'center',justifyContent:'center',fontSize:18,flexShrink:0}}>🏗️</div>
          <div style={{flex:1}}>
            <div style={{fontWeight:700,fontSize:17,color:C.text}}>{info.project_name}</div>
            <div style={{fontSize:12,color:C.muted,marginTop:2}}>Project No: {info.project_no} · {info.operating_unit||''}</div>
          </div>
          <div style={{display:'flex',gap:8,alignItems:'center'}}>
            <span style={{...S.pill(statusColor(info.project_status),statusColor(info.project_status)+'22'),fontSize:12,padding:'4px 12px'}}>{info.project_status||'—'}</span>
            <button onClick={onClose} style={{...S.btnSm,padding:'6px 12px'}}>✕ Close</button>
          </div>
        </div>
        {/* Body */}
        <div style={{padding:'16px',display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(240px,1fr))',gap:16}}>
          {/* Left — Project Details */}
          <div>
            <div style={{fontSize:11,color:C.muted,textTransform:'uppercase',letterSpacing:'0.07em',marginBottom:10}}>Project Details</div>
            <table style={{width:'100%',borderCollapse:'collapse'}}><tbody>
              {row('Project No',info.project_no)}
              {row('Project Name',info.project_name)}
              {row('Project Type',info.project_type)}
              {row('Status',info.project_status,statusColor(info.project_status))}
              {row('Start Date',info.start_date)}
              {row('Completion Date',info.completion_date)}
              {row('Main Project',info.main_project)}
              {row('Operating Unit',info.operating_unit)}
            </tbody></table>
          </div>
          {/* Right — Value */}
          <div>
            <div style={{fontSize:11,color:C.muted,textTransform:'uppercase',letterSpacing:'0.07em',marginBottom:10}}>Project Value</div>
            {info.project_value!=null?(
              <div style={{background:C.accentSoft,border:`1px solid ${C.border}`,borderRadius:12,padding:'16px 20px',textAlign:'center'}}>
                <div style={{fontSize:11,color:C.muted,marginBottom:6}}>Total Allocated Funding ({currency})</div>
                <div style={{fontSize:24,fontWeight:700,color:C.accent}}>{fmt(info.project_value)}</div>
              </div>
            ):(
              <div style={{color:C.muted,fontSize:13}}>No funding data available.</div>
            )}
          </div>
        </div>
        {/* Linked Projects */}
        {info.linked_projects&&info.linked_projects.length>0&&(
          <div style={{padding:'0 24px 20px'}}>
            <div style={{borderTop:`1px solid ${C.border}`,paddingTop:16}}>
              <div style={{fontSize:11,color:C.muted,textTransform:'uppercase',letterSpacing:'0.07em',marginBottom:10}}>Linked / Secondary Projects ({info.linked_projects.length})</div>
              <div style={{display:'flex',flexWrap:'wrap',gap:8}}>
                {info.linked_projects.map((p,i)=>(
                  <div key={i} style={{display:'inline-flex',alignItems:'center',gap:8,background:C.surface,border:`1px solid ${C.border}`,borderRadius:8,padding:'6px 12px',fontSize:12}}>
                    <span style={{color:C.accent,fontWeight:700}}>{p.linked_project_no}</span>
                    <span style={{color:C.textSec}}>{p.linked_project_name}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── LoginScreen (PA Dashboard style) ─────────────────────────────────────────
function LoginScreen({onLogin, dark}) {
  const C = dark ? DARK : LIGHT;
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState('');
  const [forgot,   setForgot]   = useState(false);
  const [fEmail,   setFEmail]   = useState('');
  const [fMsg,     setFMsg]     = useState('');
  const [fLoading, setFLoading] = useState(false);

  const handleLogin = async () => {
    if(!username||!password) return;
    setError(''); setLoading(true);
    try {
      const data = await apiAuth('/api/auth/login', { username: username.trim(), password: password.trim() });
      setToken(data.token);
      onLogin(data.user);
    } catch(err) { setError(err.message); }
    finally { setLoading(false); }
  };

  const handleForgot = async () => {
    setFMsg(''); setFLoading(true);
    try {
      const data = await apiAuth('/api/auth/forgot-password', { email: fEmail.trim() });
      setFMsg(data.message);
    } catch(err) { setFMsg(err.message); }
    finally { setFLoading(false); }
  };

  // PA Dashboard style — dark background, centered card, logo top
  return (
    <div style={{minHeight:'100vh',background:'#0f1117',display:'flex',alignItems:'center',justifyContent:'center',padding:16}}>
      <div style={{width:'100%',maxWidth:460}}>
        {!forgot ? (
          <div style={{background:'#181c27',border:'1px solid #2a3050',borderRadius:16,padding:'40px 40px 36px',boxShadow:'0 20px 60px rgba(0,0,0,0.4)'}}>
            {/* Logo + Title */}
            <div style={{display:'flex',alignItems:'center',gap:16,marginBottom:32}}>
              <div style={{width:52,height:52,borderRadius:14,background:'linear-gradient(135deg,#6D28D9,#4F46E5)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:22,fontWeight:800,color:'#fff',flexShrink:0}}>AR</div>
              <div>
                <div style={{fontSize:20,fontWeight:700,color:'#fff',lineHeight:1.2}}>AR Balance Dashboard</div>
                <div style={{fontSize:13,color:'#64748b',marginTop:3}}>Sign in to continue</div>
              </div>
            </div>

            {/* Error */}
            {error&&<div style={{background:'rgba(220,38,38,0.15)',border:'1px solid rgba(220,38,38,0.4)',borderRadius:8,padding:'10px 14px',marginBottom:20,fontSize:13,color:'#f87171'}}>{error}</div>}

            {/* Username */}
            <div style={{marginBottom:16}}>
              <input
                type="text"
                value={username}
                onChange={e=>setUsername(e.target.value)}
                onKeyDown={e=>e.key==='Enter'&&handleLogin()}
                placeholder="Username"
                style={{width:'100%',background:'#0f1117',border:'1px solid #2a3050',borderRadius:10,padding:'14px 16px',fontSize:14,color:'#e2e8f0',outline:'none',boxSizing:'border-box',transition:'border-color 0.15s'}}
                onFocus={e=>e.target.style.borderColor='#6D28D9'}
                onBlur={e=>e.target.style.borderColor='#2a3050'}
              />
            </div>

            {/* Password */}
            <div style={{marginBottom:12}}>
              <input
                type="password"
                value={password}
                onChange={e=>setPassword(e.target.value)}
                onKeyDown={e=>e.key==='Enter'&&handleLogin()}
                placeholder="Password"
                style={{width:'100%',background:'#0f1117',border:'1px solid #2a3050',borderRadius:10,padding:'14px 16px',fontSize:14,color:'#e2e8f0',outline:'none',boxSizing:'border-box',transition:'border-color 0.15s'}}
                onFocus={e=>e.target.style.borderColor='#6D28D9'}
                onBlur={e=>e.target.style.borderColor='#2a3050'}
              />
            </div>

            {/* Forgot password */}
            <div style={{textAlign:'right',marginBottom:24}}>
              <button onClick={()=>{setForgot(true);setError('');}} type="button"
                style={{background:'none',border:'none',cursor:'pointer',color:'#6D28D9',fontSize:13,fontWeight:500}}>
                Forgot password?
              </button>
            </div>

            {/* Sign in button */}
            <button onClick={handleLogin} disabled={loading||!username||!password}
              style={{width:'100%',background:username&&password&&!loading?'linear-gradient(135deg,#6D28D9,#4F46E5)':'#334155',
                color:'#fff',border:'none',borderRadius:10,padding:'14px',fontSize:15,fontWeight:700,
                cursor:username&&password&&!loading?'pointer':'default',
                transition:'all 0.15s',display:'flex',alignItems:'center',justifyContent:'center',gap:8}}>
              {loading?'Signing in…':<>→&nbsp;&nbsp;Sign in</>}
            </button>
          </div>
        ) : (
          <div style={{background:'#181c27',border:'1px solid #2a3050',borderRadius:16,padding:'40px 40px 36px',boxShadow:'0 20px 60px rgba(0,0,0,0.4)'}}>
            <div style={{display:'flex',alignItems:'center',gap:16,marginBottom:28}}>
              <div style={{width:52,height:52,borderRadius:14,background:'linear-gradient(135deg,#6D28D9,#4F46E5)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:22,fontWeight:800,color:'#fff'}}>AR</div>
              <div>
                <div style={{fontSize:18,fontWeight:700,color:'#fff'}}>Reset Password</div>
                <div style={{fontSize:13,color:'#64748b',marginTop:2}}>Enter your email to receive a reset link</div>
              </div>
            </div>
            {fMsg&&<div style={{background:'rgba(0,137,123,0.15)',border:'1px solid rgba(0,137,123,0.4)',borderRadius:8,padding:'10px 14px',marginBottom:16,fontSize:13,color:'#4fd1c5'}}>{fMsg}</div>}
            <input type="email" value={fEmail} onChange={e=>setFEmail(e.target.value)} placeholder="Email address"
              onKeyDown={e=>e.key==='Enter'&&handleForgot()}
              style={{width:'100%',background:'#0f1117',border:'1px solid #2a3050',borderRadius:10,padding:'14px 16px',fontSize:14,color:'#e2e8f0',outline:'none',boxSizing:'border-box',marginBottom:16}}/>
            <button onClick={handleForgot} disabled={fLoading||!fEmail}
              style={{width:'100%',background:fEmail&&!fLoading?'linear-gradient(135deg,#6D28D9,#4F46E5)':'#334155',color:'#fff',border:'none',borderRadius:10,padding:'14px',fontSize:15,fontWeight:700,cursor:'pointer',marginBottom:12}}>
              {fLoading?'Sending…':'Send reset link'}
            </button>
            <button onClick={()=>setForgot(false)} style={{width:'100%',background:'none',border:'1px solid #2a3050',borderRadius:10,padding:'12px',fontSize:13,color:'#64748b',cursor:'pointer'}}>
              ← Back to sign in
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── ResetPasswordScreen ───────────────────────────────────────────────────────
function ResetPasswordScreen({token, dark}) {
  const C = dark ? DARK : LIGHT;
  const [password,  setPassword]  = useState('');
  const [password2, setPassword2] = useState('');
  const [loading,   setLoading]   = useState(false);
  const [msg,       setMsg]       = useState('');
  const [error,     setError]     = useState('');
  const [done,      setDone]      = useState(false);

  const handleReset = async () => {
    setError('');
    if(password.length < 8) return setError('Password must be at least 8 characters.');
    if(password !== password2) return setError('Passwords do not match.');
    setLoading(true);
    try {
      const data = await apiAuth('/api/auth/reset-password', { token, password });
      setMsg(data.message); setDone(true);
    } catch(err) { setError(err.message); }
    finally { setLoading(false); }
  };

  return (
    <div style={{minHeight:'100vh',background:C.bg,display:'flex',alignItems:'center',justifyContent:'center',padding:16}}>
      <div style={{width:'100%',maxWidth:420}}>
        <div style={{textAlign:'center',marginBottom:32}}>
          <div style={{width:64,height:64,borderRadius:16,background:`linear-gradient(135deg,${C.accent},${C.teal})`,display:'flex',alignItems:'center',justifyContent:'center',fontSize:28,fontWeight:800,color:'#fff',margin:'0 auto 16px'}}>AR</div>
          <div style={{fontSize:22,fontWeight:700,color:C.text}}>AR Balance Dashboard</div>
        </div>
        <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:16,padding:32,boxShadow:'0 8px 32px rgba(0,0,0,0.12)'}}>
          <div style={{fontSize:18,fontWeight:700,color:C.text,marginBottom:8}}>Set new password</div>
          {done ? (
            <div>
              <div style={{background:C.tealSoft||'#e0f2f1',border:`1px solid ${C.teal}`,borderRadius:8,padding:'12px 16px',marginBottom:20,fontSize:14,color:C.teal}}>{msg}</div>
              <button onClick={()=>window.location.href='/'} style={{width:'100%',background:C.accent,color:'#fff',border:'none',borderRadius:8,padding:'12px',fontSize:15,fontWeight:700,cursor:'pointer'}}>→ Go to login</button>
            </div>
          ) : (
            <>
              {error&&<div style={{background:'#fef2f2',border:'1px solid #fca5a5',borderRadius:8,padding:'10px 14px',marginBottom:16,fontSize:13,color:'#dc2626'}}>{error}</div>}
              <div style={{marginBottom:16}}>
                <label style={{fontSize:12,fontWeight:600,color:C.muted,textTransform:'uppercase',letterSpacing:'0.05em',display:'block',marginBottom:6}}>New Password</label>
                <input type="password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="Min. 8 characters"
                  style={{width:'100%',background:C.inputBg||C.surface,border:`1px solid ${C.border}`,borderRadius:8,padding:'10px 14px',fontSize:14,color:C.text,outline:'none',boxSizing:'border-box'}}/>
              </div>
              <div style={{marginBottom:24}}>
                <label style={{fontSize:12,fontWeight:600,color:C.muted,textTransform:'uppercase',letterSpacing:'0.05em',display:'block',marginBottom:6}}>Confirm Password</label>
                <input type="password" value={password2} onChange={e=>setPassword2(e.target.value)} placeholder="Repeat new password"
                  onKeyDown={e=>e.key==='Enter'&&handleReset()}
                  style={{width:'100%',background:C.inputBg||C.surface,border:`1px solid ${C.border}`,borderRadius:8,padding:'10px 14px',fontSize:14,color:C.text,outline:'none',boxSizing:'border-box'}}/>
              </div>
              <button onClick={handleReset} disabled={loading||!password||!password2}
                style={{width:'100%',background:password&&password2&&!loading?C.accent:'#94a3b8',color:'#fff',border:'none',borderRadius:8,padding:'12px',fontSize:15,fontWeight:700,cursor:'pointer'}}>
                {loading?'Resetting…':'Set new password'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── UserManagementPanel ───────────────────────────────────────────────────────
function UserManagementPanel({C, S, authUser}) {
  const [users,    setUsers]    = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editUser, setEditUser] = useState(null);
  const [form,     setForm]     = useState({username:'',password:'',role:'user',active:true});
  const [saving,   setSaving]   = useState(false);
  const [error,    setError]    = useState('');
  const [success,  setSuccess]  = useState('');

  const loadUsers = async () => {
    setLoading(true);
    try { setUsers(await apiGet('/api/auth/users')); }
    catch(e) { setError(e.message); }
    finally { setLoading(false); }
  };

  useEffect(()=>{ loadUsers(); },[]);

  const openAdd = () => { setEditUser(null); setForm({username:'',password:'',role:'user',active:true}); setError(''); setSuccess(''); setShowForm(true); };
  const openEdit = (u) => { setEditUser(u); setForm({username:u.username,password:'',role:u.role,active:u.active}); setError(''); setSuccess(''); setShowForm(true); };

  const handleSave = async () => {
    setError(''); setSaving(true);
    try {
      const tok = getToken();
      if(editUser) {
        const body = {role:form.role,active:form.active};
        if(form.password) body.password = form.password;
        const r = await fetch(API+'/api/auth/users/'+editUser.username, {method:'PUT',headers:{'Content-Type':'application/json','Authorization':'Bearer '+tok},body:JSON.stringify(body)});
        const d = await r.json(); if(!r.ok) throw new Error(d.error);
        setSuccess('User updated successfully.');
      } else {
        await apiPost('/api/auth/users', {username:form.username,password:form.password,role:form.role});
        setSuccess('User created successfully.');
      }
      setShowForm(false); loadUsers();
    } catch(e) { setError(e.message); }
    finally { setSaving(false); }
  };

  const handleDelete = async (u) => {
    if(!confirm(`Delete user ${u.name}? This cannot be undone.`)) return;
    try {
      const tok = getToken();
      await fetch(API+'/api/auth/users/'+u.username, {method:'DELETE', headers:{'Authorization':'Bearer '+tok,'Content-Type':'application/json'}});
      loadUsers();
    } catch(e) { setError(e.message); }
  };

  const fld = (label, key, type='text', placeholder='') => (
    <div style={{marginBottom:14}}>
      <label style={{fontSize:12,fontWeight:600,color:C.muted,textTransform:'uppercase',letterSpacing:'0.05em',display:'block',marginBottom:5}}>{label}</label>
      <input type={type} value={form[key]} onChange={e=>setForm(f=>({...f,[key]:type==='checkbox'?e.target.checked:e.target.value}))}
        placeholder={placeholder}
        style={{width:'100%',background:C.inputBg||C.surface,border:`1px solid ${C.border}`,borderRadius:8,padding:'9px 13px',fontSize:13,color:C.text,outline:'none',boxSizing:'border-box'}}/>
    </div>
  );

  return (
    <div style={{padding:'0 0 40px'}}>
      {/* Header */}
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:20}}>
        <div>
          <div style={{fontWeight:700,fontSize:18,color:C.text}}>User Management</div>
          <div style={{fontSize:12,color:C.muted,marginTop:2}}>{users.length} users · Passwords stored securely (bcrypt)</div>
        </div>
        <button onClick={openAdd} style={{...S.btnSm,background:C.accent,color:'#fff',border:'none',padding:'8px 18px',fontSize:13,fontWeight:600,display:'flex',alignItems:'center',gap:6}}>
          + Add User
        </button>
      </div>

      {/* Add/Edit Form */}
      {showForm&&(
        <div style={{...S.card,marginBottom:20,padding:24}}>
          <div style={{fontWeight:700,fontSize:15,color:C.text,marginBottom:16}}>{editUser?'Edit User':'Add New User'}</div>
          {error&&<div style={{background:'#fef2f2',border:'1px solid #fca5a5',borderRadius:8,padding:'10px 14px',marginBottom:14,fontSize:13,color:'#dc2626'}}>{error}</div>}
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:14}}>
            <div>{fld('Username (Email)','username','email','user@company.com')}</div>
            <div>{fld(editUser?'New Password (leave blank to keep)':'Password','password','password',editUser?'Leave blank to keep current':'Password')}</div>
            <div>
              <label style={{fontSize:12,fontWeight:600,color:C.muted,textTransform:'uppercase',letterSpacing:'0.05em',display:'block',marginBottom:5}}>Role</label>
              <select value={form.role} onChange={e=>setForm(f=>({...f,role:e.target.value}))}
                style={{width:'100%',background:C.inputBg||C.surface,border:`1px solid ${C.border}`,borderRadius:8,padding:'9px 13px',fontSize:13,color:C.text,outline:'none'}}>
                <option value="user">User</option>
                <option value="admin">Admin</option>
              </select>
            </div>
          </div>
          {editUser&&(
            <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:14}}>
              <input type="checkbox" id="activeChk" checked={form.active} onChange={e=>setForm(f=>({...f,active:e.target.checked}))} style={{width:16,height:16,cursor:'pointer'}}/>
              <label htmlFor="activeChk" style={{fontSize:13,color:C.text,cursor:'pointer'}}>Account active</label>
            </div>
          )}
          <div style={{display:'flex',gap:10,marginTop:4}}>
            <button onClick={handleSave} disabled={saving||!form.username||(!editUser&&!form.password)}
              style={{background:C.accent,color:'#fff',border:'none',borderRadius:8,padding:'9px 20px',fontSize:13,fontWeight:600,cursor:'pointer'}}>
              {saving?'Saving…':editUser?'Save Changes':'Create User'}
            </button>
            <button onClick={()=>setShowForm(false)} style={{...S.btnSm,padding:'9px 16px',fontSize:13}}>Cancel</button>
          </div>
        </div>
      )}

      {success&&<div style={{background:'#e0f2f1',border:`1px solid ${C.teal}`,borderRadius:8,padding:'10px 14px',marginBottom:16,fontSize:13,color:C.teal}}>{success}</div>}

      {/* Users Table */}
      <div style={S.card}>
        {loading?<div style={{padding:32,textAlign:'center',color:C.muted}}>Loading users…</div>:(
          <div style={{overflowX:'auto'}}>
            <table style={{width:'100%',borderCollapse:'collapse'}}>
              <thead><tr>
                <th style={S.th}>Name</th>
                <th style={S.th}>Email</th>
                <th style={S.th}>Role</th>
                <th style={S.th}>Status</th>
                <th style={S.th}>Created</th>
                <th style={{...S.th,textAlign:'center'}}>Actions</th>
              </tr></thead>
              <tbody>
                {users.map((u,i)=>(
                  <tr key={u.id} style={{background:i%2===0?'transparent':C.rowAlt}}>
                    <td style={{...S.td,color:C.text,fontSize:13}}>{u.username}</td>
                    <td style={S.td}>
                      <span style={{...S.pill(u.role==='admin'?C.purple:C.teal,(u.role==='admin'?C.purple:C.teal)+'22'),fontSize:11}}>
                        {u.role==='admin'?'👑 Admin':'👤 User'}
                      </span>
                    </td>
                    <td style={S.td}>
                      <span style={{...S.pill(u.active?C.teal:C.muted,(u.active?C.teal:C.muted)+'22'),fontSize:11}}>
                        {u.active?'✅ Active':'⛔ Inactive'}
                      </span>
                    </td>
                    <td style={{...S.td,fontSize:12,color:C.muted}}>{u.createdAt?.slice(0,10)||'—'}</td>
                    <td style={{...S.td,textAlign:'center'}}>
                      <div style={{display:'flex',gap:6,justifyContent:'center'}}>
                        <button onClick={()=>openEdit(u)} style={{...S.btnSm,fontSize:11,padding:'4px 10px'}}>✏️ Edit</button>
                        {u.username!==authUser.username&&(
                          <button onClick={()=>handleDelete(u)} style={{...S.btnSm,fontSize:11,padding:'4px 10px',color:'#ef4444',borderColor:'#ef4444'}}>🗑️ Delete</button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <div style={{marginTop:12,fontSize:12,color:C.muted}}>
        💡 Company access (org_id) is managed in Oracle EBS via the XXACG_AR_DASHBOARD lookup type.
      </div>
    </div>
  );
}

export default function App() {
  const [dark,        setDark]        = useState(true);
  const [authUser,    setAuthUser]    = useState(()=>{
    // Check for reset password token in URL
    const params = new URLSearchParams(window.location.search);
    if(params.get('token')) return null;
    // Restore session from sessionStorage
    const tok = getToken();
    if(!tok) return null;
    try {
      const payload = JSON.parse(atob(tok.split('.')[1]));
      if(payload.exp * 1000 < Date.now()) { clearToken(); return null; }
      return payload;
    } catch { clearToken(); return null; }
  });

  // Wire global 401 handler to clear auth state without page reload
  useEffect(()=>{ set401Handler(()=>setAuthUser(null)); },[]); 
  const [screen,      setScreen]      = useState('init');
  const [loadMsg,     setLoadMsg]     = useState('');
  const [errMsg,      setErrMsg]      = useState('');
  const [countries,   setCountries]   = useState([]);
  const [companies,   setCompanies]   = useState([]);
  const [selBgId,     setSelBgId]     = useState('');
  const [selOrgId,    setSelOrgId]    = useState('0');
  const [currency,    setCurrency]    = useState('');
  const [ouLoading,   setOuLoading]   = useState(false);
  const [data,        setData]        = useState(null);
  const [drill,       setDrill]       = useState(null);
  const [custInfo,    setCustInfo]    = useState(null);
  const [custInfoLoading,setCustInfoLoading]=useState(false);
  const [tab,         setTab]         = useState('overview');
  const [catFil,      setCatFil]      = useState('ALL');
  const [agingView,   setAgingView]   = useState('chart');
  const [projSearch,  setProjSearch]  = useState('');
  const [projStatusFilter, setProjStatusFilter] = useState('ALL');
  const [agingSearch, setAgingSearch] = useState('');
  const [custSearch,  setCustSearch]  = useState('');
  const [chatMessages,setChatMessages]= useState([]);
  const [chatInput,   setChatInput]   = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [chatProvider,setChatProvider]= useState('claude');   // 'claude' | 'gemini'
  const [geminiKey,   setGeminiKey]   = useState('');
  const [customerProfiles,setCustomerProfiles]=useState({}); // { custNo: info }
  const [profilesLoading,setProfilesLoading]=useState(false);
  const [projectDetails,setProjectDetails]=useState({});     // { projectNo: info }
  const [projDetailsLoading,setProjDetailsLoading]=useState(false);
  const [projInfo,     setProjInfo]     = useState(null);
  const [projInfoLoading,setProjInfoLoading]=useState(false);
  const chatEndRef = useRef(null);

  const C = dark ? DARK : LIGHT;
  const S = makeS(C);

  // ── Auth routing — check for reset token in URL ───────────────────────────
  const resetToken = new URLSearchParams(window.location.search).get('token');

  // All hooks must be called before any conditional return
  // We use authUser state to conditionally render login vs dashboard
  // (React requires all hooks to be called unconditionally)

  const initDone = useRef(false);

  useEffect(()=>{
    if(!authUser) return; // Don't initialize until user is logged in
    if(initDone.current) return; // Only run once per session
    initDone.current = true;
    (async()=>{
      setScreen('init'); setLoadMsg('Connecting to Oracle…');
      try {
        await apiGet('/api/ping');
        setLoadMsg('Loading countries…');
        const bgs=await apiGet('/api/business-groups');
        if(!Array.isArray(bgs)||bgs.length===0){setScreen('slicer');return;}
        setCountries(bgs);
        if(bgs.length>0){setSelBgId(String(bgs[0].business_group_id));setCurrency(bgs[0].currency_code||'');}
        // Load AI config (Gemini key from .env via server)
        try {
          const cfg=await apiGet('/api/config');
          if(cfg.geminiApiKey) setGeminiKey(cfg.geminiApiKey);
        } catch(_){/* non-fatal */}
        setScreen('slicer');
      } catch(e){setErrMsg(e.message||'Failed to connect.');setScreen('error');}
    })();
  },[authUser]);

  useEffect(()=>{
    if(!selBgId||screen!=='slicer') return;
    const bg=countries.find(c=>String(c.business_group_id)===selBgId);
    if(bg) setCurrency(bg.currency_code||'');
    setSelOrgId('0'); setCompanies([]); setOuLoading(true);
    apiGet(`/api/operating-units?bgId=${selBgId}`)
      .then(r=>setCompanies(r)).catch(()=>setCompanies([]))
      .finally(()=>setOuLoading(false));
  },[selBgId,screen,countries]);

  const loadDashboard=useCallback(async(bgId,orgId)=>{
    setScreen('loading'); setErrMsg('');
    try {
      setLoadMsg('Running dashboard queries…');
      const raw=await apiGet(`/api/dashboard?bgId=${bgId}&orgId=${orgId}`);
      const processed=processData(raw);
      setData(processed); setTab('overview'); setCatFil('ALL');
      setCustomerProfiles({}); // reset profiles when dashboard reloads
      setProjectDetails({});   // reset project details when dashboard reloads
      setScreen('dashboard');
      // Fetch all customer profiles in background (batches of 5)
      const custNos=(processed.customerBalance||[]).map(r=>r.customer_number).filter(Boolean);
      if(custNos.length>0){
        setProfilesLoading(true);
        const BATCH=5;
        const profiles={};
        for(let i=0;i<custNos.length;i+=BATCH){
          const batch=custNos.slice(i,i+BATCH);
          const results=await Promise.allSettled(batch.map(custNo=>apiPost('/api/customer-info',{custNo})));
          results.forEach((res,j)=>{
            if(res.status==='fulfilled'&&res.value) profiles[batch[j]]=res.value;
          });
          setCustomerProfiles(p=>({...p,...profiles}));
        }
        setProfilesLoading(false);
      }
      // Fetch all project details in background (batches of 3)
      const projNos=(processed.projectBalance||[]).map(r=>r.project_no).filter(Boolean);
      if(projNos.length>0){
        setProjDetailsLoading(true);
        const PBATCH=3;
        const details={};
        for(let i=0;i<projNos.length;i+=PBATCH){
          const batch=projNos.slice(i,i+PBATCH);
          const results=await Promise.allSettled(batch.map(projectNo=>apiPost('/api/project-info',{projectNo})));
          results.forEach((res,j)=>{
            if(res.status==='fulfilled'&&res.value) details[batch[j]]=res.value;
          });
          setProjectDetails(p=>({...p,...details}));
        }
        setProjDetailsLoading(false);
      }
    } catch(e){setErrMsg(e.message||'Query failed.');setScreen('error');}
  },[]);

  const handleDrill=useCallback(async(custNo,custName)=>{
    setLoadMsg(`Loading transactions for ${custName}…`); setScreen('loading');
    try {
      const rows=await apiPost('/api/customer-detail',{custNo,bgId:Number(selBgId),orgId:Number(selOrgId)});
      setDrill({custNo,custName,rows}); setScreen('drill');
    } catch(e){setErrMsg(e.message||'Failed to load transactions.');setScreen('error');}
  },[selBgId,selOrgId]);

  const handleCustInfo=useCallback(async(custNo)=>{
    if(!custNo){alert('No account number available for this customer.');return;}
    setCustInfoLoading(true);
    try {
      const info=await apiPost('/api/customer-info',{custNo});
      if(info) setCustInfo(info);
      else alert('No customer profile found for account: '+custNo);
    } catch(e){
      console.error('CustomerInfo error:',e);
      alert('Could not load customer info: '+e.message);
    } finally{
      setCustInfoLoading(false);
    }
  },[]);

  const handleProjInfo=useCallback(async(projectNo)=>{
    if(!projectNo){return;}
    setProjInfoLoading(true);
    try {
      const info=await apiPost('/api/project-info',{projectNo});
      if(info) setProjInfo(info);
      else alert('No project info found for: '+projectNo);
    } catch(e){
      console.error('ProjectInfo error:',e);
      alert('Could not load project info: '+e.message);
    } finally{
      setProjInfoLoading(false);
    }
  },[]);

  // Auto-scroll chat to bottom
  useEffect(()=>{
    chatEndRef.current?.scrollIntoView({behavior:'smooth'});
  },[chatMessages]);

  const sendChat=useCallback(async(question)=>{
    if(!question.trim()||chatLoading) return;
    if(chatProvider==='gemini'&&!geminiKey.trim()){
      setChatMessages(prev=>[...prev,
        {role:'user',content:question.trim()},
        {role:'assistant',content:'⚠️ Gemini API key is not configured. Please add GEMINI_API_KEY to your server .env file and restart.'},
      ]);
      setChatInput('');
      return;
    }
    const userMsg={role:'user',content:question.trim()};
    const newHistory=[...chatMessages,userMsg];
    setChatMessages(newHistory);
    setChatInput('');
    setChatLoading(true);
    try {
      // Build shared context block
      const profilesCtx=Object.keys(customerProfiles).length>0?`
Customer Profiles (tax registration, email, credit limit):
${Object.entries(customerProfiles).map(([custNo,p])=>{
  const emails=(p.emails||[]).join(', ')||'—';
  const taxReg=p.registration_number||'—';
  const creditLimit=p.credit_limit!=null?Number(p.credit_limit).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})+' '+currency:'—';
  const creditHold=p.credit_hold==='Y'?'YES':'No';
  return `[${custNo}] ${p.party_name||''}: Tax Reg: ${taxReg} | Email: ${emails} | Credit Limit: ${creditLimit} | Credit Hold: ${creditHold}`;
}).join('\n')}`:'(Customer profiles still loading in background…)';

      const ctx=data?`
Current AR Dashboard Context:
- Country/Business Group: ${selCountryName}
- Company: ${selCompanyName}
- Reporting Currency: ${currency||'N/A'}
- Total Outstanding: ${data.totalOS?.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})} ${currency}
- Overdue Balance: ${data.overdueOS?.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})} ${currency}
- Number of Customers: ${data.customerBalance?.length||0}
- Number of Projects: ${data.projectBalance?.length||0}

All Customers (account number, name, category, outstanding, open invoices):
${(data.customerBalance||[]).map((r,i)=>`${i+1}. [${r.customer_number}] ${r.customer_name} (${r.category||'UNCLASSIFIED'}): ${Number(r.func_outstanding).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})} ${currency} — ${r.trx_count} open invoices`).join('\n')}

Customer Aging Breakdown (per customer, all buckets):
${(data.agingTable||[]).map(r=>{
  const buckets=['Current','1-30 days','31-60 days','61-90 days','91-180 days','181-365 days','365+ days'];
  const parts=buckets.filter(b=>r[b]).map(b=>`${b}: ${Number(r[b]).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}`);
  return `[${r.account_number}] ${r.customer_name}: ${parts.join(' | ')||'no outstanding'}`;
}).join('\n')}

${profilesCtx}

Aging Bucket Summary (totals):
${(data.bucketPie||[]).map(b=>`- ${b.name}: ${b.value.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})} ${currency}`).join('\n')}

Customer Category Breakdown:
${(data.catPie||[]).map(c=>`- ${c.name}: ${c.value.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})} ${currency}`).join('\n')}

All Projects (project no, name, status, outstanding):
${(data.projectBalance||[]).map((r,i)=>`${i+1}. [${r.project_no}] ${r.project_name} (${r.project_status}): ${Number(r.func_outstanding).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})} ${currency}`).join('\n')}

Project Details (type, dates, value, linked projects):
${Object.keys(projectDetails).length>0
  ? Object.entries(projectDetails).map(([projNo,p])=>{
      const val=p.project_value!=null?Number(p.project_value).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})+' '+currency:'—';
      const links=(p.linked_projects||[]).map(l=>`${l.linked_project_no} ${l.linked_project_name}`).join(', ')||'none';
      return `[${projNo}] ${p.project_name}: Type: ${p.project_type||'—'} | Start: ${p.start_date||'—'} | Completion: ${p.completion_date||'—'} | Main Project: ${p.main_project||'—'} | Value: ${val} | Linked: ${links}`;
    }).join('\n')
  : projDetailsLoading?'(Project details still loading in background…)':'(No project details loaded)'
}`:'No dashboard data loaded yet. Ask the user to load a dashboard first.';

      const systemPrompt=`You are an expert AR (Accounts Receivable) analyst assistant embedded in an Oracle EBS AR Dashboard. 
Answer questions about the current AR data concisely and helpfully. Provide actionable insights when possible.
Format numbers with commas and 2 decimal places. Use bullet points for lists. Be concise.

${ctx}`;

      let assistantText='';

      if(chatProvider==='claude'){
        // ── Claude via Anthropic API ──────────────────────────────────────────
        const response=await fetch('https://api.anthropic.com/v1/messages',{
          method:'POST',
          headers:{'Content-Type':'application/json'},
          body:JSON.stringify({
            model:'claude-sonnet-4-6',
            max_tokens:1000,
            system:systemPrompt,
            messages:newHistory.map(m=>({role:m.role,content:m.content})),
          }),
        });
        const result=await response.json();
        if(!response.ok) throw new Error(result.error?.message||`Claude API error ${response.status}`);
        assistantText=result.content?.find(b=>b.type==='text')?.text||'No response received.';

      } else {
        // ── Gemini via Google Generative Language API ─────────────────────────
        // Convert history to Gemini format (role: 'user'|'model')
        const geminiContents=newHistory.map(m=>({
          role: m.role==='assistant'?'model':'user',
          parts:[{text:m.content}],
        }));
        // Prepend system instruction as first user turn if Gemini doesn't support systemInstruction
        const geminiBody={
          system_instruction:{parts:[{text:systemPrompt}]},
          contents:geminiContents,
          generationConfig:{maxOutputTokens:1000,temperature:0.4},
        };
        const gModel='gemini-2.5-flash';
        const gUrl=`https://generativelanguage.googleapis.com/v1beta/models/${gModel}:generateContent`;
        const gResp=await fetch(gUrl,{
          method:'POST',
          headers:{'Content-Type':'application/json','x-goog-api-key':geminiKey.trim()},
          body:JSON.stringify(geminiBody),
        });
        const gResult=await gResp.json();
        if(!gResp.ok){
          const errMsg=gResult?.error?.message||`Gemini API error ${gResp.status}`;
          throw new Error(errMsg);
        }
        assistantText=gResult?.candidates?.[0]?.content?.parts?.[0]?.text||'No response from Gemini.';
      }

      setChatMessages(prev=>[...prev,{role:'assistant',content:assistantText}]);
    } catch(e){
      setChatMessages(prev=>[...prev,{role:'assistant',content:`⚠️ Error: ${e.message}`}]);
    } finally{
      setChatLoading(false);
    }
  },[chatMessages,chatLoading,data,currency,chatProvider,geminiKey]);

  const selCountryName=countries.find(c=>String(c.business_group_id)===selBgId)?.bg_name||`BG ${selBgId}`;
  const selCompanyName=selOrgId==='0'?'All companies':(companies.find(c=>String(c.org_id)===selOrgId)?.ou_name||`OU ${selOrgId}`);

  // Define modal here so it's available on ALL screens (dashboard, drill, etc.)
  const CustInfoModal=custInfo?<CustomerInfoModal info={custInfo} onClose={()=>setCustInfo(null)} C={C} S={S}/>:null;
  const ProjInfoModal=projInfo?<ProjectInfoModal info={projInfo} onClose={()=>setProjInfo(null)} C={C} S={S} currency={currency}/>:null;

  const Header=({right,noTabs})=>(
    <div style={{position:'sticky',top:0,zIndex:30,background:C.surface,borderBottom:`1px solid ${C.border}`,boxShadow:'0 1px 4px rgba(0,0,0,0.07)'}}>
      {/* Top row */}
      <div style={{padding:'0 12px',display:'flex',alignItems:'center',gap:8,height:48}}>
        <div style={S.logo}>AR</div>
        <div style={{flex:1,minWidth:0}}>
          <span style={{fontWeight:700,fontSize:14,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',display:'block'}}>AR Balance Dashboard</span>
          <span style={{fontSize:11,color:C.muted,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',display:'block'}}>{selCountryName} · {selCompanyName}</span>
        </div>
        {currency&&<span style={S.ccyBadge}>{currency}</span>}
        {right||<>
          <button style={S.btnSm} onClick={()=>loadDashboard(selBgId,selOrgId)} title="Refresh">↺</button>
          <ThemeToggle dark={dark} onToggle={()=>setDark(d=>!d)} C={C} S={S}/>
          <button style={S.btnSm} onClick={()=>setScreen('slicer')} title="Change filter">⟵</button>
          <div style={{display:'flex',alignItems:'center',gap:6,padding:'0 4px',borderLeft:`1px solid ${C.border}`,marginLeft:4}}>
            <span style={{fontSize:12,color:C.muted,maxWidth:160,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{authUser?.username||authUser?.email||authUser?.name}</span>
            <button title="Sign out" onClick={()=>{clearToken();setAuthUser(null);}} style={{...S.btnSm,padding:'4px 8px',fontSize:12,color:C.coral||'#ef4444',borderColor:C.coral||'#ef4444'}}>⏻</button>
          </div>
        </>}
      </div>
      {/* Tab row — scrollable, hidden on drill screen */}
      {!noTabs&&<div style={{display:'flex',overflowX:'auto',WebkitOverflowScrolling:'touch',borderTop:`1px solid ${C.border}`,scrollbarWidth:'none',msOverflowStyle:'none'}}>
        <style>{`.tab-scroll::-webkit-scrollbar{display:none}`}</style>
        {['overview','customers','projects','aging','chat'].map(t=>(
          <button key={t} onClick={()=>{setTab(t);setProjSearch('');setProjStatusFilter('ALL');setAgingSearch('');setCustSearch('');}}
            style={{flexShrink:0,padding:'0 14px',height:40,border:'none',background:'none',cursor:'pointer',
              fontSize:13,fontWeight:tab===t?600:400,
              color:tab===t?C.accent:C.muted,
              borderBottom:tab===t?`2px solid ${C.accent}`:'2px solid transparent',
              whiteSpace:'nowrap'}}>
            {t==='chat'?'💬 Chat':t==='overview'?'📊 Overview':t==='customers'?'👥 Customers':t==='projects'?'🏗️ Projects':'📅 Aging'}
          </button>
        ))}
        {authUser?.role==='admin'&&(
          <button onClick={()=>setTab('users')}
            style={{flexShrink:0,padding:'0 14px',height:40,border:'none',background:'none',cursor:'pointer',
              fontSize:13,fontWeight:tab==='users'?600:400,
              color:tab==='users'?C.purple:C.muted,
              borderBottom:tab==='users'?`2px solid ${C.purple}`:'2px solid transparent',
              whiteSpace:'nowrap'}}>
            👑 Users
          </button>
        )}
      </div>}
    </div>
  );

  // ── Auth routing — safe to do here after all hooks ───────────────────────
  if(resetToken) return <ResetPasswordScreen token={resetToken} dark={dark}/>;
  if(!authUser)  return <LoginScreen onLogin={(user)=>setAuthUser(user)} dark={dark}/>;

  if(screen==='init'||screen==='loading') return <Spinner msg={loadMsg} C={C}/>;

  if(screen==='error') return (
    <div style={{...S.root,display:'flex',alignItems:'center',justifyContent:'center'}}>
      {CustInfoModal}
      {ProjInfoModal}
      <div style={{...S.card,maxWidth:480,width:'90vw',textAlign:'center'}}>
        <div style={{fontSize:36,marginBottom:12}}>⚠</div>
        <div style={{fontSize:16,fontWeight:600,marginBottom:10,color:C.text}}>Error</div>
        <div style={{fontSize:13,color:C.coral,marginBottom:20,lineHeight:1.6,background:C.coralSoft,borderRadius:8,padding:'10px 14px'}}>{errMsg}</div>
        <div style={{fontSize:12,color:C.muted,marginBottom:20,lineHeight:1.7}}>
          Make sure <code style={{color:C.accent}}>node server.js</code> is running and your <code style={{color:C.accent}}>.env</code> has the correct Oracle credentials.
        </div>
        <div style={{display:'flex',gap:10,justifyContent:'center',alignItems:'center'}}>
          <button onClick={()=>setScreen('slicer')} style={{...S.btnSm,color:C.accent,borderColor:C.accent,padding:'10px 28px',fontSize:14}}>← Back</button>
          <ThemeToggle dark={dark} onToggle={()=>setDark(d=>!d)} C={C} S={S}/>
        </div>
      </div>
    </div>
  );

  if(screen==='slicer') return (
    <div style={{...S.root,minHeight:'100vh',display:'flex',flexDirection:'column'}}>
      {CustInfoModal}
      {ProjInfoModal}
      {custInfoLoading&&<div style={{position:'fixed',top:0,left:0,right:0,height:3,background:C.accent,zIndex:999}}/>}
      <div style={{background:C.surface,borderBottom:`1px solid ${C.border}`,padding:'0 40px',height:56,display:'flex',alignItems:'center',justifyContent:'space-between',flexShrink:0}}>
        <div style={{display:'flex',alignItems:'center',gap:12}}>
          <div style={S.logo}>AR</div>
          <span style={{fontWeight:700,fontSize:15,color:C.text}}>AR Balance Dashboard</span>
        </div>
        <ThemeToggle dark={dark} onToggle={()=>setDark(d=>!d)} C={C} S={S}/>
      </div>
      <div style={{flex:1,display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(300px,1fr))',minHeight:'calc(100vh - 56px)'}}>
        <div style={{background:`linear-gradient(145deg, ${C.accent} 0%, ${C.teal} 100%)`,display:'flex',flexDirection:'column',justifyContent:'center',padding:'32px 24px',position:'relative',overflow:'hidden'}}>
          <div style={{position:'absolute',top:-80,right:-80,width:320,height:320,borderRadius:'50%',background:'rgba(255,255,255,0.07)',pointerEvents:'none'}}/>
          <div style={{position:'absolute',bottom:-60,left:-60,width:240,height:240,borderRadius:'50%',background:'rgba(255,255,255,0.05)',pointerEvents:'none'}}/>
          <div style={{position:'relative',zIndex:1,display:'flex',flexDirection:'column',justifyContent:'center',height:'100%'}}>
            <div style={{width:56,height:56,borderRadius:14,background:'rgba(255,255,255,0.2)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:22,fontWeight:800,color:'#fff',marginBottom:32}}>AR</div>
            <div style={{fontSize:42,fontWeight:800,color:'#fff',lineHeight:1.15,marginBottom:20,letterSpacing:'-0.02em'}}>Accounts Receivable Dashboard</div>
            <div style={{fontSize:16,color:'rgba(255,255,255,0.8)',lineHeight:1.8,marginBottom:40,maxWidth:400}}>
            Real-time visibility into customer balances, aging analysis, and transaction drill-down — powered by Oracle EBS.
          </div>
            <div style={{display:'flex',gap:32}}>
              {[{label:'Business Groups',value:countries.length||'—'},{label:'Companies',value:companies.length>0?companies.length:'—'},{label:'Currency',value:currency||'—'}].map((s,i)=>(
                <div key={i}>
                  <div style={{fontSize:26,fontWeight:700,color:'#fff'}}>{s.value}</div>
                  <div style={{fontSize:11,color:'rgba(255,255,255,0.65)',textTransform:'uppercase',letterSpacing:'0.07em',marginTop:2}}>{s.label}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div style={{display:'flex',flexDirection:'column',justifyContent:'center',padding:'32px 24px',background:C.bg}}>
          <div style={{maxWidth:480,width:'100%'}}>
            <div style={{fontSize:24,fontWeight:700,color:C.text,marginBottom:6}}>Select your view</div>
            <div style={{fontSize:14,color:C.muted,marginBottom:48}}>Choose a country and company to load the AR dashboard.</div>
            <div style={{marginBottom:24}}>
              <label style={{display:'flex',alignItems:'center',gap:8,fontSize:12,fontWeight:600,color:C.textSec,textTransform:'uppercase',letterSpacing:'0.07em',marginBottom:10}}>
                Country / Business Group {currency&&<span style={S.ccyBadge}>{currency}</span>}
              </label>
              <select style={{...S.select,width:'100%',padding:'12px 36px 12px 14px',fontSize:14,borderRadius:10}} value={selBgId} onChange={e=>setSelBgId(e.target.value)}>
                {countries.map(c=><option key={c.business_group_id} value={c.business_group_id}>{c.bg_name}{c.currency_code?` (${c.currency_code})`:''}</option>)}
              </select>
              <div style={{fontSize:11,color:C.muted,marginTop:6}}>BG ID: {selBgId} · Reporting currency: <strong style={{color:C.accent}}>{currency||'—'}</strong></div>
            </div>
            <div style={{marginBottom:36}}>
              <label style={{display:'block',fontSize:12,fontWeight:600,color:C.textSec,textTransform:'uppercase',letterSpacing:'0.07em',marginBottom:10}}>Company / Operating Unit</label>
              <select style={{...S.select,width:'100%',padding:'12px 36px 12px 14px',fontSize:14,borderRadius:10,opacity:ouLoading?0.5:1}} value={selOrgId} onChange={e=>setSelOrgId(e.target.value)} disabled={ouLoading}>
                <option value="0">— All companies —</option>
                {companies.map(ou=><option key={ou.org_id} value={ou.org_id}>{ou.ou_name}</option>)}
              </select>
              {ouLoading&&<div style={{fontSize:11,color:C.muted,marginTop:6}}>Loading companies…</div>}
              {!ouLoading&&companies.length>0&&<div style={{fontSize:11,color:C.muted,marginTop:6}}>{companies.length} companies available</div>}
            </div>
            <button onClick={()=>loadDashboard(selBgId,selOrgId)} disabled={!selBgId||ouLoading}
              style={{width:'100%',background:C.accent,color:'#fff',border:'none',borderRadius:10,padding:'14px 0',fontSize:15,fontWeight:700,cursor:'pointer',opacity:(!selBgId||ouLoading)?0.5:1}}>
              Load Dashboard →
            </button>
            {selBgId&&!ouLoading&&(
              <div style={{marginTop:20,padding:'14px 16px',background:C.card,border:`1px solid ${C.border}`,borderRadius:10,fontSize:13,color:C.textSec,lineHeight:1.7,display:'flex',alignItems:'flex-start',gap:10}}>
                <span style={{fontSize:16,marginTop:1}}>📋</span>
                <div>
                  <strong style={{color:C.text}}>Will load: </strong>
                  {selOrgId==='0'?`All ${companies.length} companies under ${selCountryName}`:companies.find(c=>String(c.org_id)===selOrgId)?.ou_name||'selected company'}
                  {currency&&<><br/><span style={{color:C.muted}}>Amounts in </span><strong style={{color:C.accent}}>{currency}</strong></>}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );

  if(screen==='drill'&&drill){
    const totalOut=drill.rows.reduce((s,r)=>s+Number(r.func_outstanding||0),0);
    const overdue =drill.rows.filter(r=>r.aging_bucket!=='Current').reduce((s,r)=>s+Number(r.func_outstanding||0),0);
    return (
      <div style={S.root}>
        {CustInfoModal}
      {ProjInfoModal}
        <Header noTabs right={<button style={S.btnSm} onClick={()=>setScreen('dashboard')}>← Back to dashboard</button>}/>
        <div style={S.main}>
          <div style={{marginBottom:20,display:'flex',alignItems:'center',gap:16}}>
            <div>
              <div style={{fontSize:20,fontWeight:700,color:C.text}}>{drill.custName}</div>
              <div style={{fontSize:13,color:C.muted,marginTop:4}}>Account: {drill.custNo} · {drill.rows.length} open transactions · Amounts in <strong style={{color:C.accent}}>{currency||'functional'}</strong></div>
            </div>
            <button onClick={()=>handleCustInfo(drill.custNo)} disabled={custInfoLoading}
              style={{...S.btnSm,color:C.accent,borderColor:C.accent,marginLeft:'auto',display:'flex',alignItems:'center',gap:6}}>
              {custInfoLoading?'Loading…':'👤 Customer profile'}
            </button>
          </div>
          <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:14,marginBottom:24}}>
            <KPI label={`Total outstanding (${currency})`} value={fmt(totalOut)} C={C} S={S} index={0}/>
            <KPI label="Overdue" value={fmt(overdue)} C={C} S={S} index={1}/>
            <KPI label="Open transactions" value={drill.rows.length} C={C} S={S} index={2}/>
          </div>
          <div style={S.card}>
            <SHead title="All open transactions" sub="Sorted by due date ascending" C={C}/>
            <div style={{overflowX:'auto',WebkitOverflowScrolling:'touch'}}>
              <table style={{width:'100%',borderCollapse:'collapse',minWidth:1040}}>
                <thead><tr>{['Trx number','Class','Trx date','GL date','Due date','Inv ccy','Trx amount','Outstanding','Rate',`${currency||'Func'} OS`,'Days past due','Aging','Project','PO'].map(h=><th key={h} style={S.th}>{h}</th>)}</tr></thead>
                <tbody>
                  {drill.rows.map((r,i)=>{
                    const bc=BUCKET_COLORS[r.aging_bucket]||C.muted;
                    const dpd=Number(r.days_past_due);
                    return (
                      <tr key={i} style={{background:i%2===0?'transparent':C.rowAlt}}>
                        <td style={{...S.td,color:C.accent,fontWeight:500}}>{r.trx_number}</td>
                        <td style={S.td}><span style={S.pill(C.textSec,C.surface)}>{r.class}</span></td>
                        <td style={S.td}>{r.trx_date}</td>
                        <td style={{...S.td,color:C.muted}}>{r.gl_date}</td>
                        <td style={S.td}>{r.due_date}</td>
                        <td style={S.td}>{r.currency}</td>
                        <td style={S.tdR}>{fmtFull(r.trx_amount)}</td>
                        <td style={S.tdR}>{fmtFull(r.outstanding)}</td>
                        <td style={S.tdR}>{Number(r.exchange_rate).toFixed(4)}</td>
                        <td style={{...S.tdR,color:C.amber,fontWeight:600}}>{fmtFull(r.func_outstanding,currency)}</td>
                        <td style={{...S.tdR,color:dpd>0?C.coral:C.teal,fontWeight:500}}>{dpd}</td>
                        <td style={S.td}><span style={{...S.pill(bc,bc+'22'),whiteSpace:'nowrap'}}>{r.aging_bucket}</span></td>
                        <td style={{...S.td,color:C.purple}}>{r.project_no||'—'}</td>
                        <td style={{...S.td,color:C.muted}}>{r.po_number||'—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if(screen!=='dashboard'||!data) return null;
  const {customerBalance,projectBalance,agingTable,catPie,bucketPie,totalOS,overdueOS}=data;
  const catFiltered=catFil==='ALL'?customerBalance:customerBalance.filter(r=>r.category===catFil);
  const top10Cust=catFiltered.slice(0,10);
  const cats=['ALL',...new Set(customerBalance.map(r=>r.category).filter(Boolean))];
  const custQ=custSearch.toLowerCase().trim();
  const filtered=custQ?catFiltered.filter(r=>(r.customer_name||'').toLowerCase().includes(custQ)||(r.customer_number||'').toLowerCase().includes(custQ)):catFiltered;
  const TipC=props=><Tip {...props} ccy={currency} C={C}/>;
  const projQ=projSearch.toLowerCase().trim();
  const activeProjects=projectBalance.filter(r=>!['Cancelled','Closed'].includes(r.project_status));
  const top10Proj=projectBalance.slice(0,10);
  const projStatuses=['ALL',...new Set(projectBalance.map(r=>r.project_status).filter(Boolean))].sort();
  const projStatusFiltered=projStatusFilter==='ALL'?projectBalance:projectBalance.filter(r=>r.project_status===projStatusFilter);
  const filteredProjects=projQ
    ? projStatusFiltered.filter(r=>
        (r.project_no||'').toLowerCase().includes(projQ)||
        (r.project_name||'').toLowerCase().includes(projQ)
      )
    : projStatusFiltered;
  const agingQ=agingSearch.toLowerCase().trim();
  const filteredAging=agingQ?agingTable.filter(r=>(r.customer_name||'').toLowerCase().includes(agingQ)||(r.account_number||'').toLowerCase().includes(agingQ)):agingTable;

  return (
    <div style={S.root}>
      <style>{`
      .dr:hover{background:${C.accentSoft}!important;cursor:pointer}
      .clink{color:${C.accent};cursor:pointer;font-weight:600;text-decoration:none}
      .clink:hover{opacity:0.8}
      *{box-sizing:border-box}
      @media(max-width:600px){
        table{font-size:11px}
        th,td{padding:6px 8px!important}
        .hide-mobile{display:none!important}
        input,select{font-size:14px!important}
      }
      @media(max-width:900px){
        .slicer-label{display:none}
      }
    `}</style>
      {CustInfoModal}
      {ProjInfoModal}
      {custInfoLoading&&<div style={{position:'fixed',top:0,left:0,right:0,height:3,background:C.accent,zIndex:200}}/>}
      {projInfoLoading&&<div style={{position:'fixed',top:0,left:0,right:0,height:3,background:C.teal,zIndex:200}}/>}

      <Header/>

      {/* ── Slicer bar ── */}
      <div style={S.slicerBar}>
        <div style={S.slicerSeg}>
          <span style={S.slicerLabel}>Country</span>
          <select style={{...S.select,minWidth:200,border:'none',background:'transparent',fontWeight:600,color:C.text,fontSize:13}} value={selBgId}
            onChange={e=>{setSelBgId(e.target.value);setSelOrgId('0');setScreen('slicer');}}>
            {countries.map(c=><option key={c.business_group_id} value={c.business_group_id}>{c.bg_name}{c.currency_code?` (${c.currency_code})`:''}</option>)}
          </select>
        </div>
        <div style={S.slicerSeg}>
          <span style={S.slicerLabel}>Company</span>
          <select style={{...S.select,minWidth:220,border:'none',background:'transparent',fontWeight:600,color:C.text,fontSize:13}} value={selOrgId}
            onChange={e=>{setSelOrgId(e.target.value);loadDashboard(selBgId,e.target.value);}}>
            <option value="0">— All companies —</option>
            {companies.map(ou=><option key={ou.org_id} value={ou.org_id}>{ou.ou_name}</option>)}
          </select>
        </div>
        <div style={{...S.slicerSeg,borderRight:'none'}}>
          <span style={S.slicerLabel}>Currency</span>
          <span style={{...S.ccyBadge,fontSize:13}}>{currency||'—'}</span>
        </div>
        <div style={{marginLeft:'auto',display:'flex',alignItems:'center',padding:'0 20px',fontSize:12,color:C.muted,gap:16}}>
          <span>{customerBalance.length} customers</span>
          <span style={{color:C.border}}>·</span>
          <span>{projectBalance.length} projects</span>
        </div>
      </div>

      <div style={S.main}>

        {/* ══ OVERVIEW ══ */}
        {tab==='overview'&&<>
          <div style={S.grid4}>
            <KPI label={`Total outstanding (${currency})`} value={fmt(totalOS,currency)} sub={`${customerBalance.length} customers`} C={C} S={S} index={0}/>
            <KPI label="Overdue balance" value={fmt(overdueOS,currency)} sub={totalOS>0?`${Math.round(overdueOS/totalOS*100)}% of total`:''} C={C} S={S} index={1}/>
            <KPI label={`Current — not due (${currency})`} value={fmt(totalOS-overdueOS,currency)} C={C} S={S} index={2}/>
            <KPI label="Active projects" value={activeProjects.length} sub="with open AR" C={C} S={S} index={3}/>
          </div>
          <div style={S.grid2}>
            {/* Donut 1 — category */}
            <div style={S.card}>
              <SHead title={`Outstanding by customer category (${currency})`} C={C}/>
              <div style={{display:'flex',alignItems:'center',gap:24}}>
                <div style={{position:'relative',width:260,height:260,flexShrink:0}}>
                  <ResponsiveContainer width="100%" height={260}>
                    <PieChart>
                      <Pie data={catPie} cx="50%" cy="50%" innerRadius={85} outerRadius={118} dataKey="value" nameKey="name" paddingAngle={2}>
                        {catPie.map((_,i)=><Cell key={i} fill={CAT_COLORS[i%CAT_COLORS.length]}/>)}
                      </Pie>
                      <Tooltip content={<TipC/>}/>
                    </PieChart>
                  </ResponsiveContainer>
                  <div style={{position:'absolute',inset:0,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',pointerEvents:'none'}}>
                    <span style={{fontSize:11,color:C.muted,textTransform:'uppercase',letterSpacing:'0.06em'}}>Total</span>
                    <span style={{fontSize:17,fontWeight:700,color:C.text}}>{fmt(totalOS)}</span>
                  </div>
                </div>
                <div style={{flex:1,display:'flex',flexDirection:'column',gap:8,overflowY:'auto',maxHeight:260}}>
                  {catPie.map((d,i)=>{
                    const pct=totalOS>0?Math.round(d.value/totalOS*100):0;
                    return (
                      <div key={i} style={{display:'flex',alignItems:'center',gap:8,fontSize:12}}>
                        <span style={{width:10,height:10,borderRadius:2,background:CAT_COLORS[i%CAT_COLORS.length],flexShrink:0}}/>
                        <span style={{flex:1,color:C.textSec,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{d.name}</span>
                        <span style={{color:C.text,fontWeight:600,whiteSpace:'nowrap'}}>{pct}%</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
            {/* Donut 2 — aging */}
            <div style={S.card}>
              <SHead title="Aging bucket distribution" C={C}/>
              <div style={{display:'flex',alignItems:'center',gap:24}}>
                <div style={{position:'relative',width:260,height:260,flexShrink:0}}>
                  <ResponsiveContainer width="100%" height={260}>
                    <PieChart>
                      <Pie data={bucketPie} cx="50%" cy="50%" innerRadius={85} outerRadius={118} dataKey="value" nameKey="name" paddingAngle={2}>
                        {bucketPie.map((e,i)=><Cell key={i} fill={BUCKET_COLORS[e.name]||C.muted}/>)}
                      </Pie>
                      <Tooltip content={<TipC/>}/>
                    </PieChart>
                  </ResponsiveContainer>
                  <div style={{position:'absolute',inset:0,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',pointerEvents:'none'}}>
                    <span style={{fontSize:11,color:C.muted,textTransform:'uppercase',letterSpacing:'0.06em'}}>Overdue</span>
                    <span style={{fontSize:17,fontWeight:700,color:C.coral}}>{fmt(overdueOS)}</span>
                  </div>
                </div>
                <div style={{flex:1,display:'flex',flexDirection:'column',gap:8}}>
                  {bucketPie.map((d,i)=>{
                    const pct=totalOS>0?Math.round(d.value/totalOS*100):0;
                    return (
                      <div key={i} style={{display:'flex',alignItems:'center',gap:8,fontSize:12}}>
                        <span style={{width:10,height:10,borderRadius:2,background:BUCKET_COLORS[d.name]||C.muted,flexShrink:0}}/>
                        <span style={{flex:1,color:C.textSec,whiteSpace:'nowrap'}}>{d.name}</span>
                        <span style={{color:C.text,fontWeight:600,whiteSpace:'nowrap'}}>{pct}%</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </>}

        {/* ══ CUSTOMERS ══ */}
        {tab==='customers'&&<>
          <div style={{display:'flex',gap:8,marginBottom:16,flexWrap:'wrap'}}>
            {cats.map(c=><FPill key={c} label={c} active={catFil===c} onClick={()=>setCatFil(c)} C={C} S={S}/>)}
          </div>
          <div style={{display:'flex',flexDirection:'column',gap:16,marginBottom:20}}>
            <div style={S.card}>
              <SHead title={`Top 10 customers${catFil!=='ALL'?` — ${catFil}`:''} — ${currency} outstanding`} sub="Click bar to see transactions" C={C}/>
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={top10Cust} layout="vertical" margin={{left:190,right:40,top:4,bottom:4}}
                  onClick={e=>e?.activePayload&&handleDrill(e.activePayload[0].payload.customer_number,e.activePayload[0].payload.customer_name)}>
                  <CartesianGrid strokeDasharray="3 3" stroke={C.border} horizontal={false}/>
                  <XAxis type="number" tickFormatter={v=>fmt(v)} tick={{fill:C.muted,fontSize:11}} axisLine={false} tickLine={false}/>
                  <YAxis type="category" dataKey="customer_name" width={185} tick={{fill:C.textSec,fontSize:11}} axisLine={false} tickLine={false} tickFormatter={v=>v.length>32?v.slice(0,32)+'…':v}/>
                  <Tooltip content={<TipC/>} cursor={{fill:C.accentSoft}}/>
                  <Bar dataKey="func_outstanding" fill={C.accent} radius={[0,5,5,0]} name={`Outstanding (${currency})`}/>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div style={S.card}>
              <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'16px 20px 8px'}}>
                <div>
                  <div style={{fontWeight:700,fontSize:15,color:C.text}}>{`All customers${catFil!=='ALL'?` — ${catFil}`:''}`}</div>
                  <div style={{fontSize:12,color:C.muted,marginTop:2}}>{filtered.length!==customerBalance.length?`${filtered.length} of ${customerBalance.length} customers`:`${customerBalance.length} customers · Click name for profile · click row for transactions`}</div>
                </div>
                <button style={{...S.btnSm,display:'flex',alignItems:'center',gap:6}} onClick={()=>exportToExcel(filtered,[
                  {key:'customer_number',label:'Account No'},
                  {key:'customer_name',label:'Customer Name'},
                  {key:'category',label:'Category'},
                  {key:'func_outstanding',label:`${currency} Outstanding`},
                  {key:'trx_count',label:'Transactions'},
                ],`customers_${selCountryName}_${new Date().toISOString().slice(0,10)}.csv`)}>
                  📥 Export
                </button>
              </div>
              <div style={{padding:'4px 16px 8px'}}>
                <input type="text" placeholder="Search customer name or account number…" value={custSearch} onChange={e=>setCustSearch(e.target.value)} style={{...S.searchBox}}/>
              </div>
              <div style={{overflowX:'auto',WebkitOverflowScrolling:'touch'}}>
                <table style={{width:'100%',borderCollapse:'collapse',minWidth:700}}>
                  <thead style={{position:'sticky',top:0,zIndex:1}}><tr>
                    <th style={{...S.th,width:90}}>Account No</th>
                    <th style={S.th}>Customer</th>
                    <th style={{...S.th,width:200}}>Category</th>
                    <th style={{...S.th,textAlign:'right',width:160}}>{currency} Outstanding</th>
                    <th style={{...S.th,textAlign:'right',width:60}}>Trx</th>
                  </tr></thead>
                  <tbody>
                    {filtered.length===0&&<tr><td colSpan={5} style={{...S.td,textAlign:'center',color:C.muted,padding:'24px'}}>No customers match "{custSearch}"</td></tr>}
                    {filtered.map((r,i)=>(
                      <tr key={i} style={{background:i%2===0?'transparent':C.rowAlt}}>
                        <td style={{...S.td,color:C.muted,fontSize:12,width:90,whiteSpace:'nowrap'}} onClick={()=>handleDrill(r.customer_number,r.customer_name)}>{r.customer_number}</td>
                        <td style={{...S.td,cursor:'pointer'}} onClick={()=>handleCustInfo(r.customer_number)}>
                          <span className="clink" title="Click to view customer profile">{r.customer_name}</span>
                        </td>
                        <td style={{...S.td,cursor:'pointer',fontSize:12}} onClick={()=>handleDrill(r.customer_number,r.customer_name)}><span style={S.pill(C.textSec,C.surface)}>{r.category||'—'}</span></td>
                        <td style={{...S.tdR,color:C.amber,fontWeight:600,cursor:'pointer',whiteSpace:'nowrap'}} onClick={()=>handleDrill(r.customer_number,r.customer_name)}>{fmtFull(r.func_outstanding)}</td>
                        <td style={{...S.tdR,cursor:'pointer',width:60}} onClick={()=>handleDrill(r.customer_number,r.customer_name)}>{r.trx_count}</td>
                      </tr>
                    ))}
                  </tbody>
                  {filtered.length>0&&<tfoot>
                    <tr style={{borderTop:`2px solid ${C.border}`,background:C.surface}}>
                      <td style={{...S.td,fontWeight:700,color:C.text}} colSpan={2}>Total ({filtered.length} customers)</td>
                      <td style={S.td}/>
                      <td style={{...S.tdR,fontWeight:700,color:C.amber,whiteSpace:'nowrap'}}>{fmtFull(filtered.reduce((s,r)=>s+Number(r.func_outstanding||0),0))}</td>
                      <td style={{...S.tdR,fontWeight:700,color:C.text}}>{filtered.reduce((s,r)=>s+Number(r.trx_count||0),0)}</td>
                    </tr>
                  </tfoot>}
                </table>
              </div>
            </div>
          </div>
        </>}

        {/* ══ PROJECTS ══ */}
        {tab==='projects'&&(
          <div style={{display:'flex',flexDirection:'column',gap:16,marginBottom:20}}>
            <div style={S.card}>
              <SHead title={`Top 10 projects — ${currency} outstanding`} C={C}/>
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={top10Proj} layout="vertical" margin={{left:200,right:40,top:4,bottom:4}}>
                  <CartesianGrid strokeDasharray="3 3" stroke={C.border} horizontal={false}/>
                  <XAxis type="number" tickFormatter={v=>fmt(v)} tick={{fill:C.muted,fontSize:11}} axisLine={false} tickLine={false}/>
                  <YAxis type="category" dataKey="project_name" width={195} tick={{fill:C.textSec,fontSize:11}} axisLine={false} tickLine={false} tickFormatter={v=>v.length>32?v.slice(0,32)+'…':v}/>
                  <Tooltip content={<TipC/>} cursor={{fill:C.tealSoft}}/>
                  <Bar dataKey="func_outstanding" fill={C.teal} radius={[0,5,5,0]} name={`Outstanding (${currency})`}/>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div style={S.card}>
              <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'16px 20px 8px'}}>
                <div>
                  <div style={{fontWeight:700,fontSize:15,color:C.text}}>All projects</div>
                  <div style={{fontSize:12,color:C.muted,marginTop:2}}>{filteredProjects.length!==projectBalance.length?`${filteredProjects.length} of ${projectBalance.length} projects`:`${projectBalance.length} projects`}</div>
                </div>
                <button style={{...S.btnSm,display:'flex',alignItems:'center',gap:6}} onClick={()=>exportToExcel(filteredProjects,[
                  {key:'project_no',label:'Project No'},
                  {key:'project_name',label:'Project Name'},
                  {key:'project_status',label:'Status'},
                  {key:'customer_name',label:'Customer Name'},
                  {key:'func_outstanding',label:`${currency} Outstanding`},
                  {key:'customer_count',label:'Customers'},
                ],`projects_${selCountryName}_${new Date().toISOString().slice(0,10)}.csv`)}>
                  📥 Export
                </button>
              </div>
              <div style={{display:'flex',gap:10,marginBottom:12,alignItems:'center',padding:'0 16px'}}>
                <div style={{position:'relative',flex:1}}>
                  <span style={{position:'absolute',left:10,top:'50%',transform:'translateY(-50%)',color:C.muted,fontSize:14,pointerEvents:'none'}}>🔍</span>
                  <input type="text" placeholder="Search project # or name…" value={projSearch} onChange={e=>setProjSearch(e.target.value)} style={{...S.searchBox}}/>
                  {projSearch&&<button onClick={()=>setProjSearch('')} style={{position:'absolute',right:10,top:'50%',transform:'translateY(-50%)',background:'none',border:'none',color:C.muted,cursor:'pointer',fontSize:16,lineHeight:1}}>✕</button>}
                </div>
                <select value={projStatusFilter} onChange={e=>setProjStatusFilter(e.target.value)}
                  style={{background:C.inputBg,border:`1px solid ${projStatusFilter!=='ALL'?C.accent:C.border}`,borderRadius:8,color:projStatusFilter!=='ALL'?C.accent:C.text,
                    padding:'8px 12px',fontSize:12,fontFamily:"'Inter','Segoe UI',sans-serif",cursor:'pointer',minWidth:130,outline:'none',
                    fontWeight:projStatusFilter!=='ALL'?600:400}}>
                  {projStatuses.map(s=><option key={s} value={s}>{s==='ALL'?'All Statuses':s}</option>)}
                </select>
                {projStatusFilter!=='ALL'&&<button onClick={()=>setProjStatusFilter('ALL')} style={{...S.btnSm,fontSize:11,padding:'5px 10px'}}>Clear</button>}
              </div>
              <div style={{overflowX:'auto',WebkitOverflowScrolling:'touch'}}>
                <table style={{width:'100%',borderCollapse:'collapse'}}>
                  <thead style={{position:'sticky',top:0,zIndex:1}}><tr>
                    <th style={S.th}>Project No</th>
                    <th style={S.th}>Name</th>
                    <th style={S.th}>Customer</th>
                    <th style={S.th}>Status</th>
                    <th style={{...S.th,textAlign:'right'}}>{currency} Outstanding</th>
                    <th style={{...S.th,textAlign:'right'}}>Customers</th>
                  </tr></thead>
                  <tbody>
                    {filteredProjects.length===0&&<tr><td colSpan={6} style={{...S.td,textAlign:'center',color:C.muted,padding:'24px'}}>No projects match "{projSearch}"</td></tr>}
                    {filteredProjects.map((r,i)=>{
                      const st=(r.project_status||'').toLowerCase();
                      const sc=st==='active'?C.teal:st.includes('hold')?C.amber:st.includes('approv')?C.purple:C.textSec;
                      return (
                        <tr key={i} style={{background:i%2===0?'transparent':C.rowAlt}}>
                          <td style={{...S.td,cursor:'pointer'}} onClick={()=>handleProjInfo(r.project_no)}>
                            <span className="clink" title="Click to view project info" style={{color:C.purple,fontWeight:600}}>{r.project_no}</span>
                          </td>
                          <td style={S.td}>{r.project_name}</td>
                          <td style={{...S.td,fontSize:12,color:C.textSec}}>{r.customer_name||'—'}</td>
                          <td style={S.td}><span style={S.pill(sc,sc+'22')}>{r.project_status||'—'}</span></td>
                          <td style={{...S.tdR,color:C.amber,fontWeight:600}}>{fmtFull(r.func_outstanding)}</td>
                          <td style={S.tdR}>{r.customer_count}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                  {filteredProjects.length>0&&<tfoot>
                    <tr style={{borderTop:`2px solid ${C.border}`,background:C.surface}}>
                      <td style={{...S.td,fontWeight:700,color:C.text}} colSpan={2}>Total ({filteredProjects.length} projects)</td>
                      <td style={S.td}/>
                      <td style={S.td}/>
                      <td style={{...S.tdR,fontWeight:700,color:C.amber}}>{fmtFull(filteredProjects.reduce((s,r)=>s+Number(r.func_outstanding||0),0))}</td>
                      <td style={{...S.tdR,fontWeight:700,color:C.text}}>{filteredProjects.reduce((s,r)=>s+Number(r.customer_count||0),0)}</td>
                    </tr>
                  </tfoot>}
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ══ AGING ══ */}
        {tab==='aging'&&<>
          <div style={{display:'flex',gap:8,marginBottom:16}}>
            <FPill label="Stacked chart" active={agingView==='chart'} onClick={()=>setAgingView('chart')} C={C} S={S}/>
            <FPill label="Pivot table"   active={agingView==='table'} onClick={()=>setAgingView('table')} C={C} S={S}/>
          </div>
          {agingView==='chart'&&(
            <div style={S.card}>
              <SHead title={`Customer-wise aging breakdown (${currency})`} sub="Top 15 customers · stacked by aging bucket" C={C}/>
              <ResponsiveContainer width="100%" height={430}>
                <BarChart data={agingTable.slice(0,15)} layout="vertical" margin={{left:170,right:20,top:4,bottom:4}}>
                  <CartesianGrid strokeDasharray="3 3" stroke={C.border} horizontal={false}/>
                  <XAxis type="number" tickFormatter={v=>fmt(v)} tick={{fill:C.muted,fontSize:11}} axisLine={false} tickLine={false}/>
                  <YAxis type="category" dataKey="customer_name" width={165} tick={{fill:C.textSec,fontSize:11}} axisLine={false} tickLine={false} tickFormatter={v=>v.length>26?v.slice(0,26)+'…':v}/>
                  <Tooltip content={<TipC/>}/>
                  <Legend iconSize={10} wrapperStyle={{fontSize:11,color:C.textSec}}/>
                  {BUCKET_ORDER.map(b=><Bar key={b} dataKey={b} stackId="a" fill={BUCKET_COLORS[b]||C.muted} name={b}/>)}
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
          {agingView==='table'&&(
            <div style={S.card}>
              <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'16px 20px 8px'}}>
                <div>
                  <div style={{fontWeight:700,fontSize:15,color:C.text}}>Aging pivot — {currency} outstanding</div>
                  <div style={{fontSize:12,color:C.muted,marginTop:2}}>{filteredAging.length!==agingTable.length?`${filteredAging.length} of ${agingTable.length} customers`:'Click name for profile · click row for transactions'}</div>
                </div>
                <button style={{...S.btnSm,display:'flex',alignItems:'center',gap:6}} onClick={()=>{
                  const rows=filteredAging.map(r=>({
                    account_number:r.account_number,
                    customer_name:r.customer_name,
                    company:r.company||'',
                    ...Object.fromEntries(BUCKET_ORDER.map(b=>[b,r[b]||0])),
                    total:BUCKET_ORDER.reduce((s,b)=>s+(r[b]||0),0),
                  }));
                  exportToExcel(rows,[
                    {key:'account_number',label:'Account No'},
                    {key:'customer_name',label:'Customer Name'},
                    {key:'company',label:'Company'},
                    ...BUCKET_ORDER.map(b=>({key:b,label:b})),
                    {key:'total',label:`Total (${currency})`},
                  ],`aging_${selCountryName}_${new Date().toISOString().slice(0,10)}.csv`);
                }}>📥 Export</button>
              </div>
              <div style={{position:'relative',marginBottom:12,padding:'0 16px'}}>
                <span style={{position:'absolute',left:26,top:'50%',transform:'translateY(-50%)',color:C.muted,fontSize:14,pointerEvents:'none'}}>🔍</span>
                <input type="text" placeholder="Search customer name or account no…" value={agingSearch} onChange={e=>setAgingSearch(e.target.value)} style={{...S.searchBox}}/>
                {agingSearch&&<button onClick={()=>setAgingSearch('')} style={{position:'absolute',right:26,top:'50%',transform:'translateY(-50%)',background:'none',border:'none',color:C.muted,cursor:'pointer',fontSize:16,lineHeight:1}}>✕</button>}
              </div>
              <div style={{overflowX:'auto',WebkitOverflowScrolling:'touch'}}>
                <table style={{width:'100%',borderCollapse:'collapse',minWidth:1000}}>
                  <thead><tr>
                    <th style={S.th}>Account No</th>
                    <th style={S.th}>Customer</th>
                    <th style={{...S.th}} className='hide-mobile'>Company</th>
                    {BUCKET_ORDER.map(b=><th key={b} style={{...S.th,textAlign:'right',whiteSpace:'nowrap'}}><span style={{color:BUCKET_COLORS[b]||C.muted}}>{b}</span></th>)}
                    <th style={{...S.th,textAlign:'right',color:C.amber}}>Total ({currency})</th>
                    <th style={{...S.th,textAlign:'right',color:C.teal}}>Credit Limit</th>
                  </tr></thead>
                  <tbody>
                    {filteredAging.length===0&&<tr><td colSpan={BUCKET_ORDER.length+5} style={{...S.td,textAlign:'center',color:C.muted,padding:'24px'}}>No customers match "{agingSearch}"</td></tr>}
                    {filteredAging.map((r,i)=>{
                      const rowTotal=BUCKET_ORDER.reduce((s,b)=>s+(r[b]||0),0);
                      const prof=customerProfiles[r.account_number];
                      const creditLimit=prof?.credit_limit!=null?fmtFull(prof.credit_limit):profilesLoading?'…':'—';
                      const overLimit=prof?.credit_limit!=null&&rowTotal>prof.credit_limit;
                      return (
                        <tr key={i} style={{background:i%2===0?'transparent':C.rowAlt}}>
                          <td style={{...S.td,fontSize:12,color:C.muted,cursor:'pointer'}} onClick={()=>handleDrill(r.account_number,r.customer_name)}>{r.account_number}</td>
                          <td style={{...S.td,cursor:'pointer'}} onClick={()=>handleCustInfo(r.account_number)}>
                            <span className="clink" title="Click to view customer profile">{r.customer_name}</span>
                          </td>
                          <td style={{...S.td,fontSize:12,color:C.textSec}} className='hide-mobile'>{r.company||'—'}</td>
                          {BUCKET_ORDER.map(b=><td key={b} style={{...S.tdR,color:r[b]?BUCKET_COLORS[b]:C.muted,cursor:'pointer'}} onClick={()=>handleDrill(r.account_number,r.customer_name)}>{r[b]?fmtFull(r[b]):'—'}</td>)}
                          <td style={{...S.tdR,color:C.amber,fontWeight:600,cursor:'pointer'}} onClick={()=>handleDrill(r.account_number,r.customer_name)}>{fmtFull(rowTotal)}</td>
                          <td style={{...S.tdR,color:overLimit?C.coral:C.teal,fontWeight:overLimit?700:400}} title={overLimit?'⚠️ Limit exceeded':''}>
                            {overLimit?'⚠️ ':''}{creditLimit}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  {filteredAging.length>0&&<tfoot>
                    <tr style={{borderTop:`2px solid ${C.border}`,background:C.surface}}>
                      <td style={{...S.td,fontWeight:700,color:C.text}} colSpan={3}>Total ({filteredAging.length} customers)</td>
                      {BUCKET_ORDER.map(b=><td key={b} style={{...S.tdR,fontWeight:700,color:BUCKET_COLORS[b]||C.muted}}>{fmtFull(filteredAging.reduce((s,r)=>s+(r[b]||0),0))}</td>)}
                      <td style={{...S.tdR,fontWeight:700,color:C.amber}}>{fmtFull(filteredAging.reduce((s,r)=>s+BUCKET_ORDER.reduce((t,b)=>t+(r[b]||0),0),0))}</td>
                      <td/>
                    </tr>
                  </tfoot>}
                </table>
              </div>
            </div>
          )}
        </>}

        {/* ══ USERS (admin only) ══ */}
        {tab==='users'&&authUser?.role==='admin'&&(
          <UserManagementPanel C={C} S={S} authUser={authUser}/>
        )}

        {/* ══ AI CHAT ══ */}
        {tab==='chat'&&(
          <div style={{display:'flex',flexDirection:'column',height:'calc(100dvh - 180px)',gap:0,minHeight:400}}>
            {/* Chat header */}
            <div style={{...S.card,borderRadius:'14px 14px 0 0',padding:'14px 20px',borderBottom:`1px solid ${C.border}`,flexShrink:0}}>
              {/* Top row: icon + title + provider toggle + status + clear */}
              <div style={{display:'flex',alignItems:'center',gap:12,marginBottom:10}}>
                <div style={{width:36,height:36,borderRadius:10,
                  background:chatProvider==='claude'
                    ?`linear-gradient(135deg,${C.accent},${C.teal})`
                    :'linear-gradient(135deg,#4285f4,#34a853)',
                  display:'flex',alignItems:'center',justifyContent:'center',fontSize:16,flexShrink:0}}>
                  {chatProvider==='claude'?'🤖':'✨'}
                </div>
                <div style={{flex:1}}>
                  <div style={{fontWeight:700,fontSize:14,color:C.text}}>AR Intelligence Assistant</div>
                  <div style={{fontSize:11,color:C.muted,marginTop:2}}>
                    {chatProvider==='claude'?'Powered by Claude (Anthropic)':'Powered by Gemini 2.5 Flash (Google)'}
                    {profilesLoading&&<span style={{marginLeft:8,color:C.teal}}>· Loading customer profiles…</span>}
                    {projDetailsLoading&&<span style={{marginLeft:8,color:C.purple}}>· Loading project details…</span>}
                  </div>
                </div>

                {/* Provider toggle */}
                <div style={{display:'flex',alignItems:'center',gap:4,background:C.surface,border:`1px solid ${C.border}`,borderRadius:10,padding:3}}>
                  {[{id:'claude',label:'Claude',icon:'🤖',grad:`linear-gradient(135deg,${C.accent},${C.teal})`},
                    {id:'gemini',label:'Gemini',icon:'✨',grad:'linear-gradient(135deg,#4285f4,#34a853)'}].map(p=>(
                    <button key={p.id} onClick={()=>setChatProvider(p.id)}
                      style={{display:'flex',alignItems:'center',gap:6,padding:'6px 14px',borderRadius:8,border:'none',cursor:'pointer',fontSize:12,fontWeight:600,
                        background:chatProvider===p.id?p.grad:'transparent',
                        color:chatProvider===p.id?'#fff':C.muted,
                        transition:'all 0.15s',}}>
                      <span>{p.icon}</span>{p.label}
                    </button>
                  ))}
                </div>

                {/* Gemini key status badge (read-only — set via .env) */}
                {chatProvider==='gemini'&&(
                  <span style={{display:'inline-flex',alignItems:'center',gap:5,padding:'5px 11px',borderRadius:8,
                    border:`1px solid ${geminiKey?C.teal:C.amber}`,
                    background:geminiKey?C.tealSoft:C.coralSoft,
                    color:geminiKey?C.teal:C.amber,fontSize:11,fontWeight:600}}>
                    {geminiKey?'🔑 Key loaded from .env':'⚠️ GEMINI_API_KEY not set in .env'}
                  </span>
                )}

                {chatMessages.length>0&&(
                  <button onClick={()=>setChatMessages([])} style={{...S.btnSm,fontSize:11,padding:'5px 10px',flexShrink:0}}>Clear</button>
                )}
              </div>

              {/* Quick prompts */}
              <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
                {['Who are the top overdue customers?','What is the current vs overdue split?','Which aging bucket has the most risk?','Summarize the AR position'].map(q=>(
                  <button key={q} onClick={()=>sendChat(q)} disabled={chatLoading}
                    style={{fontSize:11,padding:'5px 10px',borderRadius:20,border:`1px solid ${C.border}`,background:C.surface,color:C.textSec,cursor:'pointer',whiteSpace:'nowrap',opacity:chatLoading?0.5:1}}>
                    {q}
                  </button>
                ))}
              </div>
            </div>

            {/* Messages area */}
            <div style={{...S.card,borderRadius:0,flex:1,overflowY:'auto',padding:'20px',display:'flex',flexDirection:'column',gap:16,borderTop:'none',borderBottom:'none'}}>
              {chatMessages.length===0&&(
                <div style={{flex:1,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',textAlign:'center',padding:'40px 20px',gap:16}}>
                  <div style={{fontSize:48,opacity:0.4}}>💬</div>
                  <div style={{fontWeight:600,fontSize:16,color:C.text}}>Ask anything about your AR data</div>
                  <div style={{fontSize:13,color:C.muted,maxWidth:420,lineHeight:1.7}}>
                    I have full context of the current dashboard — customers, balances, aging buckets, and projects.
                    Try one of the suggested questions above, or type your own.
                  </div>
                  <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginTop:8,maxWidth:500}}>
                    {[
                      {icon:'📊',text:'Summarize the overall AR position'},
                      {icon:'⚠️',text:'Which customers need urgent follow-up?'},
                      {icon:'📅',text:'Break down the 365+ days bucket'},
                      {icon:'🏗️',text:'Which projects have the highest risk?'},
                    ].map(s=>(
                      <button key={s.text} onClick={()=>sendChat(s.text)} disabled={chatLoading}
                        style={{textAlign:'left',padding:'12px 14px',borderRadius:10,border:`1px solid ${C.border}`,background:C.surface,color:C.textSec,cursor:'pointer',fontSize:12,display:'flex',gap:8,alignItems:'flex-start',lineHeight:1.4}}>
                        <span style={{fontSize:16,flexShrink:0}}>{s.icon}</span>{s.text}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {chatMessages.map((m,i)=>(
                <div key={i} style={{display:'flex',gap:12,alignItems:'flex-start',flexDirection:m.role==='user'?'row-reverse':'row'}}>
                  {/* Avatar */}
                  <div style={{width:32,height:32,borderRadius:8,flexShrink:0,
                    background:m.role==='user'?C.accentSoft:chatProvider==='claude'?`linear-gradient(135deg,${C.accent},${C.teal})`:'linear-gradient(135deg,#4285f4,#34a853)',
                    display:'flex',alignItems:'center',justifyContent:'center',fontSize:14,fontWeight:700,
                    color:m.role==='user'?C.accent:'#fff'}}>
                    {m.role==='user'?'U':chatProvider==='claude'?'AI':'G'}
                  </div>
                  {/* Bubble */}
                  <div style={{
                    maxWidth:'72%',
                    background:m.role==='user'?C.accentSoft:C.surface,
                    border:`1px solid ${m.role==='user'?C.accent+'44':C.border}`,
                    borderRadius:m.role==='user'?'12px 4px 12px 12px':'4px 12px 12px 12px',
                    padding:'12px 16px',
                    fontSize:13,
                    color:C.text,
                    lineHeight:1.7,
                    whiteSpace:'pre-wrap',
                  }}>
                    {m.content}
                  </div>
                </div>
              ))}
              {chatLoading&&(
                <div style={{display:'flex',gap:12,alignItems:'flex-start'}}>
                  <div style={{width:32,height:32,borderRadius:8,flexShrink:0,
                    background:chatProvider==='claude'?`linear-gradient(135deg,${C.accent},${C.teal})`:'linear-gradient(135deg,#4285f4,#34a853)',
                    display:'flex',alignItems:'center',justifyContent:'center',fontSize:14,fontWeight:700,color:'#fff'}}>
                    {chatProvider==='claude'?'AI':'G'}
                  </div>
                  <div style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:'4px 12px 12px 12px',padding:'12px 16px',display:'flex',gap:6,alignItems:'center'}}>
                    <style>{`@keyframes chatbounce{0%,100%{transform:translateY(0);opacity:.4}50%{transform:translateY(-5px);opacity:1}}`}</style>
                    {[0,1,2].map(i=><div key={i} style={{width:7,height:7,borderRadius:'50%',background:C.accent,animation:`chatbounce 1.1s ease-in-out ${i*0.18}s infinite`}}/>)}
                  </div>
                </div>
              )}
              <div ref={chatEndRef}/>
            </div>

            {/* Input area */}
            <div style={{...S.card,borderRadius:'0 0 14px 14px',padding:'12px 16px',borderTop:`1px solid ${C.border}`,display:'flex',gap:10,alignItems:'flex-end',flexShrink:0}}>
              <textarea
                value={chatInput}
                onChange={e=>setChatInput(e.target.value)}
                onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendChat(chatInput);}}}
                placeholder="Ask about customers, balances, aging, projects… (Enter to send, Shift+Enter for newline)"
                disabled={chatLoading}
                rows={1}
                style={{
                  flex:1,background:C.inputBg,border:`1px solid ${C.border}`,borderRadius:10,
                  color:C.text,padding:'10px 14px',fontSize:13,outline:'none',resize:'none',
                  fontFamily:"'Inter','Segoe UI',sans-serif",lineHeight:1.5,
                  minHeight:42,maxHeight:120,opacity:chatLoading?0.6:1,
                }}
              />
              <button onClick={()=>sendChat(chatInput)} disabled={chatLoading||!chatInput.trim()}
                style={{
                  background:chatInput.trim()&&!chatLoading?C.accent:'transparent',
                  color:chatInput.trim()&&!chatLoading?'#fff':C.muted,
                  border:`1px solid ${chatInput.trim()&&!chatLoading?C.accent:C.border}`,
                  borderRadius:10,padding:'10px 20px',fontSize:13,fontWeight:600,cursor:'pointer',
                  flexShrink:0,height:42,display:'flex',alignItems:'center',gap:6,
                  transition:'all 0.15s',
                }}>
                {chatLoading?'…':'Send ↑'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}