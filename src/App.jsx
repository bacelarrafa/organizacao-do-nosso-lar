import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import {
  Home, Calendar, Check, Plus, Trash2, Briefcase, Utensils, HeartPulse,
  RefreshCw, ChevronLeft, ChevronRight, ChevronDown, User, X, Flame, TrendingUp,
  Stethoscope, Lightbulb, ArrowRight, Target, Sun, CalendarDays, Pencil, LogOut, Heart, CircleSlash, MoreHorizontal, Cat, Wallet
} from "lucide-react";

const SEED_PEOPLE = {
  rafa: { name: "Rafaela", color: "#4F46A8" },
  lucas: { name: "Lucas", color: "#0E7C61" },
  both: { name: "Juntos", color: "#B06A2C" },
};

// Remove o campo antigo de cargo ("role") das pessoas salvas no banco.
// Na próxima gravação qualquer, o banco já fica limpo.
function cleanPeople(people) {
  if (!people || !Object.keys(people).length) return SEED_PEOPLE;
  const out = {};
  for (const k of Object.keys(people)) {
    const { role, ...rest } = people[k] || {};
    out[k] = rest;
  }
  return out;
}

function softOf(hex) {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  const mix = (c) => Math.round(c + (255 - c) * 0.88);
  return `#${[mix(r), mix(g), mix(b)].map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

const PERSON_COLORS = ["#4F46A8", "#0E7C61", "#B06A2C", "#C04574", "#185FA5", "#7A4DB0", "#2E7D54"];

const DAYS = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];
const DAY_FULL = ["Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado", "Domingo"];

const CATEGORIES = {
  casa: { label: "Casa", icon: Home, color: "#2348A6", soft: "#E3EAFB" },
  saude: { label: "Saúde", icon: HeartPulse, color: "#C7416E", soft: "#FAE6EE" },
  gatos: { label: "Gatos", icon: Cat, color: "#1F8C83", soft: "#DFF2EF" },
  vida: { label: "Vida", icon: Utensils, color: "#C27412", soft: "#FCEFD9" },
};

// Recurring task templates (the "rules" of the routine)
const SEED_TEMPLATES = [
  { id: "t1", title: "Lavar a louça", cat: "casa", who: "lucas", days: [0, 2, 4] },
  { id: "t2", title: "Arrumar a cama", cat: "casa", who: "rafa", days: [0, 1, 2, 3, 4] },
  { id: "t3", title: "Tirar o lixo", cat: "casa", who: "lucas", days: [1, 4] },
  { id: "t4", title: "Cozinhar o jantar", cat: "vida", who: "both", days: [2], flexible: true },
  { id: "t5", title: "Preparar marmitas da semana", cat: "vida", who: "both", days: [6] },
  { id: "t6", title: "Compras da semana", cat: "vida", who: "both", days: [5] },
  { id: "t7", title: "Caminhada juntos", cat: "saude", who: "both", days: [1, 3] },
  { id: "t8", title: "Faxina leve", cat: "casa", who: "rafa", days: [3] },
];

const todayIdx = () => {
  const js = new Date().getDay();
  return js === 0 ? 6 : js - 1;
};

// Monday-anchored week id, e.g. "2026-06-08"
function mondayOf(offset) {
  const d = new Date();
  const js = d.getDay();
  const diff = js === 0 ? -6 : 1 - js;
  d.setDate(d.getDate() + diff + offset * 7);
  d.setHours(0, 0, 0, 0);
  return d;
}
function weekId(offset) {
  const m = mondayOf(offset);
  return `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, "0")}-${String(m.getDate()).padStart(2, "0")}`;
}
function weekLabel(offset) {
  const m = mondayOf(offset);
  const s = new Date(m); const e = new Date(m); e.setDate(e.getDate() + 6);
  const fmt = (x) => `${x.getDate()}/${x.getMonth() + 1}`;
  const rel = offset === 0 ? "Esta semana" : offset === 1 ? "Próxima" : offset === -1 ? "Semana passada" : null;
  return { range: `${fmt(s)} a ${fmt(e)}`, rel };
}

// ---- Versionamento por data ----
// Uma tarefa pode ter várias "versões" com uma data "from" (a partir de quando valem).
// Assim, mudar quem/dias vale só daqui pra frente, e o histórico antigo fica preservado.
// Tarefas antigas (sem "versions") são tratadas como uma versão desde sempre.
function isoDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function addDays(dateStr, n) {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + n);
  return isoDate(d);
}
function todayStr() {
  return isoDate(new Date());
}
function firstFrom(t) {
  if (!t.versions || !t.versions.length) return "0000-00-00";
  return t.versions[0].from || "0000-00-00";
}
// A versão de uma tarefa efetiva numa data (a última cujo "from" <= data).
function verOf(t, dateStr) {
  if (!t.versions || !t.versions.length) return t; // tarefa flat = uma versão desde sempre
  let chosen = t.versions[0];
  for (const v of t.versions) { if ((v.from || "0000-00-00") <= dateStr) chosen = v; }
  return chosen;
}
// Cria/atualiza uma versão a partir de uma data, preservando as anteriores.
function withNewVersion(t, fromDate, fields) {
  let versions;
  if (t.versions && t.versions.length) {
    versions = t.versions.filter((v) => (v.from || "0000-00-00") !== fromDate);
  } else {
    // converte a tarefa flat em versionada, mantendo o passado
    versions = [{ from: "0000-00-00", title: t.title, cat: t.cat, who: t.who, days: t.days, flexible: !!t.flexible, freq: t.freq || "semanal" }];
  }
  versions.push({ from: fromDate, ...fields });
  versions.sort((a, b) => (a.from || "0000-00-00").localeCompare(b.from || "0000-00-00"));
  return { ...metaOf(t), versions };
}
// Metadados da tarefa que não mudam por versão: id, data de término e tipo (rotina ou período).
function metaOf(t) {
  const m = { id: t.id };
  if (t.until) m.until = t.until;
  if (t.kind) m.kind = t.kind;
  return m;
}
// Define ou limpa a data de término (último dia em que a tarefa acontece).
function withUntil(t, until) {
  const next = { ...t };
  if (until) next.until = until; else delete next.until;
  return next;
}
// A tarefa já foi encerrada antes desta data?
function isEnded(t, dateStr) {
  return !!t.until && t.until < dateStr;
}

// Segunda-feira (âncora da semana) de uma data qualquer.
function mondayStrOf(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  const js = d.getDay();
  const diff = js === 0 ? -6 : 1 - js;
  d.setDate(d.getDate() + diff);
  return isoDate(d);
}
function weeksApart(aMon, bMon) {
  return Math.round((new Date(bMon + "T00:00:00") - new Date(aMon + "T00:00:00")) / (7 * 86400000));
}
// A tarefa está agendada no dia i da semana que começa em "monday"?
// Considera versão por data + frequência (semanal / quinzenal / mensal).
function isScheduledOn(t, monday, i) {
  const dateStr = addDays(monday, i);
  if (dateStr < firstFrom(t)) return false;
  if (t.until && dateStr > t.until) return false;
  const v = verOf(t, dateStr);
  if (!v.days || !v.days.includes(i)) return false;
  const freq = v.freq || "semanal";
  if (freq === "semanal") return true;
  // mensal: só a 1ª ocorrência daquele dia da semana no mês (dia do mês <= 7)
  if (freq === "mensal") return new Date(dateStr + "T00:00:00").getDate() <= 7;
  // quinzenal: a cada 2 semanas, ancorado na semana em que a versão começou
  if (freq === "quinzenal") {
    const anchor = (v.from && v.from !== "0000-00-00") ? mondayStrOf(v.from) : monday;
    return weeksApart(anchor, monday) % 2 === 0;
  }
  return true;
}

// Dias (0=Seg … 6=Dom) em que a tarefa acontece numa semana, já com os ajustes daquela semana:
// "move" sobrepõe a agenda da semana (inclusive lista vazia = não acontece nesta semana),
// "add" traz ocorrências remanejadas de outra semana para uma data específica.
function occDays(t, w, monday) {
  const moved = w?.move?.[t.id];
  const base = Array.isArray(moved) ? moved : [0, 1, 2, 3, 4, 5, 6].filter((i) => isScheduledOn(t, monday, i));
  const added = Object.keys(w?.add?.[t.id] || {}).map(Number);
  return Array.from(new Set([...base, ...added])).sort((a, b) => a - b);
}
// Dias da agenda base da semana (sem as ocorrências trazidas de outras semanas)
function baseDays(t, w, monday) {
  const moved = w?.move?.[t.id];
  return Array.isArray(moved) ? moved : [0, 1, 2, 3, 4, 5, 6].filter((i) => isScheduledOn(t, monday, i));
}
function dayIdxOf(dateStr) {
  const js = new Date(dateStr + "T00:00:00").getDay();
  return js === 0 ? 6 : js - 1;
}
function ddmm(dateStr) {
  const [, m, d] = dateStr.split("-");
  return `${d}/${m}`;
}
// ex: "Qua 05/11"
function fmtDay(dateStr) {
  return `${DAYS[dayIdxOf(dateStr)]} ${ddmm(dateStr)}`;
}
function daysBetween(a, b) {
  return Math.round((new Date(b + "T00:00:00") - new Date(a + "T00:00:00")) / 86400000);
}
const EMPTY_WEEK = { done: {}, presence: {}, skip: {}, move: {}, add: {}, meals: {}, appts: [], wins: "", extras: [], assign: {} };

import { supabase } from "./supabaseClient";
import Recolocacao, { allPaused } from "./Recolocacao";
import Metas from "./Metas";
import Financas from "./Financas";
import { useSession, LoginScreen } from "./Login";

// One household row holds everything. We load it once, subscribe to
// realtime changes (so the other person's edits appear live), and
// write back debounced. The shape mirrors the original three blobs:
// { templates, weeks, people }.
const EMPTY = { templates: SEED_TEMPLATES, weeks: {}, people: SEED_PEOPLE, jobsearch: {}, metas: {} };

function useHousehold(code) {
  const [data, setData] = useState(EMPTY);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(null);
  const saveTimer = useRef(null);
  const skipNextRealtime = useRef(false);

  useEffect(() => {
    if (!code) return;
    let active = true;
    setLoaded(false);
    (async () => {
      try {
        const { data: row, error: selErr } = await supabase
          .from("households").select("*").eq("code", code).maybeSingle();
        if (selErr) throw selErr;
        if (!active) return;
        if (!row) {
          // first time this code is used — create it seeded
          const { error: insErr } = await supabase.from("households").insert({
            code, templates: SEED_TEMPLATES, weeks: {}, people: SEED_PEOPLE, jobsearch: {},
          });
          if (insErr) throw insErr;
          setData(EMPTY);
        } else {
          setData({
            templates: row.templates?.length ? row.templates : SEED_TEMPLATES,
            weeks: row.weeks || {},
            people: cleanPeople(row.people),
            jobsearch: row.jobsearch || {},
            metas: row.metas || {},
          });
        }
        setLoaded(true);
      } catch (e) {
        if (active) { setError(e.message || String(e)); setLoaded(true); }
      }
    })();

    const channel = supabase
      .channel(`household:${code}`)
      .on("postgres_changes",
        { event: "UPDATE", schema: "public", table: "households", filter: `code=eq.${code}` },
        (payload) => {
          if (skipNextRealtime.current) { skipNextRealtime.current = false; return; }
          const r = payload.new;
          setData({
            templates: r.templates || SEED_TEMPLATES,
            weeks: r.weeks || {},
            people: cleanPeople(r.people),
            jobsearch: r.jobsearch || {},
            metas: r.metas || {},
          });
        })
      .subscribe();

    return () => { active = false; supabase.removeChannel(channel); };
  }, [code]);

  const persist = useCallback((next) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      skipNextRealtime.current = true;
      const { error: upErr } = await supabase.from("households")
        .update({ templates: next.templates, weeks: next.weeks, people: next.people, jobsearch: next.jobsearch, metas: next.metas })
        .eq("code", code);
      if (upErr) setError(upErr.message);
    }, 500);
  }, [code]);

  // setters that match the original (value or updater fn)
  const makeSetter = (field) => (next) =>
    setData((prev) => {
      const resolved = typeof next === "function" ? next(prev[field]) : next;
      const merged = { ...prev, [field]: resolved };
      persist(merged);
      return merged;
    });

  return {
    templates: data.templates, setTemplates: makeSetter("templates"),
    weeks: data.weeks, setWeeks: makeSetter("weeks"),
    peopleRaw: data.people, setPeopleRaw: makeSetter("people"),
    jobsearch: data.jobsearch, setJobsearch: makeSetter("jobsearch"),
    metas: data.metas, setMetas: makeSetter("metas"),
    loaded, error,
  };
}

// Identifica o lar de vocês dois. Como o app é só de vocês, não precisa
// digitar código nenhum: os dois abrem o link e veem os mesmos dados.
// Se quiserem, troquem por algo só de vocês (ex: "lar-bacellar-2024").
const HOUSEHOLD_CODE = "lar-rafa-lucas";

// Login obrigatório: o app tem dados pessoais (finanças, metas, saúde).
// Usa os mesmos usuários do Próximo Lar, que fica no mesmo projeto Supabase.
export default function App() {
  const session = useSession();
  if (session === undefined) return null;
  if (!session) return <LoginScreen />;
  return <Routine email={session.user?.email} />;
}

function Routine({ email }) {
  const code = HOUSEHOLD_CODE;
  const [tab, setTab] = useState("hoje");
  const [openActions, setOpenActions] = useState(null); // id da tarefa com o painel "só hoje" aberto
  const [offset, setOffset] = useState(0);
  const [dayOffset, setDayOffset] = useState(0); // dia exibido na aba Hoje, relativo a hoje
  const [lastTab, setLastTab] = useState({}); // última aba aberta dentro de cada seção
  useEffect(() => { if (tab === "hoje" && offset !== 0) setOffset(0); }, [tab, offset]);
  useEffect(() => { setOpenActions(null); }, [dayOffset]);
  const ti = todayIdx();
  const today = todayStr();
  const selDate = addDays(today, dayOffset);
  const di = dayIdxOf(selDate); // dia da semana exibido na aba Hoje
  // Na aba Hoje, a semana é a do dia escolhido; nas outras, a do navegador de semanas.
  const wid = tab === "hoje" ? mondayStrOf(selDate) : weekId(offset);

  const { templates, setTemplates, weeks, setWeeks, peopleRaw, setPeopleRaw, jobsearch, setJobsearch, metas, setMetas, loaded, error } = useHousehold(code);

  const PEOPLE = useMemo(() => {
    const out = {};
    for (const k of Object.keys(peopleRaw)) out[k] = { ...peopleRaw[k], soft: softOf(peopleRaw[k].color) };
    return out;
  }, [peopleRaw]);

  const week = { ...EMPTY_WEEK, ...(weeks[wid] || {}) };

  const patchWeek = useCallback((patch) => {
    setWeeks((prev) => {
      const cur = { ...EMPTY_WEEK, ...(prev[wid] || {}) };
      return { ...prev, [wid]: { ...cur, ...patch } };
    });
  }, [wid, setWeeks]);

  // Versão efetiva de uma tarefa num dia (i) da semana exibida (wid)
  const verAt = useCallback((t, i) => verOf(t, addDays(wid, i)), [wid]);
  // Versão de referência da semana (fim da semana) — usada para agrupar/rotular a linha
  const rowVer = useCallback((t) => verOf(t, addDays(wid, 6)), [wid]);
  // Dias em que a tarefa está agendada nesta semana (versão por dia + frequência + término + remanejo)
  const effectiveDays = useCallback((t) => occDays(t, week, wid), [week, wid]);
  // De onde veio uma ocorrência remanejada de outra semana (data original), se for o caso
  const movedFrom = (t, d) => week.add?.[t.id]?.[d] || null;

  const isDone = (t, d) => !!week.done[`${t.id}:${d}`];
  const isSkipped = (t, d) => !!week.skip[`${t.id}:${d}`];

  // Efetivo "de quem é" a tarefa num dia (transferência só daquele dia sobrepõe a versão)
  const assignFor = (t, d) => (week.assign && week.assign[`${t.id}:${d}`]) || verAt(t, d).who;
  const setAssign = (t, d, who) => {
    const k = `${t.id}:${d}`;
    const next = { ...(week.assign || {}) };
    if (who === verAt(t, d).who) delete next[k]; else next[k] = who;
    patchWeek({ assign: next });
  };

  const toggleDone = (t, d) => {
    const k = `${t.id}:${d}`;
    if (!week.done[k]) { try { navigator.vibrate && navigator.vibrate(12); } catch (e) { /* sem vibração */ } }
    patchWeek({ done: { ...week.done, [k]: !week.done[k] } });
  };

  // Marcar uma tarefa da rotina como "não precisou" só nesta semana (não conta como pendente)
  const toggleSkip = (t, d) => {
    const k = `${t.id}:${d}`;
    const nextSkip = { ...week.skip, [k]: !week.skip[k] };
    // ao marcar "não precisou", tira a marca de feita (se houver), pra não contar duplo
    const nextDone = { ...week.done };
    if (nextSkip[k]) delete nextDone[k];
    patchWeek({ skip: nextSkip, done: nextDone });
  };

  // ---- Atividades avulsas ----
  // Num dia só: fica guardada na semana daquela data. Com repetição: vira uma tarefa de período
  // (de/até), que reaparece sozinha nos dias escolhidos e some depois da data final.
  const addExtraOn = (dateStr, e) => {
    const w = mondayStrOf(dateStr);
    setWeeks((prev) => {
      const cur = { ...EMPTY_WEEK, ...(prev[w] || {}) };
      return { ...prev, [w]: { ...cur, extras: [...(cur.extras || []), { id: "x" + Date.now(), ...e, day: dayIdxOf(dateStr) }] } };
    });
  };
  const addPeriod = ({ title, who, cat, start, end, days }) => {
    setTemplates((prev) => [...prev, {
      id: "p" + Date.now(), kind: "periodo", until: end,
      versions: [{ from: start, title, cat, who, days, flexible: false, freq: "semanal" }],
    }]);
  };
  const removeExtra = (id) => patchWeek({ extras: (week.extras || []).filter((x) => x.id !== id) });

  // ---- Remanejar para uma data específica (mesma semana ou outra) ----
  const moveTaskOcc = (t, fromDate, toDate) => {
    if (toDate === fromDate) return;
    setWeeks((prev) => {
      const next = { ...prev };
      const get = (w) => ({ ...EMPTY_WEEK, ...(next[w] || {}) });
      const fw = mondayStrOf(fromDate), fi = dayIdxOf(fromDate);
      let src = get(fw);
      let origin = fromDate;
      const srcAdded = { ...(src.add?.[t.id] || {}) };
      if (srcAdded[fi] != null) {
        // a ocorrência já tinha vindo de outra semana: tira de lá
        origin = srcAdded[fi];
        delete srcAdded[fi];
        const add = { ...(src.add || {}) };
        if (Object.keys(srcAdded).length) add[t.id] = srcAdded; else delete add[t.id];
        src = { ...src, add };
      } else {
        src = { ...src, move: { ...src.move, [t.id]: baseDays(t, src, fw).filter((d) => d !== fi) } };
      }
      next[fw] = src;
      if (toDate) {
        const tw = mondayStrOf(toDate), tix = dayIdxOf(toDate);
        let dst = get(tw);
        if (tw === fw) {
          const nb = Array.from(new Set([...baseDays(t, dst, tw), tix])).sort((a, b) => a - b);
          dst = { ...dst, move: { ...dst.move, [t.id]: nb } };
        } else {
          dst = { ...dst, add: { ...(dst.add || {}), [t.id]: { ...(dst.add?.[t.id] || {}), [tix]: origin } } };
        }
        next[tw] = dst;
      }
      return next;
    });
  };
  const moveExtraOcc = (e, fromDate, toDate) => {
    if (!toDate || toDate === fromDate) return;
    setWeeks((prev) => {
      const next = { ...prev };
      const fw = mondayStrOf(fromDate), tw = mondayStrOf(toDate);
      const src = { ...EMPTY_WEEK, ...(next[fw] || {}) };
      next[fw] = { ...src, extras: (src.extras || []).filter((x) => x.id !== e.id) };
      const dst = { ...EMPTY_WEEK, ...(next[tw] || {}) };
      next[tw] = { ...dst, extras: [...(dst.extras || []), { ...e, day: dayIdxOf(toDate), movedFrom: e.movedFrom || fromDate }] };
      return next;
    });
  };

  const togglePresence = (person, d) => {
    const cur = week.presence[person] || [];
    const next = cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d];
    patchWeek({ presence: { ...week.presence, [person]: next } });
  };

  // ---- Presence-aware suggestions ----
  // If a flexible "juntos" task lands on a day where someone is at the office,
  // suggest moving it to the nearest day both are home.
  const suggestions = useMemo(() => {
    const out = [];
    const rafaOut = week.presence.rafa || [];
    const lucasOut = week.presence.lucas || [];
    const bothHome = (d) => !rafaOut.includes(d) && !lucasOut.includes(d);
    templates.forEach((t) => {
      if (!rowVer(t).flexible) return;
      const days = effectiveDays(t);
      days.forEach((d) => {
        const needsBoth = verAt(t, d).who === "both";
        const clash = needsBoth ? (rafaOut.includes(d) || lucasOut.includes(d)) : false;
        if (!clash) return;
        const whoOut = [];
        if (rafaOut.includes(d)) whoOut.push("rafa");
        if (lucasOut.includes(d)) whoOut.push("lucas");
        // find nearest earlier home day, else nearest later
        let best = null;
        for (let delta = 1; delta <= 6; delta++) {
          const earlier = d - delta;
          if (earlier >= 0 && bothHome(earlier) && !days.includes(earlier)) { best = earlier; break; }
          const later = d + delta;
          if (later <= 6 && bothHome(later) && !days.includes(later)) { best = later; break; }
        }
        out.push({ task: t, from: d, to: best, whoOut });
      });
    });
    return out;
  }, [templates, week, effectiveDays]);

  const applyMove = (taskId, from, to) => {
    const t = templates.find((x) => x.id === taskId);
    moveTaskOcc(t, addDays(wid, from), to === null ? null : addDays(wid, to));
  };

  // ---- Stats ----
  const stats = useMemo(() => {
    let total = 0, done = 0;
    templates.forEach((t) => {
      effectiveDays(t).forEach((d) => {
        if (isSkipped(t, d)) return;
        total++;
        if (isDone(t, d)) done++;
      });
    });
    return { total, done, pct: total ? Math.round((done / total) * 100) : 0 };
  }, [templates, week, effectiveDays]);

  // streak across weeks (consecutive past weeks with >=70% done)
  const streak = useMemo(() => {
    let s = 0;
    for (let o = -1; o >= -52; o--) {
      const wDate = weekId(o);
      const w = weeks[wDate];
      if (!w) break;
      let tot = 0, dn = 0;
      templates.forEach((t) => {
        occDays(t, w, wDate).forEach((i) => {
          if (w.skip?.[`${t.id}:${i}`]) return;
          tot++;
          if (w.done?.[`${t.id}:${i}`]) dn++;
        });
      });
      if (tot && dn / tot >= 0.7) s++; else break;
    }
    return s;
  }, [weeks, templates]);

  // Itens do dia exibido na aba Hoje (pode ser ontem, amanhã etc.)
  const todayTasks = useMemo(
    () => templates.filter((t) => effectiveDays(t).includes(di)),
    [templates, di, effectiveDays]
  );

  const todayExtras = useMemo(
    () => (week.extras || []).filter((e) => e.day === di),
    [week, di]
  );

  // Feitas / total de uma data (para o anel de progresso do topo)
  const countsOn = (dateStr) => {
    const m = mondayStrOf(dateStr), i = dayIdxOf(dateStr);
    const w = { ...EMPTY_WEEK, ...(weeks[m] || {}) };
    let total = 0, done = 0;
    templates.forEach((t) => {
      if (!occDays(t, w, m).includes(i) || w.skip[`${t.id}:${i}`]) return;
      total++; if (w.done[`${t.id}:${i}`]) done++;
    });
    (w.extras || []).forEach((e) => { if (e.day === i) { total++; if (w.done[`${e.id}:${i}`]) done++; } });
    return { total, done };
  };

  // Pendências de uma data qualquer (para os pontinhos da faixa de dias)
  const pendingOn = (dateStr) => {
    const m = mondayStrOf(dateStr), i = dayIdxOf(dateStr);
    const w = { ...EMPTY_WEEK, ...(weeks[m] || {}) };
    let n = 0;
    templates.forEach((t) => {
      if (!occDays(t, w, m).includes(i)) return;
      if (w.skip[`${t.id}:${i}`] || w.done[`${t.id}:${i}`]) return;
      n++;
    });
    (w.extras || []).forEach((e) => { if (e.day === i && !w.done[`${e.id}:${i}`]) n++; });
    return n;
  };

  if (error) {
    return (
      <div style={{ maxWidth: 480, margin: "40px auto", fontFamily: "var(--font-body)", textAlign: "center", color: "#18233F", background: "#FBEAF1", border: "1px solid #F2D2DF", borderRadius: 14, padding: "24px 22px" }}>
        <div style={{ fontSize: 15, fontWeight: 500, marginBottom: 6 }}>Não consegui conectar ao banco</div>
        <div style={{ fontSize: 13, color: "#8A2E4E", lineHeight: 1.5, marginBottom: 14 }}>{error}</div>
        <div style={{ fontSize: 12.5, color: "#5A6580" }}>Verifique se as chaves do Supabase no arquivo <code>.env</code> estão corretas e se o schema SQL foi aplicado.</div>
      </div>
    );
  }

  if (!loaded) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 360, color: "#8E97AD", fontFamily: "var(--font-body)" }}>
        <RefreshCw size={16} style={{ marginRight: 8, animation: "spin 1s linear infinite" }} /> Carregando a rotina…
        <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      </div>
    );
  }

  const C = {
    bg: "#F3F5F9", surface: "#FFFFFF", line: "#E2E7F0", line2: "#D3DAE6",
    ink: "#18233F", sub: "#5A6580", faint: "#8E97AD", accent: "#2348A6",
  };

  // Navegação em 4 seções; cada seção pode ter abas internas
  const SECTIONS = [
    { id: "hoje", label: "Hoje", icon: Sun, tabs: [["hoje", "Hoje"]] },
    { id: "semana", label: "Semana", icon: CalendarDays, tabs: [["semana", "Agenda"], ["presencial", "Presencial"], ["saude", "Refeições e saúde"]] },
    // Recolocação some da navegação quando os dois pausaram a busca (dá pra retomar pela aba Metas)
    { id: "planos", label: "Planos", icon: Target, tabs: [["metas", `Metas ${PEOPLE.rafa.name}`], ...(allPaused(jobsearch) && tab !== "vagas" ? [] : [["vagas", "Recolocação"]])] },
    { id: "financas", label: "Finanças", icon: Wallet, tabs: [["fin-mes", "Mês"], ["fin-painel", "Painel"], ["fin-cartoes", "Cartões"], ["fin-parcelas", "Parcelas"], ["fin-cobrancas", "A receber"], ["fin-cadastros", "Cadastros"]] },
    { id: "casa", label: "Casa", icon: Home, tabs: [["rotina", "Rotina"], ["historico", "Histórico"]] },
  ];
  const section = SECTIONS.find((s) => s.tabs.some(([id]) => id === tab)) || SECTIONS[0];
  const goTab = (id) => { const sec = SECTIONS.find((s) => s.tabs.some(([x]) => x === id)) || section; setTab(id); setLastTab((m) => ({ ...m, [sec.id]: id })); };
  const goSection = (s) => {
    if (s.id === "hoje") setDayOffset(0);
    const last = lastTab[s.id];
    setTab(last && s.tabs.some(([x]) => x === last) ? last : s.tabs[0][0]);
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const todayCounts = countsOn(today);

  const card = { background: C.surface, border: `1px solid ${C.line}`, borderRadius: 14 };

  return (
    <div style={{ maxWidth: 720, margin: "0 auto", fontFamily: "var(--font-body)", color: C.ink, padding: "0 16px calc(112px + env(safe-area-inset-bottom, 0px))" }}>
      <style>{GLOBAL_CSS}</style>

      <Hero PEOPLE={PEOPLE} counts={todayCounts} streak={streak} compact={section.id !== "hoje"} sectionLabel={section.label} onToday={() => goSection(SECTIONS[0])} />

      {/* Abas internas da seção */}
      {section.tabs.length > 1 && (
        <div role="tablist" style={{ display: "flex", gap: 6, marginBottom: 18, overflowX: "auto", paddingBottom: 2 }}>
          {section.tabs.map(([id, label]) => {
            const on = tab === id;
            return (
              <button key={id} role="tab" aria-selected={on} className="lar-chip" onClick={() => goTab(id)}
                style={{ flex: "0 0 auto", padding: "8px 14px", borderRadius: 99, cursor: "pointer", whiteSpace: "nowrap", fontSize: 13, fontWeight: on ? 600 : 500,
                  border: `1px solid ${on ? C.ink : C.line}`, background: on ? C.ink : C.surface, color: on ? "#fff" : C.sub }}>
                {label}
              </button>
            );
          })}
        </div>
      )}

      {/* Week navigator (shared by several tabs) */}
      {["semana", "presencial", "saude"].includes(tab) && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
          <button className="rot-btn" onClick={() => setOffset(offset - 1)} style={{ ...iconBtn }}><ChevronLeft size={18} /></button>
          <div style={{ textAlign: "center" }}>
            <div className="lar-display" style={{ fontSize: 17, fontWeight: 600 }}>{weekLabel(offset).rel || weekLabel(offset).range}</div>
            <div style={{ fontSize: 12, color: C.faint }}>{weekLabel(offset).range}</div>
          </div>
          <button className="rot-btn" onClick={() => setOffset(offset + 1)} style={{ ...iconBtn }}><ChevronRight size={18} /></button>
        </div>
      )}

      {/* ---------- RECOLOCAÇÃO ---------- */}
      {tab === "vagas" && (
        <Recolocacao jobsearch={jobsearch} setJobsearch={setJobsearch} />
      )}

      {/* ---------- FINANÇAS ---------- */}
      {tab.startsWith("fin-") && (
        <Financas code={code} view={tab} email={email} casal={`${PEOPLE.rafa.name} e ${PEOPLE.lucas.name}`} onGo={(id) => { goTab(id); if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" }); }} />
      )}

      {/* ---------- METAS PESSOAIS ---------- */}
      {tab === "metas" && (
        <>
          <Metas metas={metas} setMetas={setMetas} owner={PEOPLE.rafa} />
          {allPaused(jobsearch) && (
            <div style={{ marginTop: 22, textAlign: "center", fontSize: 12.5, color: C.faint }}>
              Recolocação pausada.{" "}
              <button onClick={() => goTab("vagas")} style={{ background: "none", border: "none", padding: 0, cursor: "pointer", fontSize: 12.5, color: C.accent, fontFamily: "inherit" }}>Abrir para retomar</button>
            </div>
          )}
        </>
      )}

      {/* ---------- HOJE ---------- */}
      {tab === "hoje" && (
        <div style={{ animation: "fade .25s ease" }}>
          <DayStrip today={today} dayOffset={dayOffset} setDayOffset={setDayOffset} pendingOn={pendingOn} C={C} />

          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 14 }}>
            <div className="lar-display" style={{ fontSize: 22, fontWeight: 600, letterSpacing: -0.4 }}>
              {dayOffset === 0 ? "Hoje" : dayOffset === -1 ? "Ontem" : dayOffset === 1 ? "Amanhã" : DAY_FULL[di]}
              <span style={{ fontSize: 13, fontWeight: 400, color: C.faint, marginLeft: 8 }}>{dayOffset === 0 || dayOffset === -1 || dayOffset === 1 ? `${DAY_FULL[di]}, ${ddmm(selDate)}` : ddmm(selDate)}</span>
            </div>
            <div style={{ fontSize: 12.5, color: C.sub }}>{[...todayTasks.filter((t) => !isSkipped(t, di)), ...todayExtras].filter((x) => isDone(x, di)).length} de {todayTasks.filter((t) => !isSkipped(t, di)).length + todayExtras.length} feitas</div>
          </div>

          {(() => {
            const items = [...todayTasks.filter((t) => !isSkipped(t, di)), ...todayExtras];
            const all = items.length > 0 && items.every((x) => isDone(x, di));
            return all ? <DayDone key={selDate} isToday={dayOffset === 0} /> : null;
          })()}

          {/* presence-aware nudge */}
          {suggestions.filter((s) => s.from === di || effectiveDays(s.task).includes(di)).length === 0 && suggestions.length > 0 && (
            <div style={{ ...card, padding: "12px 14px", marginBottom: 14, background: "#FFF9EE", borderColor: "#F0E2C4", display: "flex", gap: 10 }}>
              <Lightbulb size={17} color="#B06A2C" style={{ flexShrink: 0, marginTop: 1 }} />
              <div style={{ fontSize: 13, color: "#7A4E18", lineHeight: 1.5 }}>
                Há ajustes sugeridos para esta semana por causa dos dias presenciais. Veja na aba <b style={{ fontWeight: 500 }}>Presencial</b>.
              </div>
            </div>
          )}

          {(() => {
            const order = ["rafa", "lucas", "both"];
            const dayAppts = (week.appts || []).filter((a) => a.day === di);
            const groups = order.map((pk) => ({
              pk,
              tasks: todayTasks.filter((t) => assignFor(t, di) === pk),
              extras: todayExtras.filter((e) => e.who === pk),
              appts: dayAppts.filter((a) => a.who === pk),
            })).filter((g) => g.tasks.length || g.extras.length || g.appts.length);
            if (groups.length === 0) {
              return <div style={{ textAlign: "center", padding: "40px 0", color: C.faint, fontSize: 13.5 }}>{dayOffset === 0 ? "Nada para hoje. Respira e aproveita." : "Nada marcado para este dia."}</div>;
            }
            return (
              <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
                {groups.map((g) => {
                  const p = PEOPLE[g.pk];
                  const countItems = [...g.tasks.filter((t) => !isSkipped(t, di)), ...g.extras];
                  const doneCount = countItems.filter((x) => isDone(x, di)).length;
                  return (
                    <div key={g.pk}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                        <span style={{ width: 9, height: 9, borderRadius: 99, background: p.color }} />
                        <div style={{ fontSize: 13, fontWeight: 500, color: p.color }}>{p.name}</div>
                        {countItems.length > 0 && <div style={{ fontSize: 11.5, color: C.faint }}>{doneCount}/{countItems.length}</div>}
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        {g.tasks.map((t) => {
                          const done = isDone(t, di); const skipped = isSkipped(t, di);
                          const v = verAt(t, di); const cat = CATEGORIES[v.cat]; const Ic = cat.icon;
                          if (skipped) {
                            return (
                              <div key={t.id} className="rot-row"
                                style={{ ...card, display: "flex", alignItems: "center", gap: 12, padding: "13px 15px", opacity: 0.55 }}>
                                <div onClick={() => toggleSkip(t, di)} title="Voltar — precisa fazer" style={{ width: 22, height: 22, borderRadius: 7, flexShrink: 0, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", border: `1px dashed ${C.line2}`, background: "transparent" }}>
                                  <CircleSlash size={13} color={C.faint} />
                                </div>
                                <div onClick={() => toggleSkip(t, di)} style={{ flex: 1, minWidth: 0, cursor: "pointer" }}>
                                  <div style={{ fontSize: 14.5, textDecoration: "line-through", color: C.sub }}>{v.title}</div>
                                  <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
                                    <Tag soft="#EBEFF6" color={C.faint}>não precisou</Tag>
                                  </div>
                                </div>
                                <button onClick={() => toggleSkip(t, di)} title="Voltar — precisa fazer" style={{ ...iconBtn, width: 30, height: 30, flexShrink: 0 }}><RefreshCw size={13} color={C.faint} /></button>
                              </div>
                            );
                          }
                          return (
                            <div key={t.id}>
                              <div className="rot-row"
                                style={{ ...card, display: "flex", alignItems: "center", gap: 12, padding: "13px 15px", opacity: done ? 0.55 : 1, transition: "opacity .15s, border-color .15s", ...(openActions === t.id ? { borderBottomLeftRadius: 0, borderBottomRightRadius: 0 } : {}) }}>
                                <div onClick={() => toggleDone(t, di)} style={{ width: 22, height: 22, borderRadius: 7, flexShrink: 0, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", border: `2px solid ${done ? cat.color : "#C9D1DF"}`, background: done ? cat.color : "transparent", animation: done ? "lar-pop .32s ease" : "none", transition: "background .15s, border-color .15s" }}>
                                  {done && <Check size={13} color="#fff" />}
                                </div>
                                <div onClick={() => toggleDone(t, di)} style={{ flex: 1, minWidth: 0, cursor: "pointer" }}>
                                  <div style={{ fontSize: 14.5, textDecoration: done ? "line-through" : "none" }}>{v.title}</div>
                                  <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
                                    <Tag soft={cat.soft} color={cat.color}><Ic size={11} /> {cat.label}</Tag>
                                    {t.until && <Tag soft="#EBEFF6" color={C.faint}>até {ddmm(t.until)}</Tag>}
                                    {movedFrom(t, di) && <Tag soft="#FAF0E4" color="#B06A2C">veio de {fmtDay(movedFrom(t, di))}</Tag>}
                                    {assignFor(t, di) !== v.who && <Tag soft="#EBEFF6" color={C.faint}>só neste dia</Tag>}
                                  </div>
                                </div>
                                <button onClick={() => setOpenActions(openActions === t.id ? null : t.id)} title="Ações deste dia" style={{ ...iconBtn, width: 30, height: 30, flexShrink: 0, background: openActions === t.id ? "#EBEFF6" : "transparent" }}><MoreHorizontal size={16} color={C.faint} /></button>
                              </div>
                              {openActions === t.id && (
                                <div style={{ background: "#F5F7FB", border: `1px solid ${C.line}`, borderTop: "none", borderBottomLeftRadius: 12, borderBottomRightRadius: 12, padding: "12px 14px" }}>
                                  <div style={{ fontSize: 11, color: C.faint, marginBottom: 6 }}>Passar este dia para</div>
                                  <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
                                    {["rafa", "lucas", "both"].map((k) => { const on = assignFor(t, di) === k; const pp = PEOPLE[k]; return (
                                      <button key={k} onClick={() => { setAssign(t, di, k); setOpenActions(null); }} style={{ flex: 1, padding: "7px 0", borderRadius: 9, fontSize: 12, cursor: "pointer", border: `1px solid ${on ? pp.color : C.line}`, background: on ? pp.soft : C.surface, color: on ? pp.color : C.sub, fontWeight: on ? 500 : 400 }}>{pp.name}</button>
                                    ); })}
                                  </div>
                                  <div style={{ fontSize: 11, color: C.faint, marginBottom: 6 }}>Jogar para outra data</div>
                                  <DatePicker fromDate={selDate} C={C} onPick={(d) => { moveTaskOcc(t, selDate, d); setOpenActions(null); }} />
                                  <button onClick={() => { toggleSkip(t, di); setOpenActions(null); }} style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 12px", borderRadius: 9, border: `1px solid ${C.line}`, background: C.surface, cursor: "pointer", fontSize: 12.5, color: C.sub }}><CircleSlash size={13} /> Não precisou neste dia</button>
                                </div>
                              )}
                            </div>
                          );
                        })}
                        {g.extras.map((e) => {
                          const done = isDone(e, di); const cat = CATEGORIES[e.cat] || CATEGORIES.vida; const Ic = cat.icon;
                          const open = openActions === e.id;
                          return (
                            <div key={e.id}>
                              <div className="rot-row"
                                style={{ ...card, display: "flex", alignItems: "center", gap: 12, padding: "13px 15px", opacity: done ? 0.55 : 1, transition: "opacity .15s, border-color .15s", ...(open ? { borderBottomLeftRadius: 0, borderBottomRightRadius: 0 } : {}) }}>
                                <div onClick={() => toggleDone(e, di)} style={{ width: 22, height: 22, borderRadius: 7, flexShrink: 0, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", border: `2px solid ${done ? cat.color : "#C9D1DF"}`, background: done ? cat.color : "transparent", animation: done ? "lar-pop .32s ease" : "none", transition: "background .15s, border-color .15s" }}>
                                  {done && <Check size={13} color="#fff" />}
                                </div>
                                <div onClick={() => toggleDone(e, di)} style={{ flex: 1, minWidth: 0, cursor: "pointer" }}>
                                  <div style={{ fontSize: 14.5, textDecoration: done ? "line-through" : "none" }}>{e.title}</div>
                                  <div style={{ display: "flex", gap: 6, marginTop: 4, flexWrap: "wrap" }}>
                                    <Tag soft={cat.soft} color={cat.color}><Ic size={11} /> {cat.label}</Tag>
                                    <Tag soft="#EBEFF6" color={C.faint}>avulsa</Tag>
                                    {e.movedFrom && <Tag soft="#FAF0E4" color="#B06A2C">veio de {fmtDay(e.movedFrom)}</Tag>}
                                  </div>
                                </div>
                                <button onClick={() => setOpenActions(open ? null : e.id)} title="Ações deste dia" style={{ ...iconBtn, width: 30, height: 30, flexShrink: 0, background: open ? "#EBEFF6" : "transparent" }}><MoreHorizontal size={16} color={C.faint} /></button>
                              </div>
                              {open && (
                                <div style={{ background: "#F5F7FB", border: `1px solid ${C.line}`, borderTop: "none", borderBottomLeftRadius: 12, borderBottomRightRadius: 12, padding: "12px 14px" }}>
                                  <div style={{ fontSize: 11, color: C.faint, marginBottom: 6 }}>Jogar para outra data</div>
                                  <DatePicker fromDate={selDate} C={C} onPick={(d) => { moveExtraOcc(e, selDate, d); setOpenActions(null); }} />
                                  <button onClick={() => { removeExtra(e.id); setOpenActions(null); }} style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 12px", borderRadius: 9, border: `1px solid ${C.line}`, background: C.surface, cursor: "pointer", fontSize: 12.5, color: C.sub }}><Trash2 size={13} /> Remover</button>
                                </div>
                              )}
                            </div>
                          );
                        })}
                        {g.appts.map((a, ai) => (
                          <div key={"a" + ai} style={{ ...card, display: "flex", alignItems: "center", gap: 12, padding: "13px 15px", background: "#FBEAF1", borderColor: "#F2D2DF" }}>
                            <Stethoscope size={17} color="#C04574" style={{ flexShrink: 0 }} />
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: 14.5 }}>{a.title}</div>
                              <div style={{ fontSize: 11.5, color: "#8A2E4E", marginTop: 2 }}>{a.when || "compromisso"}</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })()}

          <ExtraAdder onAddOne={addExtraOn} onAddPeriod={addPeriod} C={C} PEOPLE={PEOPLE} defaultDate={selDate} />
        </div>
      )}

      {/* ---------- SEMANA ---------- */}
      {tab === "semana" && (
        <div style={{ animation: "fade .25s ease" }}>
          <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
            <Metric label="Concluídas" value={`${stats.done}/${stats.total}`} />
            <Metric label="Progresso" value={`${stats.pct}%`} />
          </div>
          <div style={{ height: 6, background: "#E2E7F0", borderRadius: 99, overflow: "hidden", marginBottom: 18 }}>
            <div style={{ height: "100%", width: `${stats.pct}%`, background: C.accent, borderRadius: 99, transition: "width .3s" }} />
          </div>

          <div style={{ overflowX: "auto", margin: "0 -4px", padding: "0 4px" }}>
            <table style={{ width: "100%", minWidth: 330, borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left", fontSize: 11.5, fontWeight: 500, color: C.faint, padding: "0 8px 8px 0", width: "38%" }}>Tarefa</th>
                  {DAYS.map((d, i) => (
                    <th key={d} style={{ textAlign: "center", fontSize: 11.5, fontWeight: 500, padding: "0 2px 8px", color: i === ti && offset === 0 ? C.accent : C.faint }}>{d}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {["rafa", "lucas", "both"].map((pk) => {
                  const items = templates.filter((t) => rowVer(t).who === pk && effectiveDays(t).length > 0);
                  const extrasFor = (week.extras || []).filter((e) => e.who === pk);
                  if (!items.length && !extrasFor.length) return null;
                  const pp = PEOPLE[pk];
                  return (
                    <React.Fragment key={pk}>
                      <tr>
                        <td colSpan={8} style={{ padding: "14px 0 5px" }}>
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11.5, fontWeight: 500, color: pp.color }}>
                            <span style={{ width: 8, height: 8, borderRadius: 99, background: pp.color }} /> {pp.name}
                          </span>
                        </td>
                      </tr>
                      {items.map((t) => {
                        const rv = rowVer(t); const cat = CATEGORIES[rv.cat]; const days = effectiveDays(t);
                        const moved = Array.isArray(week.move[t.id]) || !!week.add?.[t.id];
                        return (
                          <tr key={t.id} style={{ borderTop: `1px solid ${C.line}` }}>
                            <td style={{ padding: "9px 8px 9px 0" }}>
                              <div style={{ fontSize: 12.5, lineHeight: 1.3, paddingLeft: 14 }}>
                                {rv.title}
                                {t.until && <span style={{ fontSize: 10, color: C.faint }}> · até {ddmm(t.until)}</span>}
                                {moved && <span style={{ fontSize: 10, color: "#B06A2C" }}> · ajustada</span>}
                              </div>
                            </td>
                            {DAYS.map((d, i) => {
                              const sched = days.includes(i); const done = isDone(t, i); const skipped = isSkipped(t, i);
                              return (
                                <td key={d} style={{ textAlign: "center", padding: "9px 2px" }}>
                                  {!sched ? (
                                    <span style={{ color: "#D3DAE6" }}>·</span>
                                  ) : skipped ? (
                                    <button onClick={() => toggleSkip(t, i)} title="Não precisou esta semana — clique para restaurar"
                                      style={{ width: 22, height: 22, margin: "0 auto", borderRadius: 7, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", border: `1px dashed ${C.line2}`, background: "transparent" }}>
                                      <CircleSlash size={12} color={C.faint} />
                                    </button>
                                  ) : (
                                    <button onClick={() => toggleDone(t, i)} style={{ width: 22, height: 22, margin: "0 auto", borderRadius: 7, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", border: `2px solid ${done ? cat.color : "#C9D1DF"}`, background: done ? cat.color : "transparent", animation: done ? "lar-pop .32s ease" : "none" }}>
                                      {done && <Check size={12} color="#fff" />}
                                    </button>
                                  )}
                                </td>
                              );
                            })}
                          </tr>
                        );
                      })}
                      {extrasFor.map((e) => {
                        const cat = CATEGORIES[e.cat] || CATEGORIES.vida; const done = isDone(e, e.day);
                        return (
                          <tr key={e.id} style={{ borderTop: `1px solid ${C.line}` }}>
                            <td style={{ padding: "9px 8px 9px 0" }}>
                              <div style={{ fontSize: 12.5, lineHeight: 1.3, paddingLeft: 14, display: "flex", alignItems: "center", gap: 6 }}>
                                <span>{e.title}</span>
                                <span style={{ fontSize: 10, color: C.faint }}>· avulsa</span>
                                <button onClick={() => removeExtra(e.id)} title="Remover" style={{ background: "none", border: "none", cursor: "pointer", padding: 0, lineHeight: 0 }}><Trash2 size={12} color={C.faint} /></button>
                              </div>
                            </td>
                            {DAYS.map((d, i) => (
                              <td key={d} style={{ textAlign: "center", padding: "9px 2px" }}>
                                {i === e.day ? (
                                  <button onClick={() => toggleDone(e, i)} style={{ width: 22, height: 22, margin: "0 auto", borderRadius: 7, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", border: `2px solid ${done ? cat.color : "#C9D1DF"}`, background: done ? cat.color : "transparent", animation: done ? "lar-pop .32s ease" : "none" }}>
                                    {done && <Check size={12} color="#fff" />}
                                  </button>
                                ) : <span style={{ color: "#D3DAE6" }}>·</span>}
                              </td>
                            ))}
                          </tr>
                        );
                      })}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>

          {Object.values(week.skip || {}).some(Boolean) && (
            <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: C.faint, marginTop: 10 }}>
              <CircleSlash size={12} /> não precisou esta semana (não conta como pendente)
            </div>
          )}

          {/* Compromissos da semana (eventos por pessoa) */}
          {(week.appts || []).some((a) => a.day != null) && (
            <div style={{ marginTop: 18 }}>
              <SectionTitle icon={Stethoscope} color="#C04574">Compromissos da semana</SectionTitle>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {(week.appts || []).filter((a) => a.day != null).slice().sort((a, b) => a.day - b.day).map((a, idx) => {
                  const pp = PEOPLE[a.who] || {};
                  return (
                    <div key={idx} style={{ ...card, padding: "11px 13px", display: "flex", alignItems: "center", gap: 11 }}>
                      <div style={{ width: 40, textAlign: "center", fontSize: 12, fontWeight: 500, color: C.sub }}>{DAYS[a.day]}</div>
                      <Stethoscope size={15} color="#C04574" style={{ flexShrink: 0 }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13.5 }}>{a.title}</div>
                        <div style={{ fontSize: 11.5, color: C.faint }}>{a.when ? a.when + " · " : ""}<span style={{ color: pp.color }}>{pp.name || ""}</span></div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ---------- PRESENCIAL ---------- */}
      {tab === "presencial" && (
        <div style={{ animation: "fade .25s ease" }}>
          <p style={{ fontSize: 13.5, color: C.sub, lineHeight: 1.55, margin: "0 0 16px" }}>
            Marque os dias que cada um vai ao escritório <b style={{ fontWeight: 500 }}>nesta semana</b>. Quando um dia presencial bater com uma tarefa que depende dos dois, o sistema sugere mover.
          </p>

          {["rafa", "lucas"].map((person) => {
            const p = PEOPLE[person];
            return (
              <div key={person} style={{ ...card, padding: "14px 16px", marginBottom: 12 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 12 }}>
                  <div style={{ width: 28, height: 28, borderRadius: 9, background: p.soft, display: "flex", alignItems: "center", justifyContent: "center" }}><User size={14} color={p.color} /></div>
                  <div style={{ fontSize: 13.5, fontWeight: 500 }}>{p.name}</div>
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  {DAYS.map((d, i) => {
                    const on = (week.presence[person] || []).includes(i);
                    return (
                      <button key={d} onClick={() => togglePresence(person, i)} style={{ flex: 1, padding: "8px 0", borderRadius: 9, fontSize: 12, cursor: "pointer", border: `1px solid ${on ? p.color : C.line}`, background: on ? p.color : C.surface, color: on ? "#fff" : C.sub, fontWeight: on ? 500 : 400 }}>{d}</button>
                    );
                  })}
                </div>
              </div>
            );
          })}

          {/* Both-home strip */}
          <div style={{ ...card, padding: "14px 16px", marginBottom: 16, background: "#FAF0E4", borderColor: "#F0E2C4" }}>
            <div style={{ fontSize: 12.5, fontWeight: 500, color: "#B06A2C", marginBottom: 10 }}>Dias com os dois em casa</div>
            <div style={{ display: "flex", gap: 6 }}>
              {DAYS.map((d, i) => {
                const home = !(week.presence.rafa || []).includes(i) && !(week.presence.lucas || []).includes(i);
                return <div key={d} style={{ flex: 1, textAlign: "center", padding: "7px 0", borderRadius: 8, fontSize: 12, background: home ? "#B06A2C" : "transparent", color: home ? "#fff" : "#D3BC9C", fontWeight: home ? 500 : 400 }}>{d}</div>;
              })}
            </div>
            <div style={{ fontSize: 11.5, color: "#8A5A22", marginTop: 9, lineHeight: 1.5 }}>Os melhores dias para cozinhar juntos, tarefas em dupla ou só descansar.</div>
          </div>

          {/* Suggestions */}
          {suggestions.length > 0 && (
            <div>
              <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 10, display: "flex", alignItems: "center", gap: 6 }}><Lightbulb size={15} color="#B06A2C" /> Ajustes sugeridos</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {suggestions.map((s, idx) => {
                  const rafaOut = week.presence.rafa || [];
                  const lucasOut = week.presence.lucas || [];
                  const bothHome = (d) => !rafaOut.includes(d) && !lucasOut.includes(d);
                  return (
                    <div key={idx} style={{ ...card, padding: "12px 14px" }}>
                      <div style={{ fontSize: 13, lineHeight: 1.5, marginBottom: 10 }}>
                        <b style={{ fontWeight: 500 }}>{s.task.title}</b> está marcada para <b style={{ fontWeight: 500 }}>{DAY_FULL[s.from]}</b>, mas{" "}
                        <b style={{ fontWeight: 500 }}>{(s.whoOut || []).map((k) => PEOPLE[k]?.name).filter(Boolean).join(" e ") || "alguém"}</b>{" "}
                        {(s.whoOut || []).length > 1 ? "estarão" : "estará"} no escritório.
                        {s.to !== null ? <> A sugestão é <b style={{ fontWeight: 500, color: "#B06A2C" }}>{DAY_FULL[s.to]}</b>, mas você escolhe:</> : <> Escolha para qual dia mover:</>}
                      </div>
                      <div style={{ fontSize: 11.5, color: C.faint, marginBottom: 7 }}>Mover para qual dia?</div>
                      <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 10 }}>
                        {DAYS.map((d, i) => {
                          const isFrom = i === s.from;
                          const rec = bothHome(i) && !isFrom;
                          return (
                            <button key={d} disabled={isFrom} onClick={() => applyMove(s.task.id, s.from, i)}
                              title={isFrom ? "dia atual" : rec ? "os dois em casa" : "alguém no escritório"}
                              style={{ flex: "1 0 auto", minWidth: 40, padding: "8px 0", borderRadius: 9, fontSize: 12,
                                cursor: isFrom ? "default" : "pointer", opacity: isFrom ? 0.55 : 1,
                                border: `1px solid ${rec ? "#B06A2C" : C.line}`,
                                background: isFrom ? "#EBEFF6" : rec ? "#FAF0E4" : C.surface,
                                color: isFrom ? C.faint : rec ? "#B06A2C" : C.sub,
                                fontWeight: rec ? 500 : 400 }}>{d}</button>
                          );
                        })}
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, color: C.faint }}>
                          <span style={{ width: 9, height: 9, borderRadius: 3, background: "#FAF0E4", border: "1px solid #B06A2C" }} /> os dois em casa
                        </span>
                        <button className="rot-btn" onClick={() => applyMove(s.task.id, s.from, null)} style={{ marginLeft: "auto", padding: "7px 12px", borderRadius: 9, border: `1px solid ${C.line}`, background: C.surface, cursor: "pointer", fontSize: 12.5, color: C.sub }}>
                          Não precisou esta semana
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          {suggestions.length === 0 && (week.presence.rafa?.length || week.presence.lucas?.length) ? (
            <div style={{ textAlign: "center", padding: "20px 0", color: C.faint, fontSize: 13 }}>Tudo encaixado — nenhuma tarefa em dupla conflita com os dias presenciais.</div>
          ) : null}
        </div>
      )}

      {/* ---------- SAÚDE & VIDA ---------- */}
      {tab === "saude" && (
        <div style={{ animation: "fade .25s ease" }}>
          <div style={{ ...card, padding: "13px 15px", marginBottom: 16, background: "#FBEAF1", borderColor: "#F2D2DF", display: "flex", gap: 10 }}>
            <HeartPulse size={17} color="#C04574" style={{ flexShrink: 0, marginTop: 1 }} />
            <div style={{ fontSize: 12.5, color: "#8A2E4E", lineHeight: 1.5 }}>
              Este é um espaço para <b style={{ fontWeight: 500 }}>organizar</b> a rotina de saúde — refeições, consultas, vitórias. Metas de dieta, calorias ou exercício devem ser definidas com seu médico ou nutricionista, e aí você registra aqui o que foi orientado.
            </div>
          </div>

          {/* Meal plan */}
          <SectionTitle icon={Utensils} color="#B06A2C">Plano de refeições da semana</SectionTitle>
          <div style={{ ...card, padding: "6px 4px", marginBottom: 18 }}>
            {DAYS.map((d, i) => (
              <div key={d} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", borderTop: i === 0 ? "none" : `1px solid ${C.line}` }}>
                <div style={{ width: 38, fontSize: 12.5, color: i === ti && offset === 0 ? C.accent : C.sub, fontWeight: i === ti && offset === 0 ? 500 : 400 }}>{d}</div>
                <input value={week.meals[i] || ""} placeholder="o que vamos comer?"
                  onChange={(e) => patchWeek({ meals: { ...week.meals, [i]: e.target.value } })}
                  style={{ flex: 1, border: "none", background: "transparent", fontSize: 13.5, color: C.ink, outline: "none", padding: "4px 0" }} />
              </div>
            ))}
          </div>

          {/* Appointments */}
          <SectionTitle icon={Stethoscope} color="#C04574">Consultas e profissionais</SectionTitle>
          <p style={{ fontSize: 12, color: C.faint, lineHeight: 1.5, margin: "-4px 0 10px" }}>
            Cadastre uma consulta (nutricionista, cardiologista…) e, se escolher um dia, ela vira um <b style={{ fontWeight: 500 }}>evento da pessoa</b> na visão Hoje e Semana.
          </p>
          <div style={{ marginBottom: 10, display: "flex", flexDirection: "column", gap: 8 }}>
            {(week.appts || []).map((a, idx) => (
              <div key={idx} style={{ ...card, padding: "11px 13px", display: "flex", alignItems: "center", gap: 10 }}>
                <Stethoscope size={15} color="#C04574" style={{ flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5 }}>{a.title}</div>
                  <div style={{ fontSize: 11.5, color: C.faint }}>{[a.day != null ? DAY_FULL[a.day] : null, a.when || null, a.who ? (PEOPLE[a.who]?.name || a.who) : null].filter(Boolean).join(" · ")}</div>
                </div>
                <button className="rot-btn" onClick={() => patchWeek({ appts: week.appts.filter((_, j) => j !== idx) })} style={{ ...iconBtn, width: 30, height: 30 }}><Trash2 size={14} color={C.faint} /></button>
              </div>
            ))}
          </div>
          <ApptAdder onAdd={(a) => patchWeek({ appts: [...(week.appts || []), a] })} C={C} PEOPLE={PEOPLE} />

          {/* Wins */}
          <div style={{ marginTop: 20 }}>
            <SectionTitle icon={TrendingUp} color="#0E7C61">Vitórias da semana</SectionTitle>
            <textarea value={week.wins || ""} placeholder="o que deu certo? como vocês se sentiram?"
              onChange={(e) => patchWeek({ wins: e.target.value })}
              style={{ width: "100%", minHeight: 70, ...card, padding: "12px 14px", fontSize: 13.5, color: C.ink, outline: "none", resize: "vertical", boxSizing: "border-box", lineHeight: 1.5 }} />
          </div>
        </div>
      )}

      {/* ---------- HISTÓRICO ---------- */}
      {tab === "historico" && (
        <div style={{ animation: "fade .25s ease" }}>
          <p style={{ fontSize: 13.5, color: C.sub, lineHeight: 1.55, margin: "0 0 16px" }}>Como as últimas semanas foram. Use para enxergar padrões — por exemplo, semanas com muitos dias presenciais costumam render menos em casa.</p>
          <HistoryView weeks={weeks} templates={templates} C={C} PEOPLE={PEOPLE} />
        </div>
      )}

      {/* ---------- ROTINA (manage templates) ---------- */}
      {tab === "rotina" && (
        <ManageTemplates templates={templates} setTemplates={setTemplates} C={C} ti={ti} PEOPLE={PEOPLE} peopleRaw={peopleRaw} setPeopleRaw={setPeopleRaw} />
      )}

      <div style={{ marginTop: 28, textAlign: "center" }}>
        <div style={{ fontSize: 11.5, color: C.faint }}>Tudo salvo e sincronizado entre vocês dois.</div>
        <div style={{ fontSize: 11.5, color: C.faint, marginTop: 4 }}>
          Conectado como {email}.{" "}
          <button onClick={() => supabase.auth.signOut()} style={{ background: "none", border: "none", padding: 0, cursor: "pointer", fontSize: 11.5, color: C.accent, fontFamily: "inherit" }}>Sair</button>
        </div>
      </div>

      <BottomNav sections={SECTIONS} active={section.id} onGo={goSection} badge={{ hoje: Math.max(0, todayCounts.total - todayCounts.done) }} />
    </div>
  );
}

const iconBtn = { width: 34, height: 34, borderRadius: 9, border: "1px solid #E2E7F0", background: "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" };

// ================= Identidade visual =================
// Azulejo: o padrão de ladrilho é a marca do app. Aparece só no topo.
const BRAND = { cobalt: "#2348A6", cobaltDeep: "#183580", sun: "#F2B23A", sunSoft: "#FDF1D8", ink: "#18233F", porcelain: "#F3F5F9" };
const TILE_SVG = `<svg xmlns='http://www.w3.org/2000/svg' width='48' height='48' viewBox='0 0 48 48'><g fill='none' stroke='white' stroke-width='1.3'><path d='M24 7 L41 24 L24 41 L7 24 Z' stroke-opacity='0.16'/><circle cx='24' cy='24' r='5.5' stroke-opacity='0.22'/><path d='M0 12 A12 12 0 0 0 12 0 M36 0 A12 12 0 0 0 48 12 M48 36 A12 12 0 0 0 36 48 M12 48 A12 12 0 0 0 0 36' stroke-opacity='0.16'/><path d='M24 0 V7 M24 41 V48 M0 24 H7 M41 24 H48' stroke-opacity='0.14'/></g></svg>`;
const TILE_BG = `url("data:image/svg+xml,${encodeURIComponent(TILE_SVG)}")`;

const GLOBAL_CSS = `
  :root { --font-body: "Figtree", system-ui, -apple-system, sans-serif; --font-display: "Bricolage Grotesque", "Figtree", system-ui, sans-serif; }
  html, body { background: ${BRAND.porcelain}; }
  body { -webkit-font-smoothing: antialiased; }
  input, textarea, select, button { font-family: inherit; }
  .lar-display { font-family: var(--font-display); }
  button:focus-visible, input:focus-visible, textarea:focus-visible, [role=tab]:focus-visible { outline: 2px solid ${BRAND.cobalt}; outline-offset: 2px; }
  input:focus, textarea:focus { border-color: ${BRAND.cobalt}; }
  @keyframes spin { to { transform: rotate(360deg) } }
  @keyframes fade { from { opacity: 0; transform: translateY(4px) } to { opacity: 1; transform: none } }
  @keyframes lar-pop { 0% { transform: scale(.55) } 60% { transform: scale(1.18) } 100% { transform: scale(1) } }
  @keyframes lar-burst { 0% { transform: translate(0,0) rotate(0); opacity: 1 } 100% { transform: translate(var(--x), var(--y)) rotate(var(--r)); opacity: 0 } }
  @keyframes lar-rise { from { opacity: 0; transform: translateY(8px) scale(.98) } to { opacity: 1; transform: none } }
  .rot-row { transition: border-color .15s, box-shadow .15s, opacity .15s; }
  .rot-row:hover { border-color: #C9D1DF; box-shadow: 0 2px 10px rgba(24,35,63,.05); }
  .rot-btn:hover { background: #EBEFF6 !important; }
  .lar-chip { transition: background .15s, color .15s, border-color .15s, transform .1s; }
  .lar-chip:active, .lar-nav:active { transform: scale(.95); }
  .lar-nav { transition: background .2s, color .2s, transform .1s; }
  @media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation: none !important; transition: none !important; } }
`;

function greeting() {
  const h = new Date().getHours();
  return h < 5 ? "Boa noite" : h < 12 ? "Bom dia" : h < 18 ? "Boa tarde" : "Boa noite";
}
function longDate() {
  const d = new Date();
  const s = d.toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// Anel de progresso do dia
function Ring({ done, total, size = 64, stroke = 6 }) {
  const r = (size - stroke) / 2, c = 2 * Math.PI * r;
  const pct = total ? done / total : 0;
  const full = total > 0 && done === total;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={total ? `${done} de ${total} feitas hoje` : "nada marcado hoje"}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,.22)" strokeWidth={stroke} />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={BRAND.sun} strokeWidth={stroke} strokeLinecap="round"
        strokeDasharray={c} strokeDashoffset={c * (1 - pct)} transform={`rotate(-90 ${size / 2} ${size / 2})`}
        style={{ transition: "stroke-dashoffset .6s cubic-bezier(.2,.8,.2,1)" }} />
      {full ? (
        <path d={`M${size * 0.36} ${size * 0.51} l${size * 0.1} ${size * 0.1} l${size * 0.19} -${size * 0.21}`} fill="none" stroke="#fff" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
      ) : (
        <text x="50%" y="53%" textAnchor="middle" dominantBaseline="middle" fill="#fff" style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: size * 0.27 }}>
          {total ? `${done}/${total}` : "0"}
        </text>
      )}
    </svg>
  );
}

// Topo com o azulejo: saudação, data e progresso do dia
function Hero({ PEOPLE, counts, streak, compact, sectionLabel, onToday }) {
  const pend = counts.total - counts.done;
  const sub = counts.total === 0 ? "Nada marcado para hoje." : pend === 0 ? "Tudo feito por hoje." : `${pend} ${pend === 1 ? "coisa" : "coisas"} para hoje.`;
  return (
    <header style={{ margin: "0 -16px 18px", padding: compact ? "calc(env(safe-area-inset-top, 0px) + 14px) 20px 14px" : "calc(env(safe-area-inset-top, 0px) + 22px) 20px 22px",
      background: `${TILE_BG} center/48px 48px, linear-gradient(135deg, ${BRAND.cobalt}, ${BRAND.cobaltDeep})`, color: "#fff", borderRadius: "0 0 26px 26px", position: "relative", overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14, position: "relative" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="lar-display" style={{ fontSize: compact ? 13 : 13.5, fontWeight: 600, opacity: 0.8, display: "flex", alignItems: "center", gap: 6 }}>
            <Home size={13} /> Nosso lar{compact ? ` / ${sectionLabel}` : ""}
          </div>
          {!compact && (
            <>
              <div className="lar-display" style={{ fontSize: 27, fontWeight: 600, letterSpacing: -0.6, lineHeight: 1.12, marginTop: 8 }}>
                {greeting()}, {PEOPLE.rafa.name} e {PEOPLE.lucas.name}
              </div>
              <div style={{ fontSize: 13.5, opacity: 0.85, marginTop: 6 }}>{longDate()}. {sub}</div>
            </>
          )}
          {streak > 0 && !compact && (
            <div style={{ display: "inline-flex", alignItems: "center", gap: 6, marginTop: 12, background: BRAND.sun, color: BRAND.ink, padding: "5px 11px", borderRadius: 99, fontSize: 12.5, fontWeight: 600 }}>
              <Flame size={13} /> {streak} {streak === 1 ? "semana firme" : "semanas firmes"}
            </div>
          )}
        </div>
        <button onClick={onToday} title="Ver o dia de hoje" style={{ background: "none", border: "none", padding: 0, cursor: "pointer", flexShrink: 0, lineHeight: 0 }}>
          <Ring done={counts.done} total={counts.total} size={compact ? 46 : 72} stroke={compact ? 5 : 7} />
        </button>
      </div>
    </header>
  );
}

// Navegação principal, fixa embaixo (fica no alcance do polegar)
function BottomNav({ sections, active, onGo, badge }) {
  return (
    <nav aria-label="Seções" style={{ position: "fixed", left: "50%", transform: "translateX(-50%)", bottom: "calc(env(safe-area-inset-bottom, 0px) + 12px)", zIndex: 20,
      width: "min(calc(100% - 24px), 460px)", display: "flex", gap: 4, padding: 6, borderRadius: 22,
      background: "rgba(255,255,255,.9)", backdropFilter: "blur(14px)", WebkitBackdropFilter: "blur(14px)",
      border: "1px solid #E2E7F0", boxShadow: "0 8px 28px rgba(24,35,63,.14)" }}>
      {sections.map((s) => {
        const on = active === s.id; const Ic = s.icon; const n = badge[s.id] || 0;
        return (
          <button key={s.id} className="lar-nav" onClick={() => onGo(s)} aria-current={on ? "page" : undefined}
            style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 3, padding: "8px 0 7px", borderRadius: 16, border: "none", cursor: "pointer",
              background: on ? BRAND.cobalt : "transparent", color: on ? "#fff" : "#5A6580", position: "relative" }}>
            <Ic size={19} strokeWidth={on ? 2.3 : 2} />
            <span style={{ fontSize: 11, fontWeight: on ? 600 : 500 }}>{s.label}</span>
            {n > 0 && !on && (
              <span style={{ position: "absolute", top: 4, left: "calc(50% + 6px)", minWidth: 16, height: 16, padding: "0 4px", borderRadius: 99, background: BRAND.sun, color: BRAND.ink, fontSize: 10, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>{n}</span>
            )}
          </button>
        );
      })}
    </nav>
  );
}

// Comemoração quando o dia fica completo
const BURST_COLORS = [BRAND.sun, BRAND.cobalt, "#C7416E", "#1F8C83", "#C27412"];
function DayDone({ isToday }) {
  const bits = useMemo(() => Array.from({ length: 22 }, (_, i) => {
    const ang = (i / 22) * Math.PI * 2 + Math.random() * 0.4;
    const dist = 60 + Math.random() * 70;
    return { x: Math.cos(ang) * dist, y: Math.sin(ang) * dist * 0.7 - 20, r: Math.round(Math.random() * 540 - 270), c: BURST_COLORS[i % BURST_COLORS.length], w: 5 + Math.random() * 4, d: Math.random() * 0.12 };
  }), []);
  return (
    <div style={{ position: "relative", marginBottom: 16, padding: "16px 18px", borderRadius: 18, background: BRAND.sunSoft, border: "1px solid #F5DDA8", display: "flex", alignItems: "center", gap: 14, animation: "lar-rise .35s ease" }}>
      <div style={{ position: "relative", width: 40, height: 40, flexShrink: 0 }}>
        <div style={{ width: 40, height: 40, borderRadius: 12, background: BRAND.sun, display: "flex", alignItems: "center", justifyContent: "center", animation: "lar-pop .45s ease" }}>
          <Check size={22} color={BRAND.ink} strokeWidth={3} />
        </div>
        {bits.map((b, i) => (
          <span key={i} aria-hidden="true" style={{ position: "absolute", left: 18, top: 18, width: b.w, height: b.w * 0.6, borderRadius: 2, background: b.c, pointerEvents: "none",
            "--x": `${b.x}px`, "--y": `${b.y}px`, "--r": `${b.r}deg`, animation: `lar-burst .9s ${b.d}s cubic-bezier(.15,.7,.3,1) forwards`, opacity: 0 }} />
        ))}
      </div>
      <div>
        <div className="lar-display" style={{ fontSize: 16.5, fontWeight: 600, color: BRAND.ink }}>{isToday ? "Dia fechado!" : "Dia completo"}</div>
        <div style={{ fontSize: 12.5, color: "#7A5B1E", marginTop: 2 }}>{isToday ? "Tudo feito. Aproveitem o resto do dia." : "Tudo deste dia foi feito."}</div>
      </div>
    </div>
  );
}

function Tag({ soft, color, children }) {
  return <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, padding: "2px 7px", borderRadius: 6, background: soft, color }}>{children}</span>;
}

function Metric({ label, value, small }) {
  return (
    <div style={{ flex: 1, background: "#EBEFF6", borderRadius: 11, padding: "11px 13px" }}>
      <div style={{ fontSize: 11.5, color: "#5A6580", marginBottom: 3 }}>{label}</div>
      <div style={{ fontSize: small ? 14 : 21, fontWeight: 500, color: "#18233F" }}>{value}</div>
    </div>
  );
}

function SectionTitle({ icon: Ic, color, children }) {
  return <div className="lar-display" style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, fontSize: 15.5, fontWeight: 600, color }}><Ic size={16} /> {children}</div>;
}

function ApptAdder({ onAdd, C, PEOPLE }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [when, setWhen] = useState("");
  const [who, setWho] = useState("rafa");
  const [day, setDay] = useState(null);
  if (!open) return (
    <button className="rot-btn" onClick={() => setOpen(true)} style={{ display: "flex", alignItems: "center", gap: 6, padding: "9px 13px", borderRadius: 10, border: `1px solid ${C.line}`, background: C.surface, cursor: "pointer", fontSize: 13, color: C.sub, marginBottom: 4 }}>
      <Plus size={15} /> Adicionar consulta
    </button>
  );
  const reset = () => { setTitle(""); setWhen(""); setDay(null); setOpen(false); };
  return (
    <div style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: 14, padding: 14, marginBottom: 4 }}>
      <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="ex: nutricionista, cardiologista"
        style={{ width: "100%", boxSizing: "border-box", padding: "9px 11px", borderRadius: 9, border: `1px solid ${C.line}`, fontSize: 13.5, outline: "none", marginBottom: 8 }} />
      <input value={when} onChange={(e) => setWhen(e.target.value)} placeholder="horário? ex: 15h (opcional)"
        style={{ width: "100%", boxSizing: "border-box", padding: "9px 11px", borderRadius: 9, border: `1px solid ${C.line}`, fontSize: 13.5, outline: "none", marginBottom: 12 }} />

      <Label C={C}>De quem é?</Label>
      <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
        {Object.entries(PEOPLE).map(([k, p]) => (
          <button key={k} onClick={() => setWho(k)} style={{ flex: 1, padding: "7px 0", borderRadius: 9, fontSize: 12, cursor: "pointer", border: `1px solid ${who === k ? p.color : C.line}`, background: who === k ? p.soft : C.surface, color: who === k ? p.color : C.sub, fontWeight: who === k ? 500 : 400 }}>{p.name}</button>
        ))}
      </div>

      <Label C={C}>Em que dia? (vira evento na semana)</Label>
      <div style={{ display: "flex", gap: 5, marginBottom: 6, flexWrap: "wrap" }}>
        {DAYS.map((d, i) => (
          <button key={d} onClick={() => setDay(i)} style={{ flex: "1 0 auto", minWidth: 38, padding: "7px 0", borderRadius: 9, fontSize: 12, cursor: "pointer", border: `1px solid ${day === i ? C.accent : C.line}`, background: day === i ? "#E3EAFB" : C.surface, color: day === i ? C.accent : C.sub, fontWeight: day === i ? 500 : 400 }}>{d}</button>
        ))}
      </div>
      <button onClick={() => setDay(null)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 11.5, color: day === null ? C.accent : C.faint, padding: "2px 0", marginBottom: 12 }}>
        {day === null ? "✓ " : ""}sem dia fixo
      </button>

      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={() => { if (title.trim()) { onAdd({ title: title.trim(), when, who, day }); reset(); } }}
          style={{ flex: 1, padding: "9px 0", borderRadius: 9, border: "none", background: "#18233F", color: "#fff", fontSize: 13, fontWeight: 500, cursor: "pointer" }}>Salvar</button>
        <button onClick={reset} style={{ padding: "9px 16px", borderRadius: 9, border: `1px solid ${C.line}`, background: C.surface, color: C.sub, fontSize: 13, cursor: "pointer" }}>Cancelar</button>
      </div>
    </div>
  );
}

// Navegação da aba Hoje: setas de dia a dia e uma faixa de ontem até os próximos dias.
function DayStrip({ today, dayOffset, setDayOffset, pendingOn, C }) {
  const strip = [-1, 0, 1, 2, 3, 4, 5];
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <button className="rot-btn" onClick={() => setDayOffset(dayOffset - 1)} title="Dia anterior" style={{ ...iconBtn, flexShrink: 0 }}><ChevronLeft size={18} /></button>
        <div style={{ flex: 1, display: "flex", gap: 4, minWidth: 0 }}>
          {strip.map((o) => {
            const d = addDays(today, o); const on = o === dayOffset; const isToday = o === 0;
            const pend = pendingOn(d);
            return (
              <button key={o} onClick={() => setDayOffset(o)} title={fmtDay(d)}
                style={{ flex: 1, minWidth: 0, padding: "6px 0 5px", borderRadius: 10, cursor: "pointer", border: `1px solid ${on ? C.ink : isToday ? C.accent : C.line}`, background: on ? C.ink : C.surface, color: on ? "#fff" : isToday ? C.accent : C.sub, display: "flex", flexDirection: "column", alignItems: "center", gap: 1 }}>
                <span style={{ fontSize: 10.5, opacity: on ? 0.8 : 1 }}>{o === -1 ? "Ontem" : isToday ? "Hoje" : DAYS[dayIdxOf(d)]}</span>
                <span style={{ fontSize: 14, fontWeight: 500 }}>{Number(d.slice(8, 10))}</span>
                <span style={{ width: 5, height: 5, borderRadius: 99, background: pend ? (on ? "#fff" : "#B06A2C") : "transparent" }} />
              </button>
            );
          })}
        </div>
        <button className="rot-btn" onClick={() => setDayOffset(dayOffset + 1)} title="Próximo dia" style={{ ...iconBtn, flexShrink: 0 }}><ChevronRight size={18} /></button>
      </div>
      {(dayOffset < -1 || dayOffset > 5) && (
        <div style={{ textAlign: "center", marginTop: 8 }}>
          <button onClick={() => setDayOffset(0)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 12, color: C.accent, padding: 0 }}>Voltar para hoje</button>
        </div>
      )}
    </div>
  );
}

// Escolher a data para onde jogar uma ocorrência: atalhos para os próximos dias ou qualquer data.
function DatePicker({ fromDate, onPick, C }) {
  const [custom, setCustom] = useState("");
  const quick = [1, 2, 3, 4, 5, 6, 7].map((n) => addDays(fromDate, n));
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 8 }}>
        {quick.map((d, n) => (
          <button key={d} onClick={() => onPick(d)} title={`mover para ${fmtDay(d)}`}
            style={{ flex: "1 0 auto", minWidth: 44, padding: "6px 4px", borderRadius: 9, fontSize: 11.5, cursor: "pointer", border: `1px solid ${C.line}`, background: C.surface, color: C.sub, lineHeight: 1.3 }}>
            <div>{n === 0 ? "+1 dia" : DAYS[dayIdxOf(d)]}</div>
            <div style={{ fontSize: 10.5, color: C.faint }}>{ddmm(d)}</div>
          </button>
        ))}
      </div>
      <div style={{ display: "flex", gap: 6 }}>
        <input type="date" value={custom} onChange={(e) => setCustom(e.target.value)}
          style={{ flex: 1, minWidth: 0, boxSizing: "border-box", padding: "7px 10px", borderRadius: 9, border: `1px solid ${C.line}`, fontSize: 13, color: C.ink, background: C.surface, outline: "none" }} />
        <button disabled={!custom || custom === fromDate} onClick={() => { onPick(custom); setCustom(""); }}
          style={{ padding: "7px 12px", borderRadius: 9, border: "none", background: "#18233F", color: "#fff", fontSize: 12.5, cursor: custom && custom !== fromDate ? "pointer" : "default", opacity: custom && custom !== fromDate ? 1 : 0.4 }}>Mover</button>
      </div>
    </div>
  );
}

const dateInput = (C) => ({ width: "100%", boxSizing: "border-box", padding: "8px 10px", borderRadius: 9, border: `1px solid ${C.line}`, fontSize: 13, color: C.ink, background: C.surface, outline: "none" });

// Atividade avulsa: num dia só, ou repetindo num período (de/até) nos dias escolhidos.
function ExtraAdder({ onAddOne, onAddPeriod, C, PEOPLE, defaultDate }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [who, setWho] = useState("rafa");
  const [cat, setCat] = useState("vida");
  const [mode, setMode] = useState("um"); // "um" | "periodo"
  const [date, setDate] = useState(defaultDate);
  const [start, setStart] = useState(defaultDate);
  const [end, setEnd] = useState(addDays(defaultDate, 7));
  const [days, setDays] = useState([0, 1, 2, 3, 4, 5, 6]);
  const reset = () => { setTitle(""); setCat("vida"); setMode("um"); setOpen(false); };
  const openForm = () => { setDate(defaultDate); setStart(defaultDate); setEnd(addDays(defaultDate, 7)); setDays([0, 1, 2, 3, 4, 5, 6]); setOpen(true); };

  if (!open) return (
    <button className="rot-btn" onClick={openForm}
      style={{ display: "flex", alignItems: "center", gap: 6, padding: "11px 14px", borderRadius: 12, border: `1px dashed ${C.line2}`, background: C.surface, cursor: "pointer", fontSize: 13, color: C.sub, marginTop: 16, width: "100%", justifyContent: "center" }}>
      <Plus size={15} /> Atividade avulsa
    </button>
  );

  const periodOk = start && end && end >= start && days.length > 0;
  const ok = title.trim() && (mode === "um" ? !!date : periodOk);
  // quantas vezes vai acontecer no período (só para mostrar)
  let count = 0;
  if (mode === "periodo" && periodOk) {
    const n = daysBetween(start, end);
    for (let k = 0; k <= n && k < 400; k++) if (days.includes(dayIdxOf(addDays(start, k)))) count++;
  }
  const submit = () => {
    if (!ok) return;
    if (mode === "um") onAddOne(date, { title: title.trim(), who, cat });
    else onAddPeriod({ title: title.trim(), who, cat, start, end, days: [...days].sort((a, b) => a - b) });
    reset();
  };
  const allDays = days.length === 7;
  const weekdays = days.length === 5 && [0, 1, 2, 3, 4].every((d) => days.includes(d));

  return (
    <div style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: 14, padding: 14, marginTop: 16 }}>
      <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="ex: estudar para a certificação, levar o gato no vet"
        style={{ width: "100%", boxSizing: "border-box", padding: "9px 11px", borderRadius: 9, border: `1px solid ${C.line}`, fontSize: 13.5, outline: "none", marginBottom: 12 }} />

      <Label C={C}>De quem é?</Label>
      <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
        {Object.entries(PEOPLE).map(([k, p]) => (
          <button key={k} onClick={() => setWho(k)} style={{ flex: 1, padding: "7px 0", borderRadius: 9, fontSize: 12, cursor: "pointer", border: `1px solid ${who === k ? p.color : C.line}`, background: who === k ? p.soft : C.surface, color: who === k ? p.color : C.sub, fontWeight: who === k ? 500 : 400 }}>{p.name}</button>
        ))}
      </div>

      <Label C={C}>Categoria</Label>
      <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
        {Object.entries(CATEGORIES).map(([k, c]) => (
          <button key={k} onClick={() => setCat(k)} style={{ flex: 1, padding: "7px 0", borderRadius: 9, fontSize: 12, cursor: "pointer", border: `1px solid ${cat === k ? c.color : C.line}`, background: cat === k ? c.soft : C.surface, color: cat === k ? c.color : C.sub, fontWeight: cat === k ? 500 : 400 }}>{c.label}</button>
        ))}
      </div>

      <Label C={C}>Quando?</Label>
      <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
        {[["um", "Num dia só"], ["periodo", "Repetir num período"]].map(([k, lbl]) => (
          <button key={k} onClick={() => setMode(k)} style={{ flex: 1, padding: "7px 0", borderRadius: 9, fontSize: 12, cursor: "pointer", border: `1px solid ${mode === k ? C.accent : C.line}`, background: mode === k ? "#E3EAFB" : C.surface, color: mode === k ? C.accent : C.sub, fontWeight: mode === k ? 500 : 400 }}>{lbl}</button>
        ))}
      </div>

      {mode === "um" ? (
        <div style={{ marginBottom: 12 }}>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={dateInput(C)} />
        </div>
      ) : (
        <>
          <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 11, color: C.faint, marginBottom: 4 }}>De</div>
              <input type="date" value={start} onChange={(e) => setStart(e.target.value)} style={dateInput(C)} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 11, color: C.faint, marginBottom: 4 }}>Até (último dia)</div>
              <input type="date" value={end} min={start} onChange={(e) => setEnd(e.target.value)} style={dateInput(C)} />
            </div>
          </div>
          <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
            <button onClick={() => setDays([0, 1, 2, 3, 4, 5, 6])} style={{ padding: "5px 10px", borderRadius: 8, fontSize: 11.5, cursor: "pointer", border: `1px solid ${allDays ? C.accent : C.line}`, background: allDays ? "#E3EAFB" : C.surface, color: allDays ? C.accent : C.sub }}>Todos os dias</button>
            <button onClick={() => setDays([0, 1, 2, 3, 4])} style={{ padding: "5px 10px", borderRadius: 8, fontSize: 11.5, cursor: "pointer", border: `1px solid ${weekdays ? C.accent : C.line}`, background: weekdays ? "#E3EAFB" : C.surface, color: weekdays ? C.accent : C.sub }}>Dias úteis</button>
          </div>
          <div style={{ display: "flex", gap: 5, marginBottom: 8 }}>
            {DAYS.map((d, i) => {
              const on = days.includes(i);
              return <button key={d} onClick={() => setDays(on ? days.filter((x) => x !== i) : [...days, i])} style={{ flex: 1, padding: "7px 0", borderRadius: 9, fontSize: 12, cursor: "pointer", border: `1px solid ${on ? C.accent : C.line}`, background: on ? C.accent : C.surface, color: on ? "#fff" : C.sub }}>{d}</button>;
            })}
          </div>
          <div style={{ fontSize: 11.5, color: end < start ? "#C04574" : C.faint, marginBottom: 12 }}>
            {end < start ? "A data final precisa ser depois da inicial." : periodOk ? `Vai aparecer ${count} ${count === 1 ? "vez" : "vezes"}, de ${fmtDay(start)} a ${fmtDay(end)}. Depois disso some sozinha.` : "Escolha pelo menos um dia da semana."}
          </div>
        </>
      )}

      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={submit}
          style={{ flex: 1, padding: "9px 0", borderRadius: 9, border: "none", background: "#18233F", color: "#fff", fontSize: 13, fontWeight: 500, cursor: ok ? "pointer" : "default", opacity: ok ? 1 : 0.4 }}>Adicionar</button>
        <button onClick={reset} style={{ padding: "9px 16px", borderRadius: 9, border: `1px solid ${C.line}`, background: C.surface, color: C.sub, fontSize: 13, cursor: "pointer" }}>Cancelar</button>
      </div>
    </div>
  );
}

function HistoryView({ weeks, templates, C, PEOPLE }) {
  const rows = useMemo(() => {
    const out = [];
    for (let o = -1; o >= -12; o--) {
      const id = weekId(o);
      const w = weeks[id];
      if (!w) continue;
      let tot = 0, dn = 0;
      const cheer = { rafa: 0, lucas: 0, both: 0 };
      templates.forEach((t) => {
        occDays(t, w, id).forEach((i) => {
          if (w.skip?.[`${t.id}:${i}`]) return;
          tot++;
          if (w.done?.[`${t.id}:${i}`]) {
            dn++;
            const who = (w.assign && w.assign[`${t.id}:${i}`]) || verOf(t, addDays(id, i)).who;
            cheer[who] = (cheer[who] || 0) + 1;
          }
        });
      });
      (w.extras || []).forEach((e) => {
        if (w.done?.[`${e.id}:${e.day}`]) cheer[e.who] = (cheer[e.who] || 0) + 1;
      });
      const presDays = (w.presence?.rafa?.length || 0) + (w.presence?.lucas?.length || 0);
      out.push({ id, label: weekLabel(o).range, pct: tot ? Math.round((dn / tot) * 100) : 0, dn, tot, presDays, wins: w.wins, cheer });
    }
    return out;
  }, [weeks, templates]);

  const order = ["rafa", "lucas", "both"];

  if (rows.length === 0) {
    return <div style={{ textAlign: "center", padding: "40px 0", color: C.faint, fontSize: 13.5 }}>O histórico aparece aqui assim que vocês fecharem a primeira semana.</div>;
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {rows.map((r) => (
        <div key={r.id} style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: 14, padding: "13px 15px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 9 }}>
            <div style={{ fontSize: 13.5, fontWeight: 500 }}>{r.label}</div>
            <div style={{ fontSize: 12.5, color: r.pct >= 70 ? "#0E7C61" : r.pct >= 40 ? "#B06A2C" : "#C04574", fontWeight: 500 }}>{r.pct}%</div>
          </div>
          <div style={{ height: 5, background: "#E2E7F0", borderRadius: 99, overflow: "hidden", marginBottom: 8 }}>
            <div style={{ height: "100%", width: `${r.pct}%`, background: r.pct >= 70 ? "#0E7C61" : r.pct >= 40 ? "#B06A2C" : "#C04574", borderRadius: 99 }} />
          </div>
          <div style={{ display: "flex", gap: 14, fontSize: 11.5, color: C.faint }}>
            <span>{r.dn}/{r.tot} tarefas</span>
            <span>· {r.presDays} dias presenciais</span>
          </div>
          {(r.cheer.rafa + r.cheer.lucas + r.cheer.both) > 0 && (
            <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${C.line}` }}>
              <div style={{ fontSize: 11.5, color: C.faint, marginBottom: 6 }}>Quem cuidou da casa</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {order.map((k) => r.cheer[k] > 0 && (
                  <span key={k} style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11.5, padding: "3px 9px", borderRadius: 99, background: PEOPLE[k].soft, color: PEOPLE[k].color }}>
                    <Heart size={10} /> {PEOPLE[k].name} · {r.cheer[k]}
                  </span>
                ))}
              </div>
              {r.cheer.rafa > 0 && r.cheer.lucas > 0 && (
                <div style={{ fontSize: 11.5, color: C.sub, marginTop: 7 }}>Casa cuidada a quatro mãos 💛</div>
              )}
            </div>
          )}
          {r.wins && <div style={{ fontSize: 12.5, color: C.sub, marginTop: 8, lineHeight: 1.5, fontStyle: "italic" }}>"{r.wins}"</div>}
        </div>
      ))}
    </div>
  );
}

function ManageTemplates({ templates, setTemplates, C, ti, PEOPLE, peopleRaw, setPeopleRaw }) {
  const today = todayStr();
  const blank = { title: "", cat: "casa", who: "both", days: [ti], flexible: false, freq: "semanal", start: today, until: "" };
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [draft, setDraft] = useState(blank);
  const [showEnded, setShowEnded] = useState(false);

  const openNew = () => { setEditingId(null); setDraft(blank); setAdding(true); };
  const openEdit = (t) => {
    // tarefa que ainda não começou: edita a primeira versão; encerrada: a última
    const ref = firstFrom(t) > today ? firstFrom(t) : (t.until && t.until < today ? t.until : today);
    const v = verOf(t, ref);
    setEditingId(t.id);
    setDraft({ title: v.title, cat: v.cat, who: v.who, days: [...v.days], flexible: !!v.flexible, freq: v.freq || "semanal", start: firstFrom(t), until: t.until || "" });
    setAdding(true);
  };
  const closeForm = () => { setAdding(false); setEditingId(null); setDraft(blank); };

  const sameFields = (v, f) => v.title === f.title && v.cat === f.cat && v.who === f.who && !!v.flexible === f.flexible
    && (v.freq || "semanal") === f.freq && [...(v.days || [])].sort().join() === [...f.days].sort().join();

  const untilOk = !draft.until || draft.until >= (editingId ? "0000-00-00" : draft.start);
  const save = () => {
    if (!draft.title.trim() || draft.days.length === 0 || !untilOk) return;
    const fields = { title: draft.title.trim(), cat: draft.cat, who: draft.who, days: draft.days, flexible: draft.flexible, freq: draft.freq || "semanal" };
    if (editingId) {
      setTemplates(templates.map((t) => {
        if (t.id !== editingId) return t;
        // versionamento: a alteração vale a partir de hoje (ou do início, se ainda não começou);
        // o histórico anterior fica preservado. Mudar só a data de término não cria versão nova.
        const from = firstFrom(t) > today ? firstFrom(t) : today;
        const nt = sameFields(verOf(t, from), fields) ? t : withNewVersion(t, from, fields);
        return withUntil(nt, draft.until || null);
      }));
    } else {
      const nt = { id: "u" + Date.now(), versions: [{ from: draft.start || today, ...fields }] };
      setTemplates([...templates, withUntil(nt, draft.until || null)]);
    }
    closeForm();
  };
  const remove = (id) => { setTemplates(templates.filter((t) => t.id !== id)); if (editingId === id) closeForm(); };
  const reactivate = (id) => setTemplates(templates.map((t) => t.id === id ? withUntil(t, null) : t));
  const activeList = templates.filter((t) => !isEnded(t, today));
  const endedList = templates.filter((t) => isEnded(t, today));

  return (
    <div style={{ animation: "fade .25s ease" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
        <div>
          <div className="lar-display" style={{ fontSize: 19, fontWeight: 600, letterSpacing: -0.3 }}>Tarefas recorrentes</div>
          <div style={{ fontSize: 12, color: C.faint, marginTop: 1 }}>A base que se repete toda semana</div>
        </div>
        <button onClick={() => (adding && !editingId ? closeForm() : openNew())} style={{ display: "flex", alignItems: "center", gap: 5, padding: "8px 13px", borderRadius: 10, border: "none", background: (adding && !editingId) ? "#EBEFF6" : "#18233F", color: (adding && !editingId) ? C.sub : "#fff", fontSize: 13, fontWeight: 500, cursor: "pointer" }}>
          {(adding && !editingId) ? <X size={15} /> : <Plus size={15} />} {(adding && !editingId) ? "Fechar" : "Nova"}
        </button>
      </div>

      {adding && (
        <div style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: 14, padding: 15, margin: "14px 0", animation: "fade .2s ease" }}>
          <div style={{ fontSize: 12.5, color: C.faint, marginBottom: 10 }}>{editingId ? "Editando tarefa" : "Nova tarefa"}</div>
          <input autoFocus value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} placeholder="O que precisa ser feito?"
            style={{ width: "100%", boxSizing: "border-box", padding: "10px 12px", borderRadius: 9, border: `1px solid ${C.line}`, fontSize: 14, outline: "none", marginBottom: 13 }} />

          <Label C={C}>Categoria</Label>
          <div style={{ display: "flex", gap: 6, marginBottom: 13, flexWrap: "wrap" }}>
            {Object.entries(CATEGORIES).map(([k, c]) => {
              const Ic = c.icon; const on = draft.cat === k;
              return <button key={k} onClick={() => setDraft({ ...draft, cat: k })} style={{ display: "flex", alignItems: "center", gap: 5, padding: "7px 12px", borderRadius: 9, fontSize: 12.5, cursor: "pointer", border: `1px solid ${on ? c.color : C.line}`, background: on ? c.soft : C.surface, color: on ? c.color : C.sub, fontWeight: on ? 500 : 400 }}><Ic size={12} /> {c.label}</button>;
            })}
          </div>

          <Label C={C}>Responsável</Label>
          <div style={{ display: "flex", gap: 6, marginBottom: 13 }}>
            {Object.entries(PEOPLE).map(([k, p]) => {
              const on = draft.who === k;
              return <button key={k} onClick={() => setDraft({ ...draft, who: k })} style={{ flex: 1, padding: "8px 0", borderRadius: 9, fontSize: 12.5, cursor: "pointer", border: `1px solid ${on ? p.color : C.line}`, background: on ? p.soft : C.surface, color: on ? p.color : C.sub, fontWeight: on ? 500 : 400 }}>{p.name}</button>;
            })}
          </div>

          <Label C={C}>Frequência</Label>
          <div style={{ display: "flex", gap: 6, marginBottom: 13 }}>
            {[["semanal", "Toda semana"], ["quinzenal", "A cada 2 semanas"], ["mensal", "1x no mês"]].map(([k, lbl]) => {
              const on = (draft.freq || "semanal") === k;
              return <button key={k} onClick={() => setDraft({ ...draft, freq: k })} style={{ flex: 1, padding: "7px 4px", borderRadius: 9, fontSize: 11.5, cursor: "pointer", border: `1px solid ${on ? C.accent : C.line}`, background: on ? "#E3EAFB" : C.surface, color: on ? C.accent : C.sub, fontWeight: on ? 500 : 400 }}>{lbl}</button>;
            })}
          </div>

          <Label C={C}>{draft.freq === "mensal" ? "Qual dia da semana? (1ª vez no mês)" : draft.freq === "quinzenal" ? "Quais dias? (a cada 2 semanas)" : "Quais dias?"}</Label>
          <div style={{ display: "flex", gap: 5, marginBottom: 13 }}>
            {DAYS.map((d, i) => {
              const on = draft.days.includes(i);
              return <button key={d} onClick={() => setDraft({ ...draft, days: on ? draft.days.filter((x) => x !== i) : [...draft.days, i] })} style={{ flex: 1, padding: "8px 0", borderRadius: 9, fontSize: 12, cursor: "pointer", border: `1px solid ${on ? C.accent : C.line}`, background: on ? C.accent : C.surface, color: on ? "#fff" : C.sub }}>{d}</button>;
            })}
          </div>

          <div style={{ display: "flex", gap: 8, marginBottom: 6 }}>
            {!editingId && (
              <div style={{ flex: 1, minWidth: 0 }}>
                <Label C={C}>Começa em</Label>
                <input type="date" value={draft.start} onChange={(e) => setDraft({ ...draft, start: e.target.value || today })} style={dateInput(C)} />
              </div>
            )}
            <div style={{ flex: 1, minWidth: 0 }}>
              <Label C={C}>Termina em (opcional)</Label>
              <input type="date" value={draft.until} min={editingId ? undefined : draft.start} onChange={(e) => setDraft({ ...draft, until: e.target.value })} style={dateInput(C)} />
            </div>
          </div>
          <div style={{ display: "flex", gap: 12, marginBottom: 13, fontSize: 11.5 }}>
            {editingId && <button onClick={() => setDraft({ ...draft, until: today })} style={{ background: "none", border: "none", padding: 0, cursor: "pointer", color: C.accent, fontSize: 11.5 }}>Encerrar hoje</button>}
            {draft.until && <button onClick={() => setDraft({ ...draft, until: "" })} style={{ background: "none", border: "none", padding: 0, cursor: "pointer", color: C.faint, fontSize: 11.5 }}>Sem data de término</button>}
            {!untilOk && <span style={{ color: "#C04574" }}>O término precisa ser depois do início.</span>}
            {untilOk && draft.until && <span style={{ color: C.faint }}>Último dia: {fmtDay(draft.until)}. Depois disso sai da rotina, mas o histórico fica.</span>}
          </div>

          <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14, cursor: "pointer", fontSize: 12.5, color: C.sub }}>
            <button onClick={() => setDraft({ ...draft, flexible: !draft.flexible })} style={{ width: 20, height: 20, borderRadius: 6, border: `2px solid ${draft.flexible ? C.accent : "#C9D1DF"}`, background: draft.flexible ? C.accent : "transparent", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", padding: 0 }}>
              {draft.flexible && <Check size={12} color="#fff" />}
            </button>
            Flexível — pode mudar de dia conforme os dias presenciais
          </label>

          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={save} style={{ flex: 1, padding: "11px 0", borderRadius: 9, border: "none", background: "#18233F", color: "#fff", fontSize: 13.5, fontWeight: 500, cursor: "pointer", opacity: draft.title.trim() && draft.days.length ? 1 : 0.4 }}>{editingId ? "Salvar alterações" : "Adicionar à rotina"}</button>
            {editingId && <button onClick={closeForm} style={{ padding: "11px 16px", borderRadius: 9, border: `1px solid ${C.line}`, background: C.surface, color: C.sub, fontSize: 13.5, cursor: "pointer" }}>Cancelar</button>}
          </div>
        </div>
      )}

      <div style={{ marginTop: 14 }}>
        {Object.entries(CATEGORIES).map(([ck, cat]) => {
          const group = activeList.filter((t) => verOf(t, firstFrom(t) > today ? firstFrom(t) : today).cat === ck);
          if (!group.length) return null;
          const Ic = cat.icon;
          return (
            <div key={ck} style={{ marginBottom: 16 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}><Ic size={13} color={cat.color} /><span style={{ fontSize: 12, fontWeight: 500, color: cat.color }}>{cat.label}</span></div>
              <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                {group.map((t) => {
                  const notYet = firstFrom(t) > today;
                  const cv = verOf(t, notYet ? firstFrom(t) : today); const p = PEOPLE[cv.who]; const isEd = editingId === t.id;
                  return (
                    <div key={t.id} className="rot-row" onClick={() => openEdit(t)} style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 13px", background: C.surface, border: `1px solid ${isEd ? C.accent : C.line}`, borderRadius: 11, cursor: "pointer" }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13.5, display: "flex", alignItems: "center", gap: 6 }}>{cv.title}{cv.flexible && <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 5, background: softOf(PEOPLE.both.color), color: PEOPLE.both.color }}>flexível</span>}</div>
                        <div style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 4, flexWrap: "wrap" }}>
                          <Tag soft={p.soft} color={p.color}>{p.name}</Tag>
                          <span style={{ fontSize: 11.5, color: C.faint }}>{cv.days.length === 7 ? "Todos os dias" : [...cv.days].sort((a, b) => a - b).map((d) => DAYS[d]).join(", ")}</span>
                          {cv.freq && cv.freq !== "semanal" && <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 5, background: "#EBEFF6", color: C.faint }}>{cv.freq === "quinzenal" ? "quinzenal" : "mensal"}</span>}
                          {notYet && <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 5, background: "#E3EAFB", color: C.accent }}>começa {ddmm(firstFrom(t))}</span>}
                          {t.until && <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 5, background: "#EBEFF6", color: C.faint }}>até {ddmm(t.until)}</span>}
                        </div>
                      </div>
                      <button className="rot-btn" onClick={(e) => { e.stopPropagation(); openEdit(t); }} style={{ ...iconBtn, width: 32, height: 32, border: "none" }} aria-label="Editar"><Pencil size={14} color="#8E97AD" /></button>
                      <button className="rot-btn" onClick={(e) => { e.stopPropagation(); remove(t.id); }} style={{ ...iconBtn, width: 32, height: 32, border: "none" }} aria-label="Apagar"><Trash2 size={15} color="#B9C2D3" /></button>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {endedList.length > 0 && (
        <div style={{ marginTop: 6 }}>
          <button onClick={() => setShowEnded(!showEnded)} style={{ display: "flex", alignItems: "center", gap: 5, background: "none", border: "none", padding: 0, cursor: "pointer", fontSize: 12.5, color: C.sub }}>
            {showEnded ? <ChevronDown size={14} /> : <ChevronRight size={14} />} Encerradas ({endedList.length})
          </button>
          {showEnded && (
            <div style={{ display: "flex", flexDirection: "column", gap: 7, marginTop: 10 }}>
              {endedList.map((t) => {
                const cv = verOf(t, t.until); const p = PEOPLE[cv.who] || PEOPLE.both;
                return (
                  <div key={t.id} className="rot-row" style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 13px", background: C.surface, border: `1px solid ${C.line}`, borderRadius: 11, opacity: 0.75 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13.5, color: C.sub }}>{cv.title}</div>
                      <div style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 4, flexWrap: "wrap" }}>
                        <Tag soft={p.soft} color={p.color}>{p.name}</Tag>
                        <span style={{ fontSize: 11.5, color: C.faint }}>encerrada em {ddmm(t.until)}</span>
                      </div>
                    </div>
                    <button className="rot-btn" onClick={() => reactivate(t.id)} style={{ padding: "6px 10px", borderRadius: 8, border: `1px solid ${C.line}`, background: C.surface, cursor: "pointer", fontSize: 12, color: C.sub }}>Reativar</button>
                    <button className="rot-btn" onClick={() => remove(t.id)} style={{ ...iconBtn, width: 32, height: 32, border: "none" }} aria-label="Apagar"><Trash2 size={15} color="#B9C2D3" /></button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      <PeopleEditor peopleRaw={peopleRaw} setPeopleRaw={setPeopleRaw} C={C} />
    </div>
  );
}

function PeopleEditor({ peopleRaw, setPeopleRaw, C }) {
  const update = (key, field, value) => setPeopleRaw({ ...peopleRaw, [key]: { ...peopleRaw[key], [field]: value } });
  const order = ["rafa", "lucas", "both"];
  const heading = { rafa: "Pessoa 1", lucas: "Pessoa 2", both: "Tarefas em dupla" };
  return (
    <div style={{ marginTop: 26, paddingTop: 18, borderTop: `1px solid ${C.line}` }}>
      <div className="lar-display" style={{ fontSize: 19, fontWeight: 600, letterSpacing: -0.3, marginBottom: 2 }}>Pessoas</div>
      <div style={{ fontSize: 12, color: C.faint, marginBottom: 14 }}>Edite os nomes e a cor de cada um</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {order.map((key) => {
          const p = peopleRaw[key];
          return (
            <div key={key} style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: 12, padding: 13 }}>
              <div style={{ fontSize: 11.5, color: C.faint, marginBottom: 8 }}>{heading[key]}</div>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                <div style={{ width: 30, height: 30, borderRadius: 9, background: softOf(p.color), display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <User size={15} color={p.color} />
                </div>
                <input value={p.name} onChange={(e) => update(key, "name", e.target.value)} placeholder="nome"
                  style={{ flex: 1, boxSizing: "border-box", padding: "9px 11px", borderRadius: 9, border: `1px solid ${C.line}`, fontSize: 13.5, outline: "none" }} />
              </div>
              <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
                {PERSON_COLORS.map((c) => (
                  <button key={c} onClick={() => update(key, "color", c)} aria-label={`cor ${c}`}
                    style={{ width: 26, height: 26, borderRadius: 8, background: c, cursor: "pointer", border: p.color === c ? `2px solid ${C.ink}` : "2px solid transparent", padding: 0 }} />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Label({ children, C }) {
  return <div style={{ fontSize: 11.5, color: C.faint, marginBottom: 7 }}>{children}</div>;
}
