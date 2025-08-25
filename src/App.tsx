import React, { useMemo, useState, useEffect, useRef } from "react";

// 초등학생용 색깔 혼합 실험 웹 앱 v2.2
// - 레이아웃: 왼쪽 큰 혼합 캔버스 / 오른쪽 상단 기본색 방울 / 아래 미세조절·사용팁 (초기 UI)
// - 목표 색: 64색 팝업 팔레트(중복 없음, 균등 분포)
// - 색 이름: 더욱 다양하게(코랄/살몬/복숭아/머스터드/올리브/카키/옥색/터키석/로열 블루/인디고/라일락/연보라/마젠타/버건디/와인 등)
// - 혼합 로직: 무채색(하양·검정)의 Hue 영향 제거(s로만 가중) → 파랑+하양=하늘색
// - 정답 모드: 유사도 ≥ 90%면 축하 오버레이 + 컨페티 + 효과음
// - ★신규: 정답 시 "최적 조합 추천"(동일 혼합 로직으로 계산) + 바로 적용 버튼, 대체 조합 2개

const BASE_COLORS = [
  { key: "red", name: "빨강", hex: "#FF0000" },
  { key: "yellow", name: "노랑", hex: "#FFFF00" },
  { key: "blue", name: "파랑", hex: "#0066FF" },
  { key: "white", name: "하양", hex: "#FFFFFF" },
  { key: "black", name: "검정", hex: "#000000" },
] as const;

type ColorKey = typeof BASE_COLORS[number]["key"];

function hexToRgb(hex: string) {
  const h = hex.replace("#", "");
  const bigint = parseInt(h, 16);
  const r = (bigint >> 16) & 255;
  const g = (bigint >> 8) & 255;
  const b = bigint & 255;
  return { r, g, b };
}

function rgbToHex(r: number, g: number, b: number) {
  const toHex = (v: number) => v.toString(16).padStart(2, "0");
  return `#${toHex(Math.round(r))}${toHex(Math.round(g))}${toHex(Math.round(b))}`.toUpperCase();
}

function rgbToHsl(r: number, g: number, b: number) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0, l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h /= 6;
  }
  return { h: h * 360, s, l };
}

function hslToRgb(h: number, s: number, l: number) {
  h /= 360;
  let r: number, g: number, b: number;
  if (s === 0) {
    r = g = b = l; // 무채색
  } else {
    const hue2rgb = (p: number, q: number, t: number) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }
  return { r: Math.round(r * 255), g: Math.round(g * 255), b: Math.round(b * 255) };
}

function colorDistanceRGB(a: { r: number; g: number; b: number }, b: { r: number; g: number; b: number }) {
  const dr = a.r - b.r, dg = a.g - b.g, db = a.b - b.b;
  return Math.sqrt(dr * dr + dg * dg + db * db); // 0 ~ 441.67
}

// ---- 공통 혼합 로직(훅/추천용 동일) ----
function mixFromWeights(weights: Record<ColorKey, number>) {
  const total = (Object.keys(weights) as ColorKey[]).reduce((acc, k) => acc + (weights[k] || 0), 0);
  if (total === 0) {
    const rgb0 = { r: 245, g: 245, b: 245 };
    const hsl0 = rgbToHsl(rgb0.r, rgb0.g, rgb0.b);
    return { hex: "#F5F5F5", rgb: rgb0, hsl: hsl0 };
  }
  let x = 0, y = 0; // hue 벡터
  let sumS = 0, sumL = 0, sumW = 0, sumWS = 0;
  BASE_COLORS.forEach(({ key, hex }) => {
    const w = weights[key] || 0;
    if (w <= 0) return;
    const { r, g, b } = hexToRgb(hex);
    const { h, s, l } = rgbToHsl(r, g, b);
    const rad = (h * Math.PI) / 180;
    const sWeight = s; // 무채색의 hue 영향 제거
    x += Math.cos(rad) * w * sWeight;
    y += Math.sin(rad) * w * sWeight;
    sumS += s * w;
    sumL += l * w;
    sumW += w;
    sumWS += w * sWeight;
  });
  let h = 0;
  if (sumWS > 0) {
    h = (Math.atan2(y, x) * 180) / Math.PI;
    if (h < 0) h += 360;
  }
  const s = sumS / sumW;
  const l = sumL / sumW;
  const rgb = hslToRgb(h, s, l);
  const hex = rgbToHex(rgb.r, rgb.g, rgb.b);
  return { hex, rgb, hsl: { h, s, l } };
}

// 색 이름(아주 다양하게)
function nameColor(h: number, s: number, l: number) {
  // 무채색 계열
  if (l < 0.08) return "검정";
  if (l > 0.94) return "하양";
  if (s < 0.10) {
    if (l < 0.32) return "진한 회색";
    if (l > 0.78) return "연한 회색";
    return "회색";
  }
  // 특수 감지
  const hue = (h + 360) % 360;
  if (hue >= 15 && hue < 50 && l < 0.58 && s > 0.2) return "갈색";
  if (hue >= 55 && hue < 95 && s < 0.35 && l >= 0.32 && l <= 0.6) return l < 0.46 ? "카키" : "올리브";
  if ((hue >= 350 || hue < 10) && l < 0.35) return "버건디";
  if (hue >= 330 && hue < 350 && l < 0.42) return "와인";
  // 기본 Hue 이름대(세분화)
  let base = "";
  if (hue < 10 || hue >= 350) base = "빨강";
  else if (hue < 20) base = "주홍";
  else if (hue < 27) base = "코랄";
  else if (hue < 33) base = "살몬";
  else if (hue < 40) base = "주황";
  else if (hue < 48) base = "복숭아";
  else if (hue < 56) base = "노랑";
  else if (hue < 64) base = "머스터드";
  else if (hue < 74) base = "라임";
  else if (hue < 88) base = "연두";
  else if (hue < 110) base = "초록";
  else if (hue < 135) base = "청록";
  else if (hue < 155) base = "옥색";
  else if (hue < 172) base = "민트";
  else if (hue < 186) base = "터키석";
  else if (hue < 200) base = "청록빛 하늘";
  else if (hue < 208) base = "하늘";
  else if (hue < 220) base = "파랑";
  else if (hue < 232) base = "로열 블루";
  else if (hue < 242) base = "푸른 파랑";
  else if (hue < 252) base = "남색";
  else if (hue < 265) base = "남보라";
  else if (hue < 280) base = "보라";
  else if (hue < 292) base = "연보라";
  else if (hue < 305) base = "라일락";
  else if (hue < 318) base = "마젠타";
  else if (hue < 332) base = "자홍";
  else base = "분홍";
  // 밝기 수식어
  let prefix = "";
  if (l > 0.9) prefix = "아주 연한 ";
  else if (l > 0.8) prefix = "연한 ";
  else if (l < 0.18) prefix = "아주 진한 ";
  else if (l < 0.3) prefix = "진한 ";
  // 채도 낮을 때 회색빛 수식
  let suffix = "";
  if (s < 0.22 && l >= 0.18 && l <= 0.9) suffix = " (회색빛)";
  return `${prefix}${base}${suffix}`.trim();
}

// 혼합 색 계산 훅(이름까지)
function useMixedColor(weights: Record<ColorKey, number>) {
  return useMemo(() => {
    const mix = mixFromWeights(weights);
    return { ...mix, name: nameColor(mix.hsl.h, mix.hsl.s, mix.hsl.l) };
  }, [weights]);
}

// 64색 목표 팔레트: 8 Hue × 8 Lightness
function useSixtyFourChips() {
  return useMemo(() => {
    const chips: string[] = [];
    const hueCount = 8; // 0,45,90,...,315
    const lights = [0.28, 0.36, 0.44, 0.52, 0.60, 0.68, 0.76, 0.84];
    for (let i = 0; i < hueCount; i++) {
      const h = (i * 360) / hueCount;
      for (let j = 0; j < lights.length; j++) {
        const l = lights[j];
        const s = j >= lights.length - 1 ? 0.6 : 0.75; // 가장 밝은 줄은 채도 살짝 낮춤
        const { r, g, b } = hslToRgb(h, s, l);
        chips.push(rgbToHex(r, g, b));
      }
    }
    return chips; // 64색
  }, []);
}

// 최대 방울 수 내에서(기본 8) 비음수 정수 조합을 모두 탐색하여 목표색과의 거리가 최소인 상위 K개 레시피 반환
function findBestRecipes(targetRgb: { r: number; g: number; b: number }, maxDrops = 8, topK = 3) {
  const keys: ColorKey[] = ["red", "yellow", "blue", "white", "black"];
  type Recipe = { weights: Record<ColorKey, number>; diff: number; pct: number };
  const results: Recipe[] = [];

  const pushIfBetter = (w: Record<ColorKey, number>) => {
    const mix = mixFromWeights(w);
    const d = colorDistanceRGB(mix.rgb, targetRgb);
    const pct = Math.max(0, 100 - Math.min(100, (d / 441.67) * 100));
    results.push({ weights: w, diff: d, pct });
  };

  const enumerate = (idx: number, left: number, cur: number[]) => {
    if (idx === keys.length - 1) {
      cur[idx] = left;
      const w: Record<ColorKey, number> = {
        red: cur[0] || 0, yellow: cur[1] || 0, blue: cur[2] || 0, white: cur[3] || 0, black: cur[4] || 0,
      };
      pushIfBetter(w);
      return;
    }
    for (let v = 0; v <= left; v++) {
      cur[idx] = v;
      enumerate(idx + 1, left - v, cur);
    }
  };

  for (let k = 1; k <= maxDrops; k++) {
    enumerate(0, k, [0, 0, 0, 0, 0]);
  }

  results.sort((a, b) => {
    if (a.diff !== b.diff) return a.diff - b.diff;
    const nzA = a.weights.white + a.weights.black;
    const nzB = b.weights.white + b.weights.black;
    return nzA - nzB;
  });
  return results.slice(0, topK);
}

export default function ColorMixLabV2() {
  const [weights, setWeights] = React.useState<Record<ColorKey, number>>({
    red: 0, yellow: 0, blue: 0, white: 0, black: 0,
  });
  const [history, setHistory] = React.useState<ColorKey[]>([]);
  const mix = useMixedColor(weights);

  const chips64 = useSixtyFourChips();
  const [chipsOpen, setChipsOpen] = React.useState(false);
  const [targetHex, setTargetHex] = React.useState<string>("#4CAF50");
  const targetRgb = React.useMemo(() => hexToRgb(targetHex), [targetHex]);
  const diff = React.useMemo(() => colorDistanceRGB(mix.rgb, targetRgb), [mix, targetRgb]);
  const diffPct = Math.max(0, 100 - Math.min(100, (diff / 441.67) * 100));

  const [answerMode, setAnswerMode] = React.useState(true);
  const [success, setSuccess] = React.useState(false);
  const [successFired, setSuccessFired] = React.useState(false);

  const bestRecipes = React.useMemo(() => findBestRecipes(targetRgb, 8, 3), [targetRgb]);

  const totalDrops = (Object.keys(weights) as ColorKey[]).reduce((acc, k) => acc + (weights[k] || 0), 0);

  const addDrop = (key: ColorKey) => {
    setWeights((prev) => ({ ...prev, [key]: (prev[key] || 0) + 1 }));
    setHistory((h) => [...h, key]);
  };
  const removeDrop = (key: ColorKey) => {
    setWeights((prev) => ({ ...prev, [key]: Math.max(0, (prev[key] || 0) - 1) }));
  };
  const undo = () => {
    setHistory((h) => {
      if (h.length === 0) return h;
      const last = h[h.length - 1];
      setWeights((prev) => ({ ...prev, [last]: Math.max(0, (prev[last] || 0) - 1) }));
      return h.slice(0, -1);
    });
  };
  const reset = () => {
    setWeights({ red: 0, yellow: 0, blue: 0, white: 0, black: 0 });
    setHistory([]);
    setSuccess(false);
    setSuccessFired(false);
  };

  const pickRandomTarget = () => {
    const idx = Math.floor(Math.random() * chips64.length);
    setTargetHex(chips64[idx]);
    setSuccess(false);
    setSuccessFired(false);
  };

  const confettiRef = React.useRef<HTMLDivElement | null>(null);

  function throwConfetti() {
    const host = confettiRef.current;
    if (!host) return;
    const colors = ["#ffd60a", "#ff7b7b", "#74c0fc", "#63e6be", "#b197fc", "#ffa94d"]; 
    const pieces = 80;
    for (let i = 0; i < pieces; i++) {
      const el = document.createElement("span");
      el.className = "confetti-bit";
      el.style.position = "absolute";
      el.style.top = "-10px";
      el.style.left = Math.random() * 100 + "%";
      el.style.width = Math.random() * 8 + 4 + "px";
      el.style.height = Math.random() * 12 + 6 + "px";
      el.style.background = colors[Math.floor(Math.random() * colors.length)];
      el.style.opacity = "0.9";
      el.style.transform = `rotate(${Math.random() * 360}deg)`;
      const duration = 1200 + Math.random() * 1200;
      el.style.animation = `confetti-fall ${duration}ms ease-out forwards`;
      el.style.borderRadius = "2px";
      host.appendChild(el);
      setTimeout(() => host.removeChild(el), duration + 50);
    }
  }

  function playDing() {
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "sine";
      o.connect(g); g.connect(ctx.destination);
      const now = ctx.currentTime;
      o.frequency.setValueAtTime(740, now);
      o.frequency.setValueAtTime(988, now + 0.12);
      g.gain.setValueAtTime(0.0001, now);
      g.gain.exponentialRampToValueAtTime(0.3, now + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, now + 0.35);
      o.start(now); o.stop(now + 0.4);
    } catch {}
  }

  React.useEffect(() => {
    if (!answerMode) return;
    if (totalDrops > 0 && diffPct >= 90) {
      setSuccess(true);
      if (!successFired) {
        setSuccessFired(true);
        throwConfetti();
        playDing();
      }
    } else {
      setSuccess(false);
    }
  }, [diffPct, totalDrops, answerMode]);

  const applyRecipe = (w: Record<ColorKey, number>) => {
    setWeights({ ...w });
    const h: ColorKey[] = [];
    (Object.keys(w) as ColorKey[]).forEach((k) => {
      for (let i = 0; i < (w[k] || 0); i++) h.push(k);
    });
    setHistory(h);
  };

  const recipeToLabel = (w: Record<ColorKey, number>) => {
    const parts: string[] = [];
    const order: { key: ColorKey; label: string }[] = [
      { key: "red", label: "빨강" },
      { key: "yellow", label: "노랑" },
      { key: "blue", label: "파랑" },
      { key: "white", label: "하양" },
      { key: "black", label: "검정" },
    ];
    order.forEach(({ key, label }) => {
      const v = w[key] || 0;
      if (v > 0) parts.push(`${label} × ${v}`);
    });
    return parts.join(" · ");
  };

  const targetHsl = React.useMemo(() => rgbToHsl(targetRgb.r, targetRgb.g, targetRgb.b), [targetRgb]);
  const lightTip = targetHsl.l > 0.65 ? "너무 밝으면 검정을 아주 조금!" : targetHsl.l < 0.35 ? "너무 어두우면 하양을 조금!" : "밝기는 하양/검정으로 조절해요";
  const satTip = targetHsl.s < 0.25 ? "회색빛이면 원색(빨/노/파)을 한 방울!" : "채도는 원색 방울로 조절해요";

  return (
    <div className="min-h-screen w-full bg-gradient-to-b from-white to-slate-50 text-slate-800 flex items-center justify-center p-4">
      <div className="w-full max-w-6xl">
        <style>{`
          @keyframes confetti-fall {
            0%   { transform: translateY(0) rotate(0deg); }
            100% { transform: translateY(120%) rotate(720deg); opacity: 0.7; }
          }
        `}</style>

        <div className="mb-4 flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
          <div className="space-y-1.5 sm:space-y-2">
            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight leading-tight sm:leading-[1.2]">색깔 혼합 실험실</h1>
            <p className="text-sm sm:text-base text-slate-600 leading-relaxed">왼쪽 큰 캔버스에서 색이 섞여요. 오른쪽 위의 동그란 버튼으로 색 방울을 추가해 보세요!</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={() => setChipsOpen(true)} className="px-3 py-2 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 active:opacity-90">목표 색 고르기 (64색)</button>
            <div className="w-8 h-8 rounded-full border border-slate-300" style={{ backgroundColor: targetHex }} title="현재 목표 색" aria-label="현재 목표 색" />
            <button onClick={pickRandomTarget} className="px-2 py-2 rounded-xl border border-slate-300 bg-white text-xs hover:bg-slate-50">랜덤</button>
            <button onClick={() => setAnswerMode((v) => !v)} className={`px-2 py-2 rounded-xl text-xs border ${answerMode ? "border-emerald-500 text-emerald-700 bg-emerald-50 hover:bg-emerald-100" : "border-slate-300 bg-white"}`}>
              정답 모드: {answerMode ? "켜짐" : "꺼짐"}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-stretch">
          <div className="bg-white shadow-sm rounded-2xl p-4 sm:p-6 border border-slate-100">
            <div className="relative min-h-[260px] sm:min-h-[380px] rounded-2xl border border-slate-200 overflow-hidden">
              <div className="absolute inset-0" style={{ backgroundColor: mix.hex }} aria-label="혼합된 색 보기" />
              <div className="absolute inset-0 bg-[linear-gradient(45deg,_#0000_25%,_#0003_25%_50%,_#0000_50%_75%,_#0003_75%),linear-gradient(45deg,_#0003_25%,_#0000_25%_50%,_#0003_50%_75%,_#0000_75%)] bg-[length:16px_16px] opacity-[0.06]" />
              <div ref={confettiRef} className="absolute inset-0 pointer-events-none" />
              {success && (
                <div className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none">
                  <div className="bg-white/85 backdrop-blur rounded-2xl px-4 py-3 text-center shadow animate-bounce">
                    <div className="text-lg sm:text-xl font-extrabold">목표 색을 만들었습니다! 🎉</div>
                    <div className="text-sm text-slate-600 mt-1">유사도 {diffPct.toFixed(0)}%</div>
                  </div>
                </div>
              )}
              {totalDrops === 0 && !success && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="bg-white/80 backdrop-blur rounded-xl px-4 py-2 text-slate-700 text-sm sm:text-base shadow">
                    오른쪽 위의 색 버튼을 눌러 색 방울을 떨어뜨려 보세요!
                  </div>
                </div>
              )}
            </div>
            <div className="mt-3 flex flex-col gap-2">
              <div className="flex items-center gap-3 whitespace-nowrap">
                <div className="text-base sm:text-lg font-semibold max-w-[55%] sm:max-w-none overflow-hidden text-ellipsis">이 색은 <span className="px-2 py-1 bg-slate-100 rounded-full border border-slate-200">{mix.name}</span> 에 가까워요</div>
                <div className="ml-auto flex items-center gap-2 shrink-0">
                  <span className="text-slate-500 text-sm"><span className="hidden sm:inline">목표 색과의 </span>비슷함</span>
                  <div className="w-8 sm:w-12 md:w-16 lg:w-20 h-2 bg-slate-200 rounded-full overflow-hidden shrink-0" aria-hidden>
                    <div className="h-full bg-emerald-500" style={{ width: `${diffPct.toFixed(0)}%` }} />
                  </div>
                  <span className="w-10 text-right text-slate-700 font-semibold text-sm shrink-0">{diffPct.toFixed(0)}%</span>
                </div>
              </div>
              {success && bestRecipes.length > 0 && (
                <div className="mt-1 bg-emerald-50 border border-emerald-200 text-emerald-900 rounded-xl p-3">
                  <div className="font-bold mb-1">정답 팁 · 최적 조합 추천</div>
                  <div className="flex flex-col gap-1 text-sm">
                    <div>
                      <span className="font-semibold mr-1">최적:</span>
                      <span>{recipeToLabel(bestRecipes[0].weights)}</span>
                      <span className="ml-2 text-emerald-700">(유사도 {bestRecipes[0].pct.toFixed(0)}%)</span>
                      <button onClick={() => applyRecipe(bestRecipes[0].weights)} className="ml-3 px-2 py-0.5 rounded-lg border border-emerald-500 bg-white text-emerald-700 hover:bg-emerald-100">적용</button>
                    </div>
                    {bestRecipes[1] && (
                      <div>
                        <span className="font-semibold mr-1">다른 방법 1:</span>
                        <span>{recipeToLabel(bestRecipes[1].weights)}</span>
                        <span className="ml-2 text-emerald-700">(유사도 {bestRecipes[1].pct.toFixed(0)}%)</span>
                        <button onClick={() => applyRecipe(bestRecipes[1].weights)} className="ml-3 px-2 py-0.5 rounded-lg border border-emerald-500 bg-white text-emerald-700 hover:bg-emerald-100">적용</button>
                      </div>
                    )}
                    {bestRecipes[2] && (
                      <div>
                        <span className="font-semibold mr-1">다른 방법 2:</span>
                        <span>{recipeToLabel(bestRecipes[2].weights)}</span>
                        <span className="ml-2 text-emerald-700">(유사도 {bestRecipes[2].pct.toFixed(0)}%)</span>
                        <button onClick={() => applyRecipe(bestRecipes[2].weights)} className="ml-3 px-2 py-0.5 rounded-lg border border-emerald-500 bg-white text-emerald-700 hover:bg-emerald-100">적용</button>
                      </div>
                    )}
                  </div>
                  <div className="mt-2 text-xs text-emerald-800">
                    팁: {lightTip} · {satTip}
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="bg-white shadow-sm rounded-2xl p-4 sm:p-6 border border-slate-100 flex flex-col">
            <div>
              <h2 className="font-bold text-lg mb-2">기본 색 방울</h2>
              <div className="grid grid-cols-5 gap-3">
                {BASE_COLORS.map(({ key, name, hex }) => (
                  <button
                    key={key}
                    onClick={() => addDrop(key)}
                    className="group relative aspect-square rounded-full border border-slate-200 shadow-sm hover:shadow transition"
                    style={{ backgroundColor: hex }}
                    aria-label={`${name} 색 방울 추가`}
                    title={`${name} 색 방울 추가`}
                  >
                    <div className="absolute inset-0 rounded-full ring-0 group-hover:ring-4 ring-black/10 transition" />
                    {(weights[key] || 0) > 0 && (
                      <span className="absolute -top-1 -right-1 min-w-6 h-6 px-1 flex items-center justify-center text-xs font-bold rounded-full bg-white border border-slate-300 shadow">
                        {weights[key]}
                      </span>
                    )}
                    <span className="sr-only">{name}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-6">
              <h2 className="font-bold text-lg mb-2">미세 조절</h2>
              <div className="space-y-2">
                {BASE_COLORS.map(({ key, name, hex }) => (
                  <div key={key} className="flex items-center gap-2">
                    <div className="w-5 h-5 rounded-full border border-slate-200" style={{ backgroundColor: hex }} aria-hidden />
                    <div className="w-14 text-sm">{name}</div>
                    <div className="flex items-center gap-1">
                      <button onClick={() => removeDrop(key)} className="px-2 py-1 rounded bg-slate-100 border border-slate-200 hover:bg-slate-200 active:opacity-90">-</button>
                      <div className="w-10 text-center font-semibold">{weights[key] || 0}</div>
                      <button onClick={() => addDrop(key)} className="px-2 py-1 rounded bg-slate-800 text-white hover:opacity-90">+</button>
                    </div>
                    <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden ml-2" aria-hidden>
                      <div className="h-full bg-slate-400" style={{ width: totalDrops === 0 ? "0%" : `${((weights[key] || 0) / totalDrops) * 100}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <button onClick={undo} className="px-3 py-2 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 active:opacity-90">되돌리기</button>
              <button onClick={reset} className="px-3 py-2 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 active:opacity-90">초기화</button>
              <button onClick={() => { const w = mixFromWeights(weights); setTargetHex(w.hex); setSuccess(false); setSuccessFired(false); }} className="px-3 py-2 rounded-xl border border-emerald-500 text-emerald-700 bg-emerald-50 hover:bg-emerald-100 active:opacity-90">현재 색을 목표로</button>
            </div>

            <div className="mt-4 text-sm text-slate-600 bg-slate-50 border border-slate-200 rounded-xl p-3">
              <p className="font-semibold mb-1">사용 팁</p>
              <ul className="list-disc pl-5 space-y-1">
                <li>하양은 밝게, 검정은 어둡게 만들어요.</li>
                <li>노랑+파랑 → 초록, 빨강+노랑 → 주황처럼 보여요.</li>
                <li>상단의 <b>목표 색(64색)</b>을 고르고, <b>비슷함</b>을 100%에 가깝게 해 보세요!</li>
                <li><b>정답 모드</b>가 켜져 있으면 유사도 90% 이상에서 축하 효과가 나와요.</li>
              </ul>
            </div>
          </div>
        </div>

        {chipsOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
            <div className="w-full max-w-3xl bg-white rounded-2xl border border-slate-200 shadow-xl p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-bold text-lg">64색 목표 팔레트</h3>
                <div className="flex items-center gap-2">
                  <button onClick={pickRandomTarget} className="px-2 py-1 rounded-lg border border-slate-300 bg-white text-xs hover:bg-slate-50">랜덤</button>
                  <button onClick={() => setChipsOpen(false)} className="px-2 py-1 rounded-lg border border-slate-300 bg-white text-xs hover:bg-slate-50">닫기</button>
                </div>
              </div>
              <div className="grid grid-cols-6 sm:grid-cols-8 gap-2">
                {chips64.map((hex) => (
                  <button
                    key={hex}
                    onClick={() => { setTargetHex(hex); setChipsOpen(false); setSuccess(false); setSuccessFired(false); }}
                    className="aspect-square rounded-full border border-slate-200"
                    style={{ backgroundColor: hex, outline: targetHex === hex ? "3px solid rgba(16,185,129,0.9)" : undefined }}
                    aria-label="목표 색 선택"
                    title="목표 색 선택"
                  />
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
