'use client';

import { useState, useEffect, useRef } from "react";
import { useTranslations } from 'next-intl';

// ─────────────────────────────────────────────────────────────────────────────
// GLOBAL CSS
// ─────────────────────────────────────────────────────────────────────────────
const G = `
@import url('https://fonts.googleapis.com/css2?family=Outfit:wght@400;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap');
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --bg:#08080c;--s1:#0f0f15;--s2:#16161f;--s3:#1e1e2a;
  --border:#252535;--border2:#32324a;
  --accent:#6366f1;--accent2:#a78bfa;--accent3:#38bdf8;
  --text:#eeeef5;--muted:#6b6b85;--dimmed:#3a3a55;
  --green:#4ade80;--amber:#fbbf24;--red:#f87171;
}
body{background:var(--bg);color:var(--text);font-family:'Outfit',sans-serif}

.fade{animation:fadeUp .38s cubic-bezier(.22,1,.36,1) both}
@keyframes fadeUp{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:translateY(0)}}
.stagger-1{animation-delay:.05s}.stagger-2{animation-delay:.1s}.stagger-3{animation-delay:.15s}

/* Cards */
.card{
  border:1.5px solid var(--border);border-radius:12px;
  background:var(--s1);padding:14px 16px;cursor:pointer;
  transition:border-color .15s,background .15s,transform .12s;
  user-select:none;position:relative;overflow:hidden;
}
.card:hover{border-color:var(--border2);background:var(--s2);transform:translateY(-1px)}
.card.sel{border-color:var(--accent);background:rgba(99,102,241,.08)}
.card.sel::before{
  content:'';position:absolute;inset:0;
  background:linear-gradient(135deg,rgba(99,102,241,.06),transparent);
  pointer-events:none;
}
.card-check{
  width:20px;height:20px;border-radius:50%;border:1.5px solid var(--dimmed);
  display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:.15s;
}
.card.sel .card-check{background:var(--accent);border-color:var(--accent)}
.card-checkb{
  width:20px;height:20px;border-radius:5px;border:1.5px solid var(--dimmed);
  display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:.15s;
}
.card.sel .card-checkb{background:var(--accent);border-color:var(--accent)}

/* Buttons */
.btn{border:none;border-radius:9px;padding:12px 26px;
  font-family:'Outfit',sans-serif;font-size:15px;font-weight:600;
  cursor:pointer;transition:all .18s;letter-spacing:.01em}
.btn-p{background:var(--accent);color:#fff}
.btn-p:hover{filter:brightness(1.12)}
.btn-p:disabled{opacity:.3;cursor:not-allowed;filter:none}
.btn-g{background:transparent;color:var(--muted);border:1.5px solid var(--border)}
.btn-g:hover{border-color:var(--border2);color:var(--text)}
.btn-outline{background:transparent;color:var(--accent);border:1.5px solid var(--accent)}
.btn-outline:hover{background:rgba(99,102,241,.1)}

/* Progress */
.prog{height:3px;background:var(--s3);border-radius:3px;overflow:hidden}
.prog-f{height:100%;background:linear-gradient(90deg,var(--accent),var(--accent2));
  border-radius:3px;transition:width .5s ease}

/* Proposal card */
.prop-card{
  border:1.5px solid var(--border);border-radius:14px;
  background:var(--s1);padding:22px 24px;cursor:pointer;
  transition:all .2s;position:relative;overflow:hidden;
}
.prop-card:hover{border-color:var(--accent);transform:translateY(-2px);
  box-shadow:0 8px 32px rgba(99,102,241,.12)}
.prop-card.picked{border-color:var(--accent);background:rgba(99,102,241,.07);
  box-shadow:0 0 0 3px rgba(99,102,241,.2)}

/* Code box */
.codebox{
  background:#060609;border:1px solid var(--border);border-radius:12px;
  padding:26px 30px;font-family:'JetBrains Mono',monospace;font-size:12px;
  line-height:2;white-space:pre-wrap;color:#9090b8;
  max-height:540px;overflow-y:auto;
}
.codebox::-webkit-scrollbar{width:5px}
.codebox::-webkit-scrollbar-thumb{background:var(--border2);border-radius:4px}

/* Spinner */
.spin{width:38px;height:38px;border-radius:50%;
  border:3px solid var(--s3);border-top-color:var(--accent);
  animation:rot .7s linear infinite}
@keyframes rot{to{transform:rotate(360deg)}}

/* Tag */
.tag{
  display:inline-block;border-radius:6px;padding:3px 10px;
  font-size:11px;margin:2px 3px;font-weight:600;letter-spacing:.04em;
}
.tag-accent{background:rgba(99,102,241,.15);border:1px solid rgba(99,102,241,.3);color:var(--accent2)}
.tag-green{background:rgba(74,222,128,.1);border:1px solid rgba(74,222,128,.25);color:var(--green)}
.tag-amber{background:rgba(251,191,36,.1);border:1px solid rgba(251,191,36,.25);color:var(--amber)}
`;

// ─────────────────────────────────────────────────────────────────────────────
// DATA – genres & sub-genres (IDs and icons only, labels from translations)
// ─────────────────────────────────────────────────────────────────────────────
const GENRES = [
  {id:"game",      icon:"🎮"},
  {id:"sns",       icon:"💬"},
  {id:"ecommerce", icon:"🛍"},
  {id:"saas",      icon:"💼"},
  {id:"media",     icon:"📰"},
  {id:"health",    icon:"🏋"},
  {id:"finance",   icon:"💰"},
  {id:"edu",       icon:"📚"},
  {id:"ai_tool",   icon:"🤖"},
  {id:"creative",  icon:"🎨"},
  {id:"map",       icon:"🗺"},
  {id:"util",      icon:"🔧"},
];

const SUB_GENRES: Record<string, {id: string; icon: string}[]> = {
  game:[
    {id:"rpg",       icon:"⚔️"},
    {id:"action",    icon:"💥"},
    {id:"shooting",  icon:"🔫"},
    {id:"fighting",  icon:"🥊"},
    {id:"strategy",  icon:"♟"},
    {id:"puzzle",    icon:"🧩"},
    {id:"simulation",icon:"🏙"},
    {id:"adventure", icon:"🌍"},
    {id:"sports",    icon:"⚽"},
    {id:"card",      icon:"🃏"},
    {id:"idle",      icon:"⏱"},
    {id:"rhythm",    icon:"🎵"},
  ],
  sns:[
    {id:"micro",     icon:"🐦"},
    {id:"photo",     icon:"📸"},
    {id:"video",     icon:"🎬"},
    {id:"forum",     icon:"💭"},
    {id:"dating",    icon:"❤️"},
    {id:"local",     icon:"📍"},
    {id:"interest",  icon:"🔖"},
    {id:"pro",       icon:"👔"},
  ],
  ecommerce:[
    {id:"b2c",       icon:"🏪"},
    {id:"b2b",       icon:"🏭"},
    {id:"c2c",       icon:"🤝"},
    {id:"subscription",icon:"🔄"},
    {id:"digital",   icon:"💾"},
    {id:"auction",   icon:"🔨"},
    {id:"food",      icon:"🍔"},
    {id:"ticket",    icon:"🎟"},
  ],
  saas:[
    {id:"crm",       icon:"👥"},
    {id:"pm",        icon:"📋"},
    {id:"hr",        icon:"🏢"},
    {id:"accounting",icon:"📊"},
    {id:"helpdesk",  icon:"🎧"},
    {id:"analytics", icon:"📈"},
    {id:"cms",       icon:"📝"},
    {id:"inventory", icon:"📦"},
  ],
  media:[
    {id:"blog",      icon:"✍️"},
    {id:"news",      icon:"📰"},
    {id:"podcast",   icon:"🎙"},
    {id:"newsletter",icon:"📧"},
    {id:"wiki",      icon:"📖"},
    {id:"review",    icon:"⭐"},
  ],
  health:[
    {id:"workout",   icon:"💪"},
    {id:"diet",      icon:"🥗"},
    {id:"sleep",     icon:"😴"},
    {id:"mental",    icon:"🧘"},
    {id:"habit",     icon:"✅"},
    {id:"medical",   icon:"🏥"},
  ],
  finance:[
    {id:"kakeibo",   icon:"📒"},
    {id:"invest",    icon:"📈"},
    {id:"crypto",    icon:"🪙"},
    {id:"budget",    icon:"💵"},
    {id:"split",     icon:"🍕"},
    {id:"tax",       icon:"🧾"},
  ],
  edu:[
    {id:"course",    icon:"🎓"},
    {id:"quiz",      icon:"❓"},
    {id:"flashcard", icon:"🗂"},
    {id:"language",  icon:"🌐"},
    {id:"coding",    icon:"💻"},
    {id:"kids",      icon:"👶"},
    {id:"lms",       icon:"🏫"},
  ],
  ai_tool:[
    {id:"chatbot",   icon:"💬"},
    {id:"writing",   icon:"✍️"},
    {id:"image_gen", icon:"🖼"},
    {id:"code_gen",  icon:"⌨️"},
    {id:"data_anal", icon:"📊"},
    {id:"voice",     icon:"🎤"},
    {id:"automation",icon:"⚙️"},
    {id:"search",    icon:"🔍"},
  ],
  creative:[
    {id:"design",    icon:"🎨"},
    {id:"music",     icon:"🎵"},
    {id:"video_edit",icon:"🎬"},
    {id:"3d",        icon:"🧊"},
    {id:"photo_edit",icon:"📸"},
    {id:"writing2",  icon:"📖"},
  ],
  map:[
    {id:"navigation",icon:"🧭"},
    {id:"spot",      icon:"📍"},
    {id:"delivery",  icon:"🚚"},
    {id:"geofence",  icon:"📡"},
    {id:"tourism",   icon:"🏖"},
  ],
  util:[
    {id:"todo",      icon:"✅"},
    {id:"note",      icon:"📝"},
    {id:"calendar",  icon:"📅"},
    {id:"timer",     icon:"⏱"},
    {id:"password",  icon:"🔐"},
    {id:"file",      icon:"📁"},
    {id:"translate", icon:"🌐"},
    {id:"qr",        icon:"📱"},
  ],
};

const ELEMENTS = [
  {id:"multiplayer", icon:"👥"},
  {id:"realtime",    icon:"⚡"},
  {id:"auth",        icon:"🔐"},
  {id:"payment",     icon:"💳"},
  {id:"ai",          icon:"🤖"},
  {id:"notification",icon:"🔔"},
  {id:"offline",     icon:"📵"},
  {id:"social",      icon:"💬"},
  {id:"analytics",   icon:"📊"},
  {id:"upload",      icon:"📁"},
  {id:"map_feat",    icon:"🗺"},
  {id:"search_feat", icon:"🔍"},
  {id:"admin",       icon:"🛠"},
  {id:"api_feat",    icon:"🔌"},
  {id:"multilang",   icon:"🌍"},
  {id:"dark_mode",   icon:"🌙"},
  {id:"pwa",         icon:"📲"},
  {id:"export",      icon:"📤"},
  {id:"subscription_feat",icon:"🔄"},
  {id:"ranking",     icon:"🏆"},
];

const PLATFORMS = [
  {id:"web",        icon:"🌐"},
  {id:"ios",        icon:"🍎"},
  {id:"android",    icon:"🤖"},
  {id:"mobile",     icon:"📲"},
  {id:"desktop",    icon:"🖥"},
  {id:"web_mobile", icon:"🔀"},
];

const SCALES = [
  {id:"solo",  icon:"🧑"},
  {id:"small", icon:"👨‍👩‍👧"},
  {id:"mid",   icon:"🏘"},
  {id:"large", icon:"🌏"},
];

const PRIORITIES = [
  {id:"speed",    icon:"⚡"},
  {id:"quality",  icon:"🏆"},
  {id:"scale",    icon:"📈"},
  {id:"security", icon:"🔒"},
];

// ─────────────────────────────────────────────────────────────────────────────
// AI CALLS
// ─────────────────────────────────────────────────────────────────────────────

interface AppAnswers {
  genre: string;
  subs?: string[];
  elements?: string[];
  platform: string;
  scale: string;
  priority: string;
}

interface AppProposal {
  id: number;
  name: string;
  tagline: string;
  concept: string;
  unique: string;
  difficulty: string;
  tech_hint: string[];
  title?: string;
  description?: string;
  score?: number;
}

interface GenerateResult {
  tech_rationale: string;
  score: number;
  claude_md: string;
}

// Helper to resolve labels from translation function
function resolveLabels(t: (key: string) => string, answers: AppAnswers) {
  const genre = t('genre_' + answers.genre);
  const subs = (answers.subs || []).map((id: string) => t(`sub_${answers.genre}_${id}`)).filter(Boolean).join("、");
  const elems = (answers.elements || []).map((id: string) => t('elem_' + id)).filter(Boolean).join("、");
  const plat = t('plat_' + answers.platform);
  const scale = t('scale_' + answers.scale);
  const prio = t('prio_' + answers.priority);
  return { genre, subs, elems, plat, scale, prio };
}

async function proposeApps(t: (key: string) => string, answers: AppAnswers) {
  const { genre, subs, elems, plat, scale, prio } = resolveLabels(t, answers);

  const response = await fetch('/api/generate-proposals', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      genre, subs, elems, plat, scale, prio
    })
  });

  const data = await response.json();
  return data;
}

async function generateClaudeMd(t: (key: string) => string, answers: AppAnswers, proposal: AppProposal) {
  const { genre, subs, elems, plat, scale, prio } = resolveLabels(t, answers);

  const response = await fetch('/api/generate-claude-md', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      genre, subs, elems, plat, scale, prio, proposal
    })
  });

  const data = await response.json();
  return data;
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPONENTS
// ─────────────────────────────────────────────────────────────────────────────
function ScoreRing({score, label}: {score: number; label: string}){
  const r=52,circ=2*Math.PI*r,fill=circ*(1-score/100);
  const col=score>=90?"var(--green)":score>=75?"var(--amber)":"var(--red)";
  return(
    <div style={{textAlign:"center",marginBottom:24}}>
      <svg width={124} height={124} viewBox="0 0 124 124">
        <circle cx={62} cy={62} r={r} fill="none" stroke="var(--s3)" strokeWidth={9}/>
        <circle cx={62} cy={62} r={r} fill="none" stroke={col} strokeWidth={9}
          strokeDasharray={circ} strokeDashoffset={fill}
          strokeLinecap="round" transform="rotate(-90 62 62)"
          style={{transition:"stroke-dashoffset 1.2s ease"}}/>
        <text x={62} y={56} textAnchor="middle" fill={col} fontSize={26}
          fontFamily="'Outfit',sans-serif" fontWeight={800}>{score}</text>
        <text x={62} y={74} textAnchor="middle" fill="var(--muted)" fontSize={10}
          fontFamily="'JetBrains Mono',monospace">/ 100</text>
      </svg>
      <div style={{fontSize:11,color:"var(--muted)"}}>{label}</div>
    </div>
  );
}

function CheckIcon(){
  return <svg width={11} height={11} viewBox="0 0 11 11"><polyline points="1,5.5 4,8.5 10,2" stroke="white" strokeWidth={1.8} fill="none" strokeLinecap="round" strokeLinejoin="round"/></svg>;
}
function DotIcon(){
  return <div style={{width:7,height:7,borderRadius:"50%",background:"white"}}/>;
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────────────────────
export default function ClaudeMdGeneratorPage(){
  const t = useTranslations('claudeMd');
  // phase: intro | genre | sub | elements | platform | proposing | proposals | generating | result
  const [phase, setPhase]       = useState("intro");
  const [answers, setAnswers]   = useState<AppAnswers>({genre:"",platform:"",scale:"",priority:""});
  const [proposals, setProposals] = useState<AppProposal[]>([]);
  const [pickedProp, setPickedProp] = useState<AppProposal | null>(null);
  const [result, setResult]     = useState<GenerateResult | null>(null);
  const [copied, setCopied]     = useState(false);
  const topRef = useRef<HTMLDivElement>(null);

  useEffect(()=>{ topRef.current?.scrollIntoView({behavior:"smooth"}); },[phase]);

  // ── helpers ─────────────────────────────────────────────────────────────
  const go = (nextPhase: string, extra: Partial<AppAnswers> = {}) => {
    setAnswers(a=>({...a,...extra}));
    setPhase(nextPhase);
  };

  const diffLabel = (d: string) => d==="easy"?t('difficultyEasy'):d==="medium"?t('difficultyMedium'):t('difficultyHard');

  // ── INTRO ────────────────────────────────────────────────────────────────
  if(phase==="intro") return(
    <div style={{minHeight:"100vh",background:"var(--bg)",display:"flex",alignItems:"center",justifyContent:"center",padding:"32px 20px"}}>
      <style>{G}</style>
      <div style={{maxWidth:500,width:"100%",textAlign:"center"}} className="fade" ref={topRef}>
        <div style={{display:"inline-flex",alignItems:"center",gap:8,
          border:"1px solid rgba(99,102,241,.35)",borderRadius:100,
          padding:"5px 16px",marginBottom:36,background:"rgba(99,102,241,.07)"}}>
          <span style={{width:6,height:6,borderRadius:"50%",background:"var(--accent)",display:"inline-block"}}/>
          <span style={{fontSize:11,color:"var(--accent2)",letterSpacing:".14em"}}>{t('wizardLabel')}</span>
        </div>
        <h1 style={{fontFamily:"'Outfit',sans-serif",fontSize:44,fontWeight:800,
          lineHeight:1.1,letterSpacing:"-.03em",marginBottom:20,
          background:"linear-gradient(135deg, #eeeef5 20%, var(--accent2) 80%)",
          WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent",
          whiteSpace:"pre-line"}}>
          {t('heroTitle')}
        </h1>
        <p style={{color:"var(--muted)",fontSize:14,lineHeight:1.9,marginBottom:44,whiteSpace:"pre-line"}}>
          {t('heroDescription')}
          <span style={{color:"var(--text)"}}>{t('heroHighlight')}</span><br/>
          {t('heroPerfect')} <code style={{color:"var(--accent2)"}}>CLAUDE.md</code> {t('heroSuffix')}
        </p>
        <div style={{display:"flex",flexWrap:"wrap",gap:8,justifyContent:"center",marginBottom:40}}>
          {[t('tagDeepDive'), t('tagAiPropose'), t('tagAutoTech'), t('tagBehavior')].map(tag=>(
            <span key={tag} className="tag tag-accent">{tag}</span>
          ))}
        </div>
        <button className="btn btn-p" onClick={()=>setPhase("genre")}
          style={{fontSize:16,padding:"15px 48px"}}>{t('start')}</button>
      </div>
    </div>
  );

  // ── GENRE ────────────────────────────────────────────────────────────────
  if(phase==="genre") return(
    <PageWrap topRef={topRef} title={t('genreTitle')} sub={t('genreSub')} step={1} total={5}>
      <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:10,marginBottom:36}}>
        {GENRES.map(g=>(
          <div key={g.id} className="card" onClick={()=>go("sub",{genre:g.id,subs:[],elements:[]})}>
            <div style={{fontSize:24,marginBottom:6}}>{g.icon}</div>
            <div style={{fontSize:14,fontWeight:600}}>{t('genre_' + g.id)}</div>
          </div>
        ))}
      </div>
    </PageWrap>
  );

  // ── SUB ──────────────────────────────────────────────────────────────────
  if(phase==="sub"){
    const subs = SUB_GENRES[answers.genre] || [];
    const sel  = answers.subs || [];
    const toggle = (id: string) => setAnswers(a=>({...a,subs:a.subs?.includes(id)?a.subs.filter(x=>x!==id):[...(a.subs || []),id]}));
    return(
      <PageWrap topRef={topRef}
        title={t('subTitle', { genre: t('genre_' + answers.genre) })}
        sub={t('subSub')} step={2} total={5}
        onBack={()=>setPhase("genre")}
        onNext={()=>setPhase("elements")}
        nextLabel={t('next')} canNext={true}
        backLabel={t('back')}>
        <div style={{display:"grid",gridTemplateColumns:"repeat(2,1fr)",gap:10,marginBottom:32}}>
          {subs.map(s=>{
            const isSel=sel.includes(s.id);
            return(
              <div key={s.id} className={`card ${isSel?"sel":""}`} onClick={()=>toggle(s.id)}>
                <div className="card-checkb">{isSel&&<CheckIcon/>}</div>
                <div style={{flex:1}}>
                  <div style={{fontSize:14,fontWeight:600,display:"flex",alignItems:"center",gap:6}}>
                    <span>{s.icon}</span><span>{t(`sub_${answers.genre}_${s.id}`)}</span>
                  </div>
                  <div style={{fontSize:11,color:"var(--muted)",marginTop:3}}>{t(`sub_${answers.genre}_${s.id}_desc`)}</div>
                </div>
              </div>
            );
          })}
        </div>
      </PageWrap>
    );
  }

  // ── ELEMENTS ─────────────────────────────────────────────────────────────
  if(phase==="elements"){
    const sel = answers.elements || [];
    const toggle = (id: string) => setAnswers(a=>({...a,elements:a.elements?.includes(id)?a.elements.filter(x=>x!==id):[...(a.elements || []),id]}));
    return(
      <PageWrap topRef={topRef}
        title={t('elementsTitle')}
        sub={t('elementsSub')} step={3} total={5}
        onBack={()=>setPhase("sub")}
        onNext={()=>setPhase("platform")}
        nextLabel={t('next')} canNext={true}
        backLabel={t('back')}>
        <div style={{display:"grid",gridTemplateColumns:"repeat(2,1fr)",gap:10,marginBottom:32}}>
          {ELEMENTS.map(e=>{
            const isSel=sel.includes(e.id);
            return(
              <div key={e.id} className={`card ${isSel?"sel":""}`} onClick={()=>toggle(e.id)}>
                <div className="card-checkb">{isSel&&<CheckIcon/>}</div>
                <div style={{fontSize:14,fontWeight:600,display:"flex",alignItems:"center",gap:6}}>
                  <span>{e.icon}</span><span>{t('elem_' + e.id)}</span>
                </div>
              </div>
            );
          })}
        </div>
      </PageWrap>
    );
  }

  // ── PLATFORM ─────────────────────────────────────────────────────────────
  if(phase==="platform"){
    const [localPlatform, setLocalPlatform] = useState<string|null>(answers.platform||null);
    const [localScale, setLocalScale]       = useState<string|null>(answers.scale||null);
    const [localPrio, setLocalPrio]         = useState<string|null>(answers.priority||null);

    const handleGenerate = async () => {
      const next: AppAnswers = {...answers, platform:localPlatform||"", scale:localScale||"", priority:localPrio||""};
      setAnswers(next);
      setPhase("proposing");
      try{
        const r = await proposeApps(t, next);
        setProposals(r.proposals||[]);
      }catch{ setProposals([]); }
      setPhase("proposals");
    };

    const canGo = localPlatform && localScale && localPrio;

    return(
      <PageWrap topRef={topRef}
        title={t('platformTitle')} sub="" step={4} total={5}
        onBack={()=>setPhase("elements")}>
        {/* Platform */}
        <div style={{marginBottom:28}}>
          <div style={{fontSize:13,fontWeight:600,color:"var(--muted)",marginBottom:12,letterSpacing:".05em"}}>{t('platformQuestion')}</div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(2,1fr)",gap:8}}>
            {PLATFORMS.map(p=>{
              const s=localPlatform===p.id;
              return(
                <div key={p.id} className={`card ${s?"sel":""}`} onClick={()=>setLocalPlatform(p.id)}>
                  <div className="card-check">{s&&<DotIcon/>}</div>
                  <div>
                    <div style={{fontSize:13,fontWeight:600}}>{p.icon} {t('plat_' + p.id)}</div>
                    <div style={{fontSize:11,color:"var(--muted)"}}>{t('plat_' + p.id + '_desc')}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Scale */}
        <div style={{marginBottom:28}}>
          <div style={{fontSize:13,fontWeight:600,color:"var(--muted)",marginBottom:12,letterSpacing:".05em"}}>{t('scaleQuestion')}</div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(2,1fr)",gap:8}}>
            {SCALES.map(s=>{
              const sel2=localScale===s.id;
              return(
                <div key={s.id} className={`card ${sel2?"sel":""}`} onClick={()=>setLocalScale(s.id)}>
                  <div className="card-check">{sel2&&<DotIcon/>}</div>
                  <div>
                    <div style={{fontSize:13,fontWeight:600}}>{s.icon} {t('scale_' + s.id)}</div>
                    <div style={{fontSize:11,color:"var(--muted)"}}>{t('scale_' + s.id + '_desc')}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Priority */}
        <div style={{marginBottom:36}}>
          <div style={{fontSize:13,fontWeight:600,color:"var(--muted)",marginBottom:12,letterSpacing:".05em"}}>{t('priorityQuestion')}</div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(2,1fr)",gap:8}}>
            {PRIORITIES.map(p=>{
              const s=localPrio===p.id;
              return(
                <div key={p.id} className={`card ${s?"sel":""}`} onClick={()=>setLocalPrio(p.id)}>
                  <div className="card-check">{s&&<DotIcon/>}</div>
                  <div>
                    <div style={{fontSize:13,fontWeight:600}}>{p.icon} {t('prio_' + p.id)}</div>
                    <div style={{fontSize:11,color:"var(--muted)"}}>{t('prio_' + p.id + '_desc')}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div style={{display:"flex",justifyContent:"space-between"}}>
          <button className="btn btn-g" onClick={()=>setPhase("elements")}>{t('back')}</button>
          <button className="btn btn-p" onClick={handleGenerate} disabled={!canGo}>
            {t('proposeWithAi')}
          </button>
        </div>
      </PageWrap>
    );
  }

  // ── PROPOSING ────────────────────────────────────────────────────────────
  if(phase==="proposing") return(
    <div style={{minHeight:"100vh",background:"var(--bg)",display:"flex",alignItems:"center",justifyContent:"center",padding:"32px 20px"}}>
      <style>{G}</style>
      <div style={{textAlign:"center"}} ref={topRef}>
        <div className="spin" style={{margin:"0 auto 28px"}}/>
        <h2 style={{fontFamily:"'Outfit',sans-serif",fontSize:22,marginBottom:12}}>{t('proposingTitle')}</h2>
        <p style={{color:"var(--muted)",fontSize:13,lineHeight:1.9,whiteSpace:"pre-line"}}>{t('proposingDescription')}</p>
      </div>
    </div>
  );

  // ── PROPOSALS ────────────────────────────────────────────────────────────
  if(phase==="proposals"){
    const diffColor = (d: string) => d==="easy"?"var(--green)":d==="medium"?"var(--amber)":"var(--red)";
    return(
      <div style={{minHeight:"100vh",background:"var(--bg)",padding:"40px 20px",fontFamily:"'Outfit',sans-serif"}}>
        <style>{G}</style>
        <div style={{maxWidth:680,margin:"0 auto"}} className="fade" ref={topRef}>
          <div style={{marginBottom:32}}>
            <div style={{fontSize:10,letterSpacing:".18em",color:"var(--accent)",marginBottom:8}}>STEP 5 / 5</div>
            <h2 style={{fontFamily:"'Outfit',sans-serif",fontSize:26,fontWeight:800,marginBottom:6}}>
              {t('proposalsTitle')}
            </h2>
            <p style={{color:"var(--muted)",fontSize:13}}>
              {t('proposalsDescription')}
            </p>
          </div>

          <div style={{display:"flex",flexDirection:"column",gap:16,marginBottom:32}}>
            {proposals.map((p,i)=>{
              const picked=pickedProp?.id===p.id;
              return(
                <div key={p.id} className={`prop-card ${picked?"picked":""} fade stagger-${i+1}`}
                  onClick={()=>setPickedProp(p)}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:10}}>
                    <div style={{display:"flex",alignItems:"center",gap:10}}>
                      <div style={{
                        width:36,height:36,borderRadius:9,
                        background:`rgba(99,102,241,${0.1+i*0.08})`,
                        border:"1px solid rgba(99,102,241,.25)",
                        display:"flex",alignItems:"center",justifyContent:"center",
                        fontWeight:800,fontSize:16,color:"var(--accent2)",flexShrink:0,
                      }}>{p.id}</div>
                      <div>
                        <div style={{fontWeight:700,fontSize:17}}>{p.name}</div>
                        <div style={{fontSize:12,color:"var(--accent2)",marginTop:1}}>{p.tagline}</div>
                      </div>
                    </div>
                    <span style={{
                      fontSize:11,fontWeight:600,padding:"3px 10px",borderRadius:6,
                      background:`rgba(${p.difficulty==="easy"?"74,222,128":p.difficulty==="medium"?"251,191,36":"248,113,113"},.12)`,
                      color:diffColor(p.difficulty),flexShrink:0,
                    }}>{diffLabel(p.difficulty)}</span>
                  </div>
                  <p style={{fontSize:13,color:"#c0c0d8",lineHeight:1.7,marginBottom:10}}>{p.concept}</p>
                  <div style={{fontSize:12,color:"var(--accent2)",marginBottom:10}}>
                    ✦ {p.unique}
                  </div>
                  <div style={{display:"flex",flexWrap:"wrap",gap:4}}>
                    {(p.tech_hint||[]).map((hint)=>(
                      <span key={hint} className="tag tag-accent" style={{fontSize:10}}>{hint}</span>
                    ))}
                  </div>
                  {picked&&(
                    <div style={{
                      position:"absolute",top:14,right:14,
                      width:22,height:22,borderRadius:"50%",
                      background:"var(--accent)",
                      display:"flex",alignItems:"center",justifyContent:"center",
                    }}>
                      <CheckIcon/>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div style={{display:"flex",justifyContent:"space-between",flexWrap:"wrap",gap:12}}>
            <button className="btn btn-g" onClick={()=>{
              setPhase("proposing");
              proposeApps(t, answers).then(r=>{setProposals(r.proposals||[]);setPickedProp(null);setPhase("proposals");});
            }}>
              {t('otherProposals')}
            </button>
            <button className="btn btn-p"
              disabled={!pickedProp}
              onClick={async()=>{
                setPhase("generating");
                try{
                  const r=await generateClaudeMd(t, answers,pickedProp!);
                  setResult(r);
                }catch{
                  setResult({tech_rationale:"",score:90,claude_md:t('errorOccurred')});
                }
                setPhase("result");
              }}>
              {t('generateClaudeMd')}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── GENERATING ───────────────────────────────────────────────────────────
  if(phase==="generating") return(
    <div style={{minHeight:"100vh",background:"var(--bg)",display:"flex",alignItems:"center",justifyContent:"center",padding:"32px 20px"}}>
      <style>{G}</style>
      <div style={{textAlign:"center"}} ref={topRef}>
        <div className="spin" style={{margin:"0 auto 28px"}}/>
        <h2 style={{fontFamily:"'Outfit',sans-serif",fontSize:22,marginBottom:12}}>{t('generatingTitle')}</h2>
        <div style={{display:"flex",flexDirection:"column",gap:10,marginTop:28,textAlign:"left"}}>
          {[t('generatingStep1'), t('generatingStep2'), t('generatingStep3'), t('generatingStep4'), t('generatingStep5')].map((step,i)=>(
            <div key={step} style={{display:"flex",alignItems:"center",gap:10,opacity:0,animation:`fadeUp .4s ${i*.25}s both`}}>
              <div style={{width:6,height:6,borderRadius:"50%",background:"var(--accent)",flexShrink:0}}/>
              <span style={{color:"var(--muted)",fontSize:12,fontFamily:"'JetBrains Mono',monospace"}}>{step}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  // ── RESULT ───────────────────────────────────────────────────────────────
  if(phase==="result") return(
    <div style={{minHeight:"100vh",background:"var(--bg)",padding:"40px 20px",fontFamily:"'Outfit',sans-serif"}}>
      <style>{G}</style>
      <div style={{maxWidth:760,margin:"0 auto"}} className="fade" ref={topRef}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:32,flexWrap:"wrap",gap:16}}>
          <div>
            <div style={{fontSize:10,letterSpacing:".18em",color:"var(--accent)",marginBottom:6}}>{t('resultLabel')}</div>
            <h2 style={{fontFamily:"'Outfit',sans-serif",fontSize:26,fontWeight:800,whiteSpace:"pre-line"}}>
              {t('resultTitle', { name: pickedProp?.name ?? '' })}
            </h2>
          </div>
          <div style={{display:"flex",gap:10}}>
            <button className="btn btn-p"
              onClick={()=>{navigator.clipboard.writeText(result?.claude_md||"");setCopied(true);setTimeout(()=>setCopied(false),2000);}}
              style={{background:copied?"#059669":undefined}}>
              {copied?t('copyDone'):t('copy')}
            </button>
            <button className="btn btn-g" onClick={()=>{setPhase("intro");setAnswers({genre:"",platform:"",scale:"",priority:""});setProposals([]);setPickedProp(null);setResult(null);}}>
              {t('restart')}
            </button>
          </div>
        </div>

        <ScoreRing score={result?.score||95} label={t('scoreLabel')}/>

        {result?.tech_rationale&&(
          <div style={{border:"1px solid rgba(99,102,241,.3)",background:"rgba(99,102,241,.06)",
            borderRadius:10,padding:"16px 20px",marginBottom:20}}>
            <div style={{fontSize:10,color:"var(--accent)",letterSpacing:".12em",marginBottom:8}}>{t('techRationale')}</div>
            <p style={{color:"#c0c0d8",fontSize:13,lineHeight:1.85}}>{result.tech_rationale}</p>
          </div>
        )}

        <div className="codebox">{result?.claude_md}</div>
        <p style={{color:"var(--dimmed)",fontSize:11,marginTop:14,textAlign:"center",fontFamily:"'JetBrains Mono',monospace"}}>
          {t('saveInstruction')} <code style={{color:"var(--accent2)"}}>CLAUDE.md</code> {t('saveInstructionSuffix')}
        </p>
      </div>
    </div>
  );

  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// PAGE WRAPPER COMPONENT
// ─────────────────────────────────────────────────────────────────────────────
interface PageWrapProps {
  topRef: React.RefObject<HTMLDivElement | null>;
  title: string;
  sub?: string;
  step: number;
  total: number;
  onBack?: () => void;
  onNext?: () => void;
  nextLabel?: string;
  backLabel?: string;
  canNext?: boolean;
  children: React.ReactNode;
}

function PageWrap({topRef,title,sub,step,total,onBack,onNext,nextLabel,backLabel,canNext=true,children}: PageWrapProps){
  const progress = ((step-1)/total)*100;
  return(
    <div style={{minHeight:"100vh",background:"var(--bg)",padding:"40px 20px",fontFamily:"'Outfit',sans-serif"}}>
      <style>{G}</style>
      <div style={{maxWidth:680,margin:"0 auto"}} className="fade" ref={topRef}>
        {/* Progress */}
        <div style={{marginBottom:36}}>
          <div style={{display:"flex",justifyContent:"space-between",fontSize:11,
            color:"var(--muted)",marginBottom:10,fontFamily:"'JetBrains Mono',monospace"}}>
            <span style={{color:"var(--accent)",letterSpacing:".1em"}}>STEP {step} / {total}</span>
            <span>{Math.round(progress)}%</span>
          </div>
          <div className="prog"><div className="prog-f" style={{width:`${progress}%`}}/></div>
        </div>

        {/* Title */}
        <h2 style={{fontFamily:"'Outfit',sans-serif",fontSize:26,fontWeight:800,
          lineHeight:1.3,marginBottom:sub?6:28,whiteSpace:"pre-line"}}>
          {title}
        </h2>
        {sub&&<p style={{color:"var(--muted)",fontSize:12,marginBottom:24}}>{sub}</p>}

        {children}

        {/* Nav (only shown if onNext provided) */}
        {onNext&&(
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            {onBack
              ? <button className="btn btn-g" onClick={onBack}>{backLabel || "← Back"}</button>
              : <span/>}
            <button className="btn btn-p" onClick={onNext} disabled={!canNext}>
              {nextLabel||"Next →"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
