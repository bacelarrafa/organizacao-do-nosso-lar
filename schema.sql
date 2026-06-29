-- ============================================================
-- Nossa Semana — schema do banco (Supabase / Postgres)
-- ============================================================
-- Modelo simples: cada "lar" (household) tem UM registro com todo
-- o estado do app em JSON. Os dois cônjuges abrem o mesmo link e
-- compartilham os mesmos dados, em tempo real. O "code" é apenas um
-- identificador fixo do lar (definido em src/App.jsx), não algo digitado.
--
-- Por que JSON num campo só? Porque o app já organiza tudo em
-- três blocos (templates, weeks, people). Guardar como JSON evita
-- montar 5 tabelas e joins — é o suficiente pra um app de casal e
-- mantém o código quase idêntico ao que você já tem.
-- ============================================================

create table if not exists households (
  code        text primary key,            -- identificador fixo do lar (vem de HOUSEHOLD_CODE)
  templates   jsonb not null default '[]',  -- tarefas recorrentes
  weeks       jsonb not null default '{}',  -- estado por semana (feito, presencial, refeições...)
  people      jsonb not null default '{}',  -- nomes e cores das pessoas
  updated_at  timestamptz not null default now()
);

-- Atualiza updated_at automaticamente a cada alteração
create or replace function touch_household()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_touch_household on households;
create trigger trg_touch_household
  before update on households
  for each row execute function touch_household();

-- ============================================================
-- Segurança (RLS)
-- ============================================================
-- Mantemos RLS ligado e liberamos acesso via a chave pública (anon).
-- O app é só de vocês dois e não há dados sensíveis (rotina doméstica),
-- então este nível é adequado. A privacidade vem de o link ser só de vocês.
-- ============================================================

alter table households enable row level security;

drop policy if exists "acesso por anon" on households;
create policy "acesso por anon"
  on households
  for all
  to anon
  using (true)
  with check (true);

-- Habilita realtime (sincronização ao vivo entre os dois)
alter publication supabase_realtime add table households;
