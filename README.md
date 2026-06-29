# Organização do nosso lar 💛

A rotina compartilhada de um casal: tarefas da casa, dias presenciais no escritório,
plano de refeições, consultas e histórico semana a semana. Funciona no computador e no
celular, e o que um marca o outro vê — ao vivo.

---

## Como funciona (a arquitetura em 30 segundos)

São só **duas peças**:

- **GitHub** — guarda o código **e** hospeda o site, de graça, pelo GitHub Pages.
  Toda vez que você dá `push`, ele se republica sozinho.
- **Supabase** — guarda os dados compartilhados (um banco Postgres gratuito).
  É a única ferramenta externa, e ela existe por um motivo simples: pra dois
  aparelhos diferentes verem a mesma rotina, os dados precisam morar num servidor.

Não tem Vercel, não tem servidor pra manter, não tem mensalidade. O plano gratuito
do GitHub e do Supabase cobre o uso de vocês dois com folga.

---

## O que você vai precisar

- Uma conta no **GitHub** — https://github.com
- Uma conta no **Supabase** — https://supabase.com
- (Opcional, só se quiser testar na sua máquina antes) **Node.js 20+** instalado

O caminho abaixo coloca o app no ar **sem instalar nada** — o build roda dentro do
próprio GitHub. Se quiser rodar local antes, veja a seção "Rodar na sua máquina".

---

## Passo 1 — Criar o banco no Supabase

1. Entre em https://supabase.com e crie um projeto novo (escolha a região mais
   próxima, ex: *South America (São Paulo)*). Anote a senha do banco; você não
   vai precisar dela aqui, mas guarde.
2. No menu lateral, abra **SQL Editor** → **New query**.
3. Abra o arquivo [`supabase/schema.sql`](./supabase/schema.sql) deste repositório,
   copie todo o conteúdo, cole no editor e clique em **Run**. Isso cria a tabela
   `households` e liga a sincronização ao vivo.
4. Pegue as duas credenciais do projeto:
   - **Project URL** (algo como `https://xxxx.supabase.co`) — fica em
     **Settings → API**, ou no botão **Connect** no topo do projeto.
   - **Publishable key** (no formato `sb_publishable_...`) — fica em
     **Settings → API Keys**, aba **API Keys**. Se ainda não houver uma, clique em
     **Create new API keys** e copie o valor da seção *Publishable key*.
     (Projetos antigos ainda mostram a chave **anon public** na aba *Legacy* — ela
     também funciona, mas a publishable é a recomendada daqui pra frente.)

Guarde os dois — eles vão para o GitHub no Passo 3.

> Essa chave é **pública por natureza** e vai aparecer no código do site (é assim
> que o Supabase funciona; a publishable tem o mesmo nível de permissão da antiga
> anon). A privacidade aqui vem de o link ser só de vocês — veja a seção de
> segurança lá embaixo. Por isso o schema já liga RLS na tabela.

---

## Passo 2 — Subir o código pro GitHub

1. No GitHub, clique em **New repository**. Dê um nome (ex: `nossa-semana`).
   Deixe **público** (no plano gratuito do GitHub, o Pages só funciona com repo
   público). Pode ficar tranquila: o código é genérico, o `.env` nunca sobe
   (`.gitignore`), os secrets ficam protegidos mesmo com o repo público, e a única
   chave que aparece é a publishable — que é pública por design. A privacidade dos
   dados vem do Supabase, não do repositório.
2. Suba os arquivos. Se você usa Git no terminal, dentro da pasta do projeto:

   ```bash
   git init
   git add .
   git commit -m "primeira versão"
   git branch -M main
   git remote add origin https://github.com/SEU-USUARIO/nossa-semana.git
   git push -u origin main
   ```

   (Se preferir, dá pra arrastar os arquivos pela interface do GitHub, em
   *Add file → Upload files*.)

---

## Passo 3 — Guardar as chaves do Supabase no GitHub

Pra publicação automática funcionar, o GitHub precisa das duas chaves do Supabase.
Elas ficam guardadas em segredo, fora do código.

1. No repositório, vá em **Settings → Secrets and variables → Actions**.
2. Clique em **New repository secret** e crie os dois, exatamente com estes nomes:

   | Nome do secret              | Valor                                  |
   | --------------------------- | -------------------------------------- |
   | `VITE_SUPABASE_URL`         | a *Project URL* do Passo 1             |
   | `VITE_SUPABASE_ANON_KEY`    | a **Publishable key** do Passo 1       |

   > O nome da variável continua `VITE_SUPABASE_ANON_KEY` mesmo usando a publishable
   > key — é só o nome interno; o valor é o `sb_publishable_...`. Não precisa mexer no código.

---

## Passo 4 — Ligar o GitHub Pages

1. No repositório, vá em **Settings → Pages**.
2. Em **Build and deployment → Source**, escolha **GitHub Actions**.

Pronto. A partir daqui, todo `push` na branch `main` republica o app sozinho.
A primeira publicação acontece automaticamente. Acompanhe pela aba **Actions**;
quando ficar verde, o link aparece em **Settings → Pages** (algo como
`https://SEU-USUARIO.github.io/nossa-semana/`).

---

## Passo 5 — Entrar (você e o Lucas)

1. Abra o link do Pages no navegador. Pronto — a rotina já abre direto, sem
   digitar nada.
2. Mande o **mesmo link** pro seu par. Ao abrir, ele vê e edita a mesma rotina
   que você, ao vivo. É só isso.

### No celular: virar um ícone (como app)
- **iPhone (Safari):** botão de compartilhar → *Adicionar à Tela de Início*.
- **Android (Chrome):** menu (⋮) → *Adicionar à tela inicial*.

Aí abre em tela cheia, com o ícone do coração, igual a um app instalado.

---

## Privacidade (sem código, como você pediu)

Não tem cadastro nem senha — de propósito, pra ser simples pra um casal. Quem tiver
o **link** acessa a rotina. Como o link é obscuro e só de vocês, isso é adequado pra
rotina doméstica (não tem dado sensível aqui). Em troca da simplicidade:

- **Não divulguem o link** — tratem ele como algo privado de vocês.
- O "lar" é identificado por uma palavra fixa no código, em `src/App.jsx`:
  a constante `HOUSEHOLD_CODE` (vem como `"lar-rafa-lucas"`). Se quiserem, troquem
  por algo só de vocês (ex: `"lar-bacellar-7q2"`) — funciona como um identificador
  permanente que ninguém precisa digitar.
- Se um dia quiserem login por e-mail de verdade, dá pra evoluir o Supabase pra isso.

---

## Rodar na sua máquina (opcional)

Só se quiser testar antes de publicar:

```bash
# 1. copie o exemplo de variáveis e preencha com suas chaves do Supabase
cp .env.example .env
# edite o .env e cole a URL e a anon key

# 2. instale e rode
npm install
npm run dev
```

Abra o endereço que aparecer no terminal (geralmente `http://localhost:5173`).
O `.env` **nunca** é enviado ao GitHub — o `.gitignore` já cuida disso.

---

## Estrutura das pastas

```
nossa-semana/
├── .github/workflows/deploy.yml   # publicação automática no Pages
├── public/                        # ícones + manifest (tela de início)
├── src/
│   ├── App.jsx                    # o app inteiro
│   ├── main.jsx                   # ponto de entrada
│   └── supabaseClient.js          # conexão com o Supabase
├── supabase/
│   └── schema.sql                 # cole isto no SQL Editor do Supabase
├── .env.example                   # modelo das variáveis (copie pra .env)
├── index.html
├── package.json
├── vite.config.js
└── README.md                      # este arquivo
```

---

## Quando der ruim

- **A aba Actions ficou vermelha?** Abra o passo que falhou e leia a última linha.
  Quase sempre é um secret com nome errado (confira `VITE_SUPABASE_URL` e
  `VITE_SUPABASE_ANON_KEY`, sem espaços).
- **Abre o site mas não salva nada?** Provável que o schema não rodou no Supabase,
  ou as chaves estão trocadas. Refaça o Passo 1 e confira os secrets.
- **Tela em branco?** Veja o console do navegador (F12). Se reclamar das variáveis
  do Supabase, é sinal de que o build não recebeu os secrets — confira o Passo 3.
