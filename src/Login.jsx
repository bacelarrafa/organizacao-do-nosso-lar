import React, { useState, useEffect } from "react";
import { Lock, Home } from "lucide-react";
import { supabase } from "./supabaseClient";

/* Login do app inteiro. Usa os mesmos usuários do Próximo Lar
   (mesmo projeto Supabase): mesmo e-mail e mesma senha. */

const C = { ink: "#18233F", sub: "#5A6580", faint: "#8E97AD", line: "#E2E7F0", bad: "#C04574", cobalt: "#2348A6", cobaltDeep: "#183580" };
const input = { border: `1px solid ${C.line}`, background: "#F7F9FC", borderRadius: 10, padding: "11px 12px", fontSize: 14.5, fontFamily: "inherit", color: C.ink, width: "100%", outline: "none", boxSizing: "border-box" };

export function useSession() {
  const [session, setSession] = useState(undefined); // undefined = ainda verificando
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session || null));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s || null));
    return () => sub.subscription.unsubscribe();
  }, []);
  return session;
}

export function LoginScreen() {
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const go = async () => {
    if (!email.trim() || !pass) return;
    setBusy(true); setErr(null);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password: pass });
    setBusy(false);
    if (error) setErr("E-mail ou senha não conferem. São os mesmos do Próximo Lar.");
  };
  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: "24px 16px", fontFamily: "var(--font-body)", background: "#F3F5F9" }}>
      <div style={{ width: "100%", maxWidth: 380 }}>
        <div style={{ background: `linear-gradient(135deg, ${C.cobalt}, ${C.cobaltDeep})`, color: "#fff", borderRadius: 20, padding: "22px 20px", marginBottom: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 13.5, fontWeight: 600, opacity: 0.85 }}><Home size={14} /> Nosso lar</div>
          <div style={{ fontFamily: "var(--font-display)", fontSize: 24, fontWeight: 600, marginTop: 8, letterSpacing: -0.4 }}>Entrar</div>
          <div style={{ fontSize: 13, opacity: 0.85, marginTop: 4, lineHeight: 1.45 }}>Use o mesmo e-mail e senha do Próximo Lar. Cada aparelho pede uma vez só.</div>
        </div>
        <div style={{ background: "#fff", border: `1px solid ${C.line}`, borderRadius: 16, padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
          <input style={input} type="email" autoComplete="email" placeholder="E-mail" value={email} onChange={(e) => setEmail(e.target.value)} />
          <input style={input} type="password" autoComplete="current-password" placeholder="Senha" value={pass} onChange={(e) => setPass(e.target.value)} onKeyDown={(e) => e.key === "Enter" && go()} />
          {err && <div style={{ fontSize: 12.5, color: C.bad }}>{err}</div>}
          <button onClick={go} disabled={busy} style={{ border: "none", background: C.ink, color: "#fff", borderRadius: 10, padding: 12, fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", display: "flex", alignItems: "center", justifyContent: "center", gap: 7 }}>
            <Lock size={14} /> {busy ? "Entrando…" : "Entrar"}
          </button>
        </div>
      </div>
    </div>
  );
}
