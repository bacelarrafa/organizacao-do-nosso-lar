import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  console.error(
    "Faltam as variáveis VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY. " +
    "Copie .env.example para .env e preencha com as chaves do seu projeto Supabase."
  );
}

export const supabase = createClient(url || "", anonKey || "");
