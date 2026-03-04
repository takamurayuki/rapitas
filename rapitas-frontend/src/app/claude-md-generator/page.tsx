'use client';

import { useState, useEffect, useRef } from "react";

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
// DATA – genres & sub-genres
// ─────────────────────────────────────────────────────────────────────────────
const GENRES = [
  {id:"game",      icon:"🎮", label:"ゲーム"},
  {id:"sns",       icon:"💬", label:"SNS・コミュニティ"},
  {id:"ecommerce", icon:"🛍", label:"EC・販売"},
  {id:"saas",      icon:"💼", label:"業務SaaS・管理ツール"},
  {id:"media",     icon:"📰", label:"メディア・ブログ"},
  {id:"health",    icon:"🏋", label:"ヘルス・習慣管理"},
  {id:"finance",   icon:"💰", label:"家計・資産管理"},
  {id:"edu",       icon:"📚", label:"学習・教育"},
  {id:"ai_tool",   icon:"🤖", label:"AIツール・自動化"},
  {id:"creative",  icon:"🎨", label:"クリエイティブ制作"},
  {id:"map",       icon:"🗺", label:"地図・位置情報"},
  {id:"util",      icon:"🔧", label:"ユーティリティ・生産性"},
];

const SUB_GENRES: Record<string, {id: string; icon: string; label: string; desc: string}[]> = {
  game:[
    {id:"rpg",       icon:"⚔️",  label:"RPG",              desc:"レベルアップ・クエスト・ストーリー"},
    {id:"action",    icon:"💥",  label:"アクション",        desc:"リアルタイム操作・コンボ・爽快感"},
    {id:"shooting",  icon:"🔫",  label:"シューティング",    desc:"弾幕・FPS・TPS"},
    {id:"fighting",  icon:"🥊",  label:"格闘",              desc:"1対1・コンボ・キャラ対戦"},
    {id:"strategy",  icon:"♟",  label:"ストラテジー",       desc:"ターン制・リアルタイム戦略・内政"},
    {id:"puzzle",    icon:"🧩",  label:"パズル",            desc:"マッチ3・ロジック・物理演算"},
    {id:"simulation",icon:"🏙",  label:"シミュレーション",  desc:"街作り・農業・経営・育成"},
    {id:"adventure", icon:"🌍",  label:"アドベンチャー",    desc:"探索・謎解き・ノベル"},
    {id:"sports",    icon:"⚽",  label:"スポーツ",          desc:"サッカー・野球・レース"},
    {id:"card",      icon:"🃏",  label:"カード・ボード",    desc:"TCG・麻雀・デッキ構築"},
    {id:"idle",      icon:"⏱",  label:"放置・クリッカー",  desc:"自動進行・インフレ数値"},
    {id:"rhythm",    icon:"🎵",  label:"音楽・リズム",      desc:"タイミング・譜面・楽曲"},
  ],
  sns:[
    {id:"micro",     icon:"🐦",  label:"マイクロブログ",    desc:"短文投稿・タイムライン"},
    {id:"photo",     icon:"📸",  label:"フォト共有",        desc:"画像中心・フィルター・探索"},
    {id:"video",     icon:"🎬",  label:"動画共有",          desc:"ショート動画・長尺・ライブ"},
    {id:"forum",     icon:"💭",  label:"掲示板・Q&A",       desc:"スレッド・投票・回答"},
    {id:"dating",    icon:"❤️",  label:"マッチング",        desc:"プロフィール・いいね・チャット"},
    {id:"local",     icon:"📍",  label:"地域コミュニティ",  desc:"近所・イベント・掲示板"},
    {id:"interest",  icon:"🔖",  label:"趣味・興味別",      desc:"グループ・タグ・ニッチ"},
    {id:"pro",       icon:"👔",  label:"プロフェッショナル",desc:"LinkedIn型・ポートフォリオ"},
  ],
  ecommerce:[
    {id:"b2c",       icon:"🏪",  label:"BtoC物販",          desc:"商品一覧・カート・配送"},
    {id:"b2b",       icon:"🏭",  label:"BtoB卸・発注",      desc:"企業間取引・請求・在庫"},
    {id:"c2c",       icon:"🤝",  label:"フリマ・C2C",       desc:"個人間売買・評価・手数料"},
    {id:"subscription",icon:"🔄",label:"サブスクリプション",desc:"定期配送・プラン管理"},
    {id:"digital",   icon:"💾",  label:"デジタルコンテンツ",desc:"画像・音楽・ソフト販売"},
    {id:"auction",   icon:"🔨",  label:"オークション",      desc:"入札・終了時間・自動落札"},
    {id:"food",      icon:"🍔",  label:"フードデリバリー",  desc:"レストラン・注文・配達追跡"},
    {id:"ticket",    icon:"🎟",  label:"チケット・予約",    desc:"座席・日程・QRコード"},
  ],
  saas:[
    {id:"crm",       icon:"👥",  label:"CRM・顧客管理",     desc:"商談・パイプライン・履歴"},
    {id:"pm",        icon:"📋",  label:"プロジェクト管理",  desc:"タスク・カンバン・ガント"},
    {id:"hr",        icon:"🏢",  label:"HR・勤怠管理",      desc:"勤務記録・申請・給与"},
    {id:"accounting",icon:"📊",  label:"会計・請求書",      desc:"仕訳・請求・経費精算"},
    {id:"helpdesk",  icon:"🎧",  label:"ヘルプデスク",      desc:"チケット・FAQ・チャット"},
    {id:"analytics", icon:"📈",  label:"分析・BI",          desc:"KPI・グラフ・レポート"},
    {id:"cms",       icon:"📝",  label:"CMS・コンテンツ管理",desc:"記事・メディア・ワークフロー"},
    {id:"inventory", icon:"📦",  label:"在庫・倉庫管理",    desc:"入出庫・ロット・棚卸し"},
  ],
  media:[
    {id:"blog",      icon:"✍️",  label:"ブログ",            desc:"記事・カテゴリ・SEO"},
    {id:"news",      icon:"📰",  label:"ニュース",          desc:"速報・カテゴリ・プッシュ通知"},
    {id:"podcast",   icon:"🎙",  label:"ポッドキャスト",    desc:"エピソード・再生・チャプター"},
    {id:"newsletter",icon:"📧",  label:"ニュースレター",    desc:"購読・配信・メトリクス"},
    {id:"wiki",      icon:"📖",  label:"Wiki・ナレッジベース",desc:"編集・バージョン・検索"},
    {id:"review",    icon:"⭐",  label:"レビュー・評価",    desc:"星評価・コメント・ランキング"},
  ],
  health:[
    {id:"workout",   icon:"💪",  label:"筋トレ・運動記録", desc:"セット・重量・グラフ"},
    {id:"diet",      icon:"🥗",  label:"食事・カロリー管理",desc:"食品検索・栄養素・PFCバランス"},
    {id:"sleep",     icon:"😴",  label:"睡眠トラッキング", desc:"就寝・起床・質のスコア"},
    {id:"mental",    icon:"🧘",  label:"メンタル・瞑想",   desc:"気分記録・マインドフルネス"},
    {id:"habit",     icon:"✅",  label:"習慣トラッカー",   desc:"チェックイン・連続日数・通知"},
    {id:"medical",   icon:"🏥",  label:"医療・服薬管理",   desc:"診察記録・薬リマインド"},
  ],
  finance:[
    {id:"kakeibo",   icon:"📒",  label:"家計簿",            desc:"収支入力・カテゴリ・グラフ"},
    {id:"invest",    icon:"📈",  label:"投資管理",          desc:"ポートフォリオ・損益・銘柄"},
    {id:"crypto",    icon:"🪙",  label:"仮想通貨",          desc:"ウォレット・取引・チャート"},
    {id:"budget",    icon:"💵",  label:"予算管理",          desc:"目標・支出アラート・達成率"},
    {id:"split",     icon:"🍕",  label:"割り勘・精算",      desc:"グループ・負債管理・送金"},
    {id:"tax",       icon:"🧾",  label:"確定申告・税務",    desc:"経費・控除・書類生成"},
  ],
  edu:[
    {id:"course",    icon:"🎓",  label:"オンラインコース", desc:"動画・テキスト・進捗"},
    {id:"quiz",      icon:"❓",  label:"クイズ・テスト",   desc:"問題・正誤・解説"},
    {id:"flashcard", icon:"🗂",  label:"フラッシュカード", desc:"暗記・スペーシング・復習"},
    {id:"language",  icon:"🌐",  label:"語学学習",         desc:"単語・会話・発音判定"},
    {id:"coding",    icon:"💻",  label:"プログラミング学習",desc:"エディタ・課題・採点"},
    {id:"kids",      icon:"👶",  label:"子ども向け教育",   desc:"アニメ・ゲーム要素・保護者管理"},
    {id:"lms",       icon:"🏫",  label:"LMS（学習管理）",  desc:"クラス・課題・成績管理"},
  ],
  ai_tool:[
    {id:"chatbot",   icon:"💬",  label:"チャットボット",   desc:"会話AI・FAQ・カスタマー対応"},
    {id:"writing",   icon:"✍️",  label:"文章生成・編集",   desc:"ライティング補助・要約・翻訳"},
    {id:"image_gen", icon:"🖼",  label:"画像生成",         desc:"プロンプト・スタイル・履歴"},
    {id:"code_gen",  icon:"⌨️",  label:"コード生成・補助", desc:"補完・レビュー・デバッグ支援"},
    {id:"data_anal", icon:"📊",  label:"データ分析・可視化",desc:"CSV・グラフ・インサイト抽出"},
    {id:"voice",     icon:"🎤",  label:"音声認識・合成",   desc:"文字起こし・読み上げ・コマンド"},
    {id:"automation",icon:"⚙️",  label:"業務自動化",       desc:"ワークフロー・スクレイピング・RPA"},
    {id:"search",    icon:"🔍",  label:"AI検索・RAG",      desc:"ドキュメント・ベクトル検索"},
  ],
  creative:[
    {id:"design",    icon:"🎨",  label:"グラフィックデザイン",desc:"テンプレート・SVG・エクスポート"},
    {id:"music",     icon:"🎵",  label:"音楽制作・DAW",    desc:"シーケンサー・音源・ミックス"},
    {id:"video_edit",icon:"🎬",  label:"動画編集",         desc:"タイムライン・カット・エフェクト"},
    {id:"3d",        icon:"🧊",  label:"3Dモデリング",     desc:"メッシュ・テクスチャ・レンダリング"},
    {id:"photo_edit",icon:"📸",  label:"写真編集",         desc:"レタッチ・フィルター・RAW現像"},
    {id:"writing2",  icon:"📖",  label:"小説・脚本執筆",   desc:"章管理・登場人物・プロット"},
  ],
  map:[
    {id:"navigation",icon:"🧭",  label:"ナビ・経路案内",   desc:"リアルタイム位置・ルート計算"},
    {id:"spot",      icon:"📍",  label:"スポット共有",     desc:"投稿・写真・レビュー"},
    {id:"delivery",  icon:"🚚",  label:"配達・物流追跡",   desc:"ドライバー・荷物・ETA"},
    {id:"geofence",  icon:"📡",  label:"エリア通知",       desc:"入退場・プッシュ・イベント"},
    {id:"tourism",   icon:"🏖",  label:"観光・旅行計画",   desc:"スケジュール・モデルルート"},
  ],
  util:[
    {id:"todo",      icon:"✅",  label:"ToDo・タスク管理", desc:"リスト・期限・優先度"},
    {id:"note",      icon:"📝",  label:"メモ・ノート",     desc:"テキスト・タグ・検索"},
    {id:"calendar",  icon:"📅",  label:"カレンダー・予定", desc:"イベント・通知・共有"},
    {id:"timer",     icon:"⏱",  label:"タイマー・計測",   desc:"ポモドーロ・インターバル"},
    {id:"password",  icon:"🔐",  label:"パスワード管理",   desc:"暗号化・生成・共有"},
    {id:"file",      icon:"📁",  label:"ファイル管理・共有",desc:"クラウド・同期・権限"},
    {id:"translate", icon:"🌐",  label:"翻訳・辞書",       desc:"多言語・オフライン・音声"},
    {id:"qr",        icon:"📱",  label:"QR・バーコード",   desc:"生成・読取・履歴"},
  ],
};

const ELEMENTS = [
  {id:"multiplayer", icon:"👥", label:"マルチプレイヤー・対戦"},
  {id:"realtime",    icon:"⚡", label:"リアルタイム同期"},
  {id:"auth",        icon:"🔐", label:"会員登録・ログイン"},
  {id:"payment",     icon:"💳", label:"決済・課金・サブスク"},
  {id:"ai",          icon:"🤖", label:"AI・機械学習"},
  {id:"notification",icon:"🔔", label:"プッシュ通知"},
  {id:"offline",     icon:"📵", label:"オフライン対応"},
  {id:"social",      icon:"💬", label:"コメント・いいね・フォロー"},
  {id:"analytics",   icon:"📊", label:"分析・ダッシュボード"},
  {id:"upload",      icon:"📁", label:"ファイル・画像アップロード"},
  {id:"map_feat",    icon:"🗺", label:"地図・位置情報"},
  {id:"search_feat", icon:"🔍", label:"全文検索"},
  {id:"admin",       icon:"🛠", label:"管理画面"},
  {id:"api_feat",    icon:"🔌", label:"外部API連携"},
  {id:"multilang",   icon:"🌍", label:"多言語対応"},
  {id:"dark_mode",   icon:"🌙", label:"ダークモード"},
  {id:"pwa",         icon:"📲", label:"PWA（アプリのように動く）"},
  {id:"export",      icon:"📤", label:"データエクスポート・帳票"},
  {id:"subscription_feat",icon:"🔄",label:"サブスクリプション管理"},
  {id:"ranking",     icon:"🏆", label:"ランキング・リーダーボード"},
];

const PLATFORMS = [
  {id:"web",        icon:"🌐", label:"Webブラウザ",     desc:"PCやスマホのブラウザで動く"},
  {id:"ios",        icon:"🍎", label:"iOS",              desc:"iPhone / iPad アプリ"},
  {id:"android",    icon:"🤖", label:"Android",          desc:"Android アプリ"},
  {id:"mobile",     icon:"📲", label:"iOS + Android両方",desc:"スマホアプリ両対応"},
  {id:"desktop",    icon:"🖥", label:"デスクトップ",     desc:"Windows / Mac アプリ"},
  {id:"web_mobile", icon:"🔀", label:"Web + スマホ全対応",desc:"ブラウザ + ネイティブアプリ"},
];

const SCALES = [
  {id:"solo",  icon:"🧑", label:"自分だけ",  desc:"個人利用"},
  {id:"small", icon:"👨‍👩‍👧", label:"〜100人",  desc:"小規模"},
  {id:"mid",   icon:"🏘", label:"〜1万人",  desc:"中規模"},
  {id:"large", icon:"🌏", label:"1万人以上", desc:"大規模"},
];

const PRIORITIES = [
  {id:"speed",    icon:"⚡", label:"速く作る",      desc:"MVP・プロトタイプ優先"},
  {id:"quality",  icon:"🏆", label:"品質・保守性",  desc:"長期運用を見据える"},
  {id:"scale",    icon:"📈", label:"スケール重視",  desc:"急成長に備える"},
  {id:"security", icon:"🔒", label:"セキュリティ",  desc:"金融・医療・個人情報"},
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

async function proposeApps(answers: AppAnswers) {
  const genre = GENRES.find(g=>g.id===answers.genre)?.label || answers.genre;
  const subs  = (answers.subs||[]).map((id: string)=>SUB_GENRES[answers.genre]?.find(s=>s.id===id)?.label).filter(Boolean).join("、");
  const elems = (answers.elements||[]).map((id: string)=>ELEMENTS.find(e=>e.id===id)?.label).filter(Boolean).join("、");
  const plat  = PLATFORMS.find(p=>p.id===answers.platform)?.label || "";
  const scale = SCALES.find(s=>s.id===answers.scale)?.label || "";
  const prio  = PRIORITIES.find(p=>p.id===answers.priority)?.label || "";

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

async function generateClaudeMd(answers: AppAnswers, proposal: AppProposal) {
  const genre = GENRES.find(g=>g.id===answers.genre)?.label || answers.genre;
  const subs  = (answers.subs||[]).map((id: string)=>SUB_GENRES[answers.genre]?.find(s=>s.id===id)?.label).filter(Boolean).join("、");
  const elems = (answers.elements||[]).map((id: string)=>ELEMENTS.find(e=>e.id===id)?.label).filter(Boolean).join("、");
  const plat  = PLATFORMS.find(p=>p.id===answers.platform)?.label || "";
  const scale = SCALES.find(s=>s.id===answers.scale)?.label || "";
  const prio  = PRIORITIES.find(p=>p.id===answers.priority)?.label || "";

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
function ScoreRing({score}: {score: number}){
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
      <div style={{fontSize:11,color:"var(--muted)"}}>Claude Code 実用スコア</div>
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

  // ── INTRO ────────────────────────────────────────────────────────────────
  if(phase==="intro") return(
    <div style={{minHeight:"100vh",background:"var(--bg)",display:"flex",alignItems:"center",justifyContent:"center",padding:"32px 20px"}}>
      <style>{G}</style>
      <div style={{maxWidth:500,width:"100%",textAlign:"center"}} className="fade" ref={topRef}>
        <div style={{display:"inline-flex",alignItems:"center",gap:8,
          border:"1px solid rgba(99,102,241,.35)",borderRadius:100,
          padding:"5px 16px",marginBottom:36,background:"rgba(99,102,241,.07)"}}>
          <span style={{width:6,height:6,borderRadius:"50%",background:"var(--accent)",display:"inline-block"}}/>
          <span style={{fontSize:11,color:"var(--accent2)",letterSpacing:".14em"}}>CLAUDE CODE WIZARD v3</span>
        </div>
        <h1 style={{fontFamily:"'Outfit',sans-serif",fontSize:44,fontWeight:800,
          lineHeight:1.1,letterSpacing:"-.03em",marginBottom:20,
          background:"linear-gradient(135deg, #eeeef5 20%, var(--accent2) 80%)",
          WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent"}}>
          どんなアプリを<br/>作りたいですか？
        </h1>
        <p style={{color:"var(--muted)",fontSize:14,lineHeight:1.9,marginBottom:44}}>
          選択肢を選ぶだけで、AIがアプリの<br/>コンセプトを提案し、<br/>
          <span style={{color:"var(--text)"}}>Claude Codeが迷わず動ける</span><br/>
          完璧な <code style={{color:"var(--accent2)"}}>CLAUDE.md</code> を生成します。
        </p>
        <div style={{display:"flex",flexWrap:"wrap",gap:8,justifyContent:"center",marginBottom:40}}>
          {["ジャンルを深掘り","AI がアプリを提案","技術選定を自動化","Claude Behavior完備"].map(t=>(
            <span key={t} className="tag tag-accent">{t}</span>
          ))}
        </div>
        <button className="btn btn-p" onClick={()=>setPhase("genre")}
          style={{fontSize:16,padding:"15px 48px"}}>はじめる →</button>
      </div>
    </div>
  );

  // ── GENRE ────────────────────────────────────────────────────────────────
  if(phase==="genre") return(
    <PageWrap topRef={topRef} title="大ジャンルを選んでください" sub="近いものを1つ" step={1} total={5}>
      <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:10,marginBottom:36}}>
        {GENRES.map(g=>(
          <div key={g.id} className="card" onClick={()=>go("sub",{genre:g.id,subs:[],elements:[]})}>
            <div style={{fontSize:24,marginBottom:6}}>{g.icon}</div>
            <div style={{fontSize:14,fontWeight:600}}>{g.label}</div>
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
        title={`「${GENRES.find(g=>g.id===answers.genre)?.label}」の\nどんな種類ですか？`}
        sub="複数選択OK（なければスキップ）" step={2} total={5}
        onBack={()=>setPhase("genre")}
        onNext={()=>setPhase("elements")}
        nextLabel="次へ →" canNext={true}>
        <div style={{display:"grid",gridTemplateColumns:"repeat(2,1fr)",gap:10,marginBottom:32}}>
          {subs.map(s=>{
            const isSel=sel.includes(s.id);
            return(
              <div key={s.id} className={`card ${isSel?"sel":""}`} onClick={()=>toggle(s.id)}>
                <div className="card-checkb">{isSel&&<CheckIcon/>}</div>
                <div style={{flex:1}}>
                  <div style={{fontSize:14,fontWeight:600,display:"flex",alignItems:"center",gap:6}}>
                    <span>{s.icon}</span><span>{s.label}</span>
                  </div>
                  <div style={{fontSize:11,color:"var(--muted)",marginTop:3}}>{s.desc}</div>
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
        title="付け加えたい機能・要素は？"
        sub="複数選択OK（なければスキップ）" step={3} total={5}
        onBack={()=>setPhase("sub")}
        onNext={()=>setPhase("platform")}
        nextLabel="次へ →" canNext={true}>
        <div style={{display:"grid",gridTemplateColumns:"repeat(2,1fr)",gap:10,marginBottom:32}}>
          {ELEMENTS.map(e=>{
            const isSel=sel.includes(e.id);
            return(
              <div key={e.id} className={`card ${isSel?"sel":""}`} onClick={()=>toggle(e.id)}>
                <div className="card-checkb">{isSel&&<CheckIcon/>}</div>
                <div style={{fontSize:14,fontWeight:600,display:"flex",alignItems:"center",gap:6}}>
                  <span>{e.icon}</span><span>{e.label}</span>
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
        const r = await proposeApps(next);
        setProposals(r.proposals||[]);
      }catch{ setProposals([]); }
      setPhase("proposals");
    };

    const canGo = localPlatform && localScale && localPrio;

    return(
      <PageWrap topRef={topRef}
        title="最後にいくつか教えてください" sub="" step={4} total={5}
        onBack={()=>setPhase("elements")}>
        {/* Platform */}
        <div style={{marginBottom:28}}>
          <div style={{fontSize:13,fontWeight:600,color:"var(--muted)",marginBottom:12,letterSpacing:".05em"}}>どこで動かしますか？</div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(2,1fr)",gap:8}}>
            {PLATFORMS.map(p=>{
              const s=localPlatform===p.id;
              return(
                <div key={p.id} className={`card ${s?"sel":""}`} onClick={()=>setLocalPlatform(p.id)}>
                  <div className="card-check">{s&&<DotIcon/>}</div>
                  <div>
                    <div style={{fontSize:13,fontWeight:600}}>{p.icon} {p.label}</div>
                    <div style={{fontSize:11,color:"var(--muted)"}}>{p.desc}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Scale */}
        <div style={{marginBottom:28}}>
          <div style={{fontSize:13,fontWeight:600,color:"var(--muted)",marginBottom:12,letterSpacing:".05em"}}>利用者規模の想定は？</div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(2,1fr)",gap:8}}>
            {SCALES.map(s=>{
              const sel2=localScale===s.id;
              return(
                <div key={s.id} className={`card ${sel2?"sel":""}`} onClick={()=>setLocalScale(s.id)}>
                  <div className="card-check">{sel2&&<DotIcon/>}</div>
                  <div>
                    <div style={{fontSize:13,fontWeight:600}}>{s.icon} {s.label}</div>
                    <div style={{fontSize:11,color:"var(--muted)"}}>{s.desc}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Priority */}
        <div style={{marginBottom:36}}>
          <div style={{fontSize:13,fontWeight:600,color:"var(--muted)",marginBottom:12,letterSpacing:".05em"}}>開発で最も重視することは？</div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(2,1fr)",gap:8}}>
            {PRIORITIES.map(p=>{
              const s=localPrio===p.id;
              return(
                <div key={p.id} className={`card ${s?"sel":""}`} onClick={()=>setLocalPrio(p.id)}>
                  <div className="card-check">{s&&<DotIcon/>}</div>
                  <div>
                    <div style={{fontSize:13,fontWeight:600}}>{p.icon} {p.label}</div>
                    <div style={{fontSize:11,color:"var(--muted)"}}>{p.desc}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div style={{display:"flex",justifyContent:"space-between"}}>
          <button className="btn btn-g" onClick={()=>setPhase("elements")}>← 戻る</button>
          <button className="btn btn-p" onClick={handleGenerate} disabled={!canGo}>
            AIにアプリを提案してもらう ✦
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
        <h2 style={{fontFamily:"'Outfit',sans-serif",fontSize:22,marginBottom:12}}>アプリを提案中…</h2>
        <p style={{color:"var(--muted)",fontSize:13,lineHeight:1.9}}>選択した要素を組み合わせて<br/>3つのアプリコンセプトを生成しています</p>
      </div>
    </div>
  );

  // ── PROPOSALS ────────────────────────────────────────────────────────────
  if(phase==="proposals"){
    const diffColor = (d: string) => d==="easy"?"var(--green)":d==="medium"?"var(--amber)":"var(--red)";
    const diffLabel = (d: string) => d==="easy"?"初級":d==="medium"?"中級":"上級";
    return(
      <div style={{minHeight:"100vh",background:"var(--bg)",padding:"40px 20px",fontFamily:"'Outfit',sans-serif"}}>
        <style>{G}</style>
        <div style={{maxWidth:680,margin:"0 auto"}} className="fade" ref={topRef}>
          <div style={{marginBottom:32}}>
            <div style={{fontSize:10,letterSpacing:".18em",color:"var(--accent)",marginBottom:8}}>STEP 5 / 5</div>
            <h2 style={{fontFamily:"'Outfit',sans-serif",fontSize:26,fontWeight:800,marginBottom:6}}>
              こんなアプリはどうですか？
            </h2>
            <p style={{color:"var(--muted)",fontSize:13}}>
              あなたの選択から3つのコンセプトを提案しました。気に入ったものを選んでください。
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
                    {(p.tech_hint||[]).map((t)=>(
                      <span key={t} className="tag tag-accent" style={{fontSize:10}}>{t}</span>
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
              proposeApps(answers).then(r=>{setProposals(r.proposals||[]);setPickedProp(null);setPhase("proposals");});
            }}>
              🔄 別の提案を見る
            </button>
            <button className="btn btn-p"
              disabled={!pickedProp}
              onClick={async()=>{
                setPhase("generating");
                try{
                  const r=await generateClaudeMd(answers,pickedProp!);
                  setResult(r);
                }catch{
                  setResult({tech_rationale:"",score:90,claude_md:"エラーが発生しました。"});
                }
                setPhase("result");
              }}>
              このアプリでCLAUDE.mdを生成 →
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
        <h2 style={{fontFamily:"'Outfit',sans-serif",fontSize:22,marginBottom:12}}>CLAUDE.mdを生成中…</h2>
        <div style={{display:"flex",flexDirection:"column",gap:10,marginTop:28,textAlign:"left"}}>
          {["技術スタックを確定中…","アーキテクチャを設計中…","開発コマンドを整備中…","Claude Behaviorを策定中…","スコアを計算中…"].map((t,i)=>(
            <div key={t} style={{display:"flex",alignItems:"center",gap:10,opacity:0,animation:`fadeUp .4s ${i*.25}s both`}}>
              <div style={{width:6,height:6,borderRadius:"50%",background:"var(--accent)",flexShrink:0}}/>
              <span style={{color:"var(--muted)",fontSize:12,fontFamily:"'JetBrains Mono',monospace"}}>{t}</span>
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
            <div style={{fontSize:10,letterSpacing:".18em",color:"var(--accent)",marginBottom:6}}>GENERATED</div>
            <h2 style={{fontFamily:"'Outfit',sans-serif",fontSize:26,fontWeight:800}}>
              「{pickedProp?.name}」の<br/>CLAUDE.md が完成しました
            </h2>
          </div>
          <div style={{display:"flex",gap:10}}>
            <button className="btn btn-p"
              onClick={()=>{navigator.clipboard.writeText(result?.claude_md||"");setCopied(true);setTimeout(()=>setCopied(false),2000);}}
              style={{background:copied?"#059669":undefined}}>
              {copied?"✓ コピー完了":"コピー"}
            </button>
            <button className="btn btn-g" onClick={()=>{setPhase("intro");setAnswers({genre:"",platform:"",scale:"",priority:""});setProposals([]);setPickedProp(null);setResult(null);}}>
              最初から
            </button>
          </div>
        </div>

        <ScoreRing score={result?.score||95}/>

        {result?.tech_rationale&&(
          <div style={{border:"1px solid rgba(99,102,241,.3)",background:"rgba(99,102,241,.06)",
            borderRadius:10,padding:"16px 20px",marginBottom:20}}>
            <div style={{fontSize:10,color:"var(--accent)",letterSpacing:".12em",marginBottom:8}}>💡 技術選定の理由</div>
            <p style={{color:"#c0c0d8",fontSize:13,lineHeight:1.85}}>{result.tech_rationale}</p>
          </div>
        )}

        <div className="codebox">{result?.claude_md}</div>
        <p style={{color:"var(--dimmed)",fontSize:11,marginTop:14,textAlign:"center",fontFamily:"'JetBrains Mono',monospace"}}>
          プロジェクトルートに <code style={{color:"var(--accent2)"}}>CLAUDE.md</code> として保存してください
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
  canNext?: boolean;
  children: React.ReactNode;
}

function PageWrap({topRef,title,sub,step,total,onBack,onNext,nextLabel,canNext=true,children}: PageWrapProps){
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
              ? <button className="btn btn-g" onClick={onBack}>← 戻る</button>
              : <span/>}
            <button className="btn btn-p" onClick={onNext} disabled={!canNext}>
              {nextLabel||"次へ →"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}