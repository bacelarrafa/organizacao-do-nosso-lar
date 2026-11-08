import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  console.error(
    "Faltam as variáveis VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY. " +
    "Copie .env.example para .env e preencha com as chaves do seu projeto Supabase."
  );
}

// O login fica guardado numa chave só deste app. O Próximo Lar usa a mesma base de
// usuários (mesmo projeto Supabase), mas guarda a sessão dele em outra chave, então
// os dois apps não se atrapalham mesmo abertos no mesmo endereço.
export const supabase = createClient(url || "", anonKey || "", {
  auth: { storageKey: "lar-auth", persistSession: true, autoRefreshToken: true },
});
