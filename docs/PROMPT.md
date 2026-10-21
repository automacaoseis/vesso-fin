# Vesso FIN — prompt de construção (Fase 1)

*Versão de 21/10/2026. Use em uma sessão nova de código, no repositório `vesso-fin`, com os dois arquivos SQL ao lado:*
*`sql/0001_bpo_fin_nucleo.sql` e `sql/0002_bpo_fin_importa_historico_seis.sql` (e os testes em `test/`).*

---

## 0. Quem você é nesta tarefa

Você vai construir o **Vesso FIN**, o sistema de BPO financeiro da Vesso (Agência Seis e Marketing) para médicos. É um app **novo e separado**, irmão do `vesso-admin` e do `vesso-clientes`, sobre o **mesmo Supabase** (projeto `gzdvkqzliyupiuyaqkpj`, região `us-east-1`).

Trabalhe assim:
- **Cheque no banco antes de afirmar.** O schema real manda; este documento pode estar velho em algum detalhe.
- **Teste antes de entregar.** Toda migration roda primeiro num Postgres local com os stubs de `test/`, depois num *branch* do Supabase, e só então em produção. O banco **não tem staging**.
- **Quando discordar deste documento, diga e explique.** Não contorne em silêncio.

---

## 1. Decisões travadas (não reabrir sem o Luiz)

**Produto**
- Escada: Nível 1 BPO (rotina) → Nível 2 Controladoria (DRE, margem, painel) → Nível 3 Direção. **A Fase 1 cobre os níveis 1 e 2.**
- Nomes externos: "Vesso Financeiro" (níveis 1–2) e "Vesso Direção" (nível 3). Internamente: BPO, Controladoria, CFO.
- **Só PJ.** A PF do médico está fora do escopo: `entidades.cnpj` é obrigatório.
- Escopo negativo: não fazemos escrituração contábil nem fiscal, não movimentamos conta bancária sozinhos, não guardamos senha de banco, não fazemos folha nem DP, não montamos guia TISS.
- **O diferencial é o loop do anúncio ao caixa** (CAC e margem por procedimento). Ele **não** entra na Fase 1, mas o modelo não pode impedir: o título de receita vai ganhar, na Fase 4, um vínculo com `resultados_seis.jornada_paciente`.

**Sistema**
- **Vesso FIN concentra todo o financeiro:** o da Seis (organização `casa`), o da empresa da Lara (outra organização `casa`) e os clientes do BPO (organizações `cliente`).
- Durante a transição, o `financeiro_seis` (no seis-sistema) **continua funcionando intacto**. O Vesso FIN é alimentado em paralelo. Critério de desligamento: **3 meses seguidos com `v_conferencia_dre_seis.nao_explicado = 0`**.
- **Organização `casa` nunca entra em `app_seis.clientes`.** Isso protege a contagem de clientes, as metas do time e as faixas de custo e faturamento.
- **Luiz é o único "dono"** (`bpo_fin.donos`): vê e faz tudo, inclusive nas `casa`. O papel vem de concessão nominal, **não** do cargo `ceo`, porque esse nível também abre acesso para `coord_operacoes` e `admin_tecnico`.
- **Ninguém mais vê tudo.** A visibilidade é por concessão de papel em cada organização (`org_acessos`). O head do produto recebe `id_org = NULL`, que cobre **só** as organizações `cliente`.
- **`app_seis.fn_admin_clientes_visiveis()` NÃO é usada no `bpo_fin`.** Ela não filtra por produto: um gestor de tráfego alocado num cliente veria o caixa desse cliente.
- **Permissão por ação**, não só por linha: lançar ≠ revisar ≠ liberar ≠ reabrir. **O revisor nunca é o executor**, e o banco garante isso.
- **O portal do médico continua no `vesso-clientes`** (abas Meu Caixa e Relatórios na Fase 1b), mostrando só meses **liberados**.

---

## 2. Arquitetura

```
Navegador ─HTTPS─▶ Vercel · apps/web (Next 16, App Router)
   só vê o            · login por Server Action (o navegador NUNCA fala com *.supabase.co)
   domínio do app     · sessão em cookie httpOnly
                      · Server Components/Actions chamam a API com:
                          Authorization: Bearer <access_token do usuário>
                          X-Vesso-Service: <HMAC do corpo + timestamp, segredo compartilhado>
                              │
                              ▼
                   Railway (US East) · apps/api (Hono, Node 22)
                      1. valida o HMAC de serviço (rejeita sem ele)
                      2. valida o JWT do usuário (JWKS do Supabase Auth, ou o JWT secret
                         se o projeto ainda não migrou para signing keys — CONFIRMAR)
                      3. checa a ação (pré-checagem para mensagem amigável;
                         a checagem que vale é a do banco)
                      4. abre transação como `vesso_fin_api`:
                           set local role authenticated;
                           select set_config('request.jwt.claims', <claims>, true);
                         → auth.uid() funciona, a RLS se aplica, as RPCs checam a ação
                   Railway · apps/worker (mesmo pacote, outro entrypoint)
                      · login `vesso_fin_worker` — escreve SÓ bronze, prata e jobs
                      · fila: bpo_fin.fila_jobs com SELECT … FOR UPDATE SKIP LOCKED
                      · adapters: OFX (Nubank) e Asaas API na Fase 1a
                              │  Postgres direto (pooler do Supabase, transaction mode)
                              ▼
                   Supabase · schema bpo_fin
                      · FORA da Data API (remover em Settings → API → Exposed schemas)
                      · RLS em toda tabela; escrita só por RPC SECURITY DEFINER
```

**Regras de segurança (bloqueiam merge):**
1. Nenhuma variável `NEXT_PUBLIC_SUPABASE_*` no `apps/web`, e nenhum import de `@supabase/supabase-js` em Client Component. Configure uma regra de lint que barre isso.
2. **`service_role` não existe no Vesso FIN.** Nem na API, nem no worker. Se algo parecer exigir, a resposta é uma RPC nova com checagem de ação.
3. O worker não tem permissão em `titulos`, `baixas` nem `fechamento_mensal`. Isso é garantido pelos GRANTs da 0001; mantenha assim.
4. Credencial de banco ou de Asaas vai para o **Vault do Supabase**; `conexoes.id_segredo` só guarda o id. O worker lê o segredo por uma função própria, criada para ele.
5. Vercel e Railway nas regiões vizinhas do banco: funções da Vercel em `iad1`, Railway em `US East`.
6. **Não conte com liberar só os IPs da Vercel na Railway.** Fora do plano Enterprise a Vercel não tem IP de saída fixo. A proteção é o JWT mais o HMAC.

**Repositórios**
- `vesso-fin`: monorepo pnpm com `apps/web`, `apps/api` (API e worker) e `packages/shared` (schemas zod, tipos, `fmtBRL`, enums de status).
- **`seis-db` (novo): o único lugar de migrations do banco inteiro.** Hoje as 568 migrations moram em `seis-sistema/supabase/migrations`. Passo 0: copiar todas para o `seis-db`, combinar com o time que nenhuma migration nova nasce no seis-sistema, e colocar as do `bpo_fin` ali. Dois repositórios com migrations no mesmo banco disputam o histórico do Supabase CLI.

**Base do front: fork enxuto do `vesso-admin`.** Ele já tem a identidade Vesso aplicada e auditada contra o brandbook. Leve:
- `src/lib/theme.ts` e `src/app/globals.css`, com os dois temas e as rampas;
- `layout.tsx` (Public Sans + Newsreader via `next/font`, `data-theme` vindo do cookie, sem flash);
- `lib/densidade*` (o zoom pessoal: compacto, confortável, amplo);
- `Shell`, `PageHero`, `components/ui.tsx` e `components/tabela.tsx`;
- a camada responsiva (`.v-scroll-x`, `.v-stack`, breakpoint de 720px).

**Não leve:** nada de tráfego, Kommo, trilha, criativos; `lib/supabase/client.ts`, porque no Vesso FIN não há cliente Supabase no navegador; e o `fmtMoney`, que corta os centavos acima de R$ 1.000.

---

## 3. Banco — o que a 0001 cria

Leia o arquivo inteiro antes de mexer; cada decisão está comentada nele. Resumo:

| Camada | Tabelas |
|---|---|
| Acesso | `donos`, `organizacoes` (tipo `cliente`/`casa`, status, turma, `competencia_inicial`), `papeis`, `acoes_papel`, `org_acessos`, `turmas_fechamento` (A, B e C, por dia útil) |
| Cadastro | `entidades` (só PJ), `contas`, `conexoes` (por **conta**), `contrapartes`, `plano_contas_modelos` + `plano_contas` (por org, com flags `entra_dre`/`entra_dfc`/`generica`/`sensivel` e `regra_competencia`), `centros_custo`, `regras_categorizacao` |
| Bronze | `extratos` (imutável por trigger), `saldos_extrato` (o saldo que a fonte informa) |
| Prata | `movimentos` (uma tabela; único por `(id_conta, hash_natural)` e por `(id_conta, origem, id_externo)`), `fila_jobs` |
| Núcleo | `titulos`, `baixas` (N:N, nunca apagada, só revertida com motivo), `transferencias`, `movimentos_ignorados` (motivo ≥ 10 caracteres), `documentos`, `fechamento_mensal` + `fechamento_eventos`, `tempo_tarefa`, `log_eventos` |
| Ouro (views) | `v_movimento_status`, `v_titulos_abertos`, `v_fato` (regimes `competencia`, `caixa` e `projetado`), `v_dre`, `v_dfc`, `v_saldo_conferencia`, `v_fila`, `v_saude_conexoes`, `v_tempo_org` |
| RPCs | `fn_conciliar`, `fn_lancar_e_conciliar`, `fn_desconciliar`, `fn_ignorar`, `fn_desfazer_ignorar`, `fn_registrar_transferencia`, `fn_criar_titulo` (parcelado), `fn_categorizar_titulo`, `fn_cancelar_titulo`, `fn_sugerir_pares`, `fn_checklist_fechamento`, `fn_enviar_revisao`, `fn_revisar_fechamento`, `fn_liberar_fechamento`, `fn_reabrir_mes`, `fn_tempo_iniciar`, `fn_tempo_parar` |

**Convenções que o código precisa respeitar:**
- `movimentos.valor` **tem sinal**: positivo é entrada, negativo é saída. `titulos.valor` e `baixas.valor` são **sempre positivos**, e a direção vem de `titulos.tipo`.
- `competencia` é sempre o dia 1 do mês.
- **Conciliar é criar baixa.** O estado do movimento é derivado na `v_movimento_status`, nunca gravado. Os estados são: conciliado, pendente, divergente (com `diferenca` e `motivo_divergencia`) e ignorado.
- Mês fechado ou liberado **trava** baixa, título, transferência e ignorado daquela competência. Reabrir exige o papel `head` (ou o dono) e motivo, e fica registrado em `fechamento_eventos`.
- **Hash natural** (o adapter em TypeScript precisa reproduzir byte a byte o `bpo_fin.fn_hash_natural`):
  `sha256(id_conta | AAAA-MM-DD | valor com 2 casas e ponto | descrição em MAIÚSCULAS, aparada e com espaços colapsados | seq)`,
  onde `seq` é a posição da linha entre linhas idênticas, começando em 0. Escreva um teste que compara o hash do TS com o do SQL.

**O que o teste cobre** (`test/10_testes_nucleo.sql`, que passa por inteiro):
- isolamento: analista, head, gestor de tráfego sem concessão, dono;
- direção, excesso e conciliação parcial (que fica divergente com Δ);
- lançar e conciliar com a competência pela regra da conta;
- transferência, e ignorar com e sem motivo;
- checklist bloqueando sem saldo conferido (um bug que o teste pegou e que já está corrigido na 0001);
- revisor ≠ executor, snapshot, trava de mês, reabertura;
- DRE por competência e DFC por caixa;
- os GRANTs dos papéis `worker` e `api`.

**Passos manuais depois de aplicar a 0001 em produção:**
```sql
alter role vesso_fin_api    with login password '<gerar>';   -- vai para o env da Railway
alter role vesso_fin_worker with login password '<gerar>';
insert into bpo_fin.donos (user_auth_id) select id from auth.users where email = '<e-mail de login do Luiz>';
-- e no painel: Settings → API → Exposed schemas → garantir que bpo_fin NÃO está na lista
```
Confirme no branch que `grant authenticated to vesso_fin_api` funciona com o usuário de migration do Supabase. Se não funcionar, a alternativa é a API usar o pooler com o usuário `authenticator`.

---

## 4. Importação do histórico da Seis — a 0002

Rodar **uma vez**, à mão: `select bpo_fin.fn_importar_historico_seis('2026-11-01');`. O argumento é a `competencia_inicial`: dali em diante o sistema cobra rotina, e antes disso tudo é histórico.

**A convenção atual do `financeiro_seis`, que a importação preserva:** o lançamento manual com `banco = 'Asaas'` é o **título**; a linha do extrato Asaas é o **pagamento**. A `v_tabela_fato` exclui do extrato cinco categorias (impostos, encargos, pagamento variável, retirada, transferências) para não contar duas vezes.

**Onde isso falha** (medido em produção em 21/10/2026):
- **12 pagamentos de Encargos no Asaas em 2026, somando R$ 5.081,06, não têm lançamento manual correspondente.** Eles estão fora do DRE atual. Na importação, viram título com a observação `fora_do_dre_no_financeiro_seis` e passam a contar no DRE do Vesso FIN.
- **376 lançamentos manuais "Asaas" (−R$ 695 mil, de 2024 a 2026) não têm pagamento no extrato** com o mesmo valor em até 5 dias. Ficam como títulos baixados na conta **"Pagamentos sem extrato (legado)"**: o DRE não muda e o buraco fica visível com nome.
- **9 coincidências** entre lançamento manual "Asaas" e linha do extrato em categoria **normal** (−R$ 14.650). Pode ser duplicidade no DRE atual. A importação **não** decide: preserva os dois e deixa para o Luiz.

**Aceite da importação:** `select * from bpo_fin.v_conferencia_dre_seis` com `nao_explicado = 0` em todos os meses. Toda diferença precisa ser explicada pelo caso E (pagamento sem espelho manual) ou pelo caso I (competência presumida em "Preencher Manualmente"). O teste em `test/20_stub_financeiro_seis.sql` usa as definições reais das views e cobre os casos A a I.

**Depois da importação, à mão:** o saldo inicial de cada conta (a importação usa 0 em 31/12/2023). Sem isso, a `v_saldo_conferencia` não bate para meses do histórico. O sistema só **exige** saldo a partir da `competencia_inicial`.

**Empresa da Lara:** cadastro à mão, como organização `casa` própria (não entra dentro da Seis):
```sql
insert into bpo_fin.organizacoes (nome, tipo, status, turma_fechamento, competencia_inicial)
values ('<nome da empresa da Lara>', 'casa', 'onboarding', 'A', '2026-11-01');
-- depois: entidades (CNPJ), contas, conexões — e plano de contas clonado do modelo
```

---

## 5. Ingestão — Fase 1a

**Adapter OFX (Nubank e qualquer banco):**
- Recebe o arquivo (upload na tela Conexões), calcula o sha256 e grava o extrato. Se já existir o mesmo `(id_conexao, arquivo_sha256)`, marca como `duplicado` e para.
- Cria um job `processar_extrato`. O worker então:
  - lê o OFX (`FITID` → `id_externo`, `DTPOSTED` → `data_movimento`, `TRNAMT` → `valor`, `MEMO`/`NAME` → `descricao_bruta`);
  - faz upsert por hash;
  - grava `LEDGERBAL`/`DTASOF` em `saldos_extrato`;
  - **marca `removido_na_fonte_em`** nos movimentos da conta que estão dentro de `[periodo_inicio, periodo_fim]` e não vieram no arquivo;
  - atualiza `conexoes.ultima_importacao_em`.
- Atenção: OFX de banco brasileiro vem em Latin-1 com frequência e às vezes com `FITID` repetido. O hash é a rede de segurança.

**Adapter Asaas (por API):**
- Usa o endpoint de extrato (lançamentos financeiros) e o de saldo.
- **Confirme na documentação atual do Asaas** os nomes e a paginação. O histórico em `extrato_asaas` usa ids no formato `ftn_…`; o `id_externo` do adapter precisa ser **esse mesmo id**, senão o sync ao vivo duplica o histórico importado.
- Janela: sempre os últimos `janela_reprocesso_dias` (15), nunca "só ontem".
- Agendamento: um job `sync_asaas` por conexão, diário. Pode vir do `pg_cron` (já instalado) inserindo em `fila_jobs`, ou de um cron na Railway.

**Ainda não:** Open Finance (Pluggy ou Belvo), adquirentes, OCR. Entram como novos adapters, sem tabela nova.

---

## 6. Front — identidade e tokens

**Base:** o tema do vesso-admin, sem mudar nada. **Por cima**, a camada financeira `--f-*`. Ela só aponta para tokens da Vesso, com exceção de 4 tons de texto escurecidos dentro das mesmas famílias. O motivo é contraste medido no tema claro: `text4` dá 2,57:1, o petróleo como texto 4,29:1, o ocre 3,13:1, e `text3` sobre o painel 4,43:1.

```css
:root {
  --f-accentText:   #476870;  /* petróleo p/ link/aba ativa — 5,9:1 */
  --f-positiveText: #3F6556;  /* 6,4:1 */
  --f-warningText:  #7A5E1C;  /* 6,0:1 */
  --f-negativeText: #A0503F;  /* 5,5:1 */
  --f-mutedText:    #5A6265;  /* substitui text3 em linha de tabela — 6,1:1 */
}
[data-theme='dark'] {
  --f-accentText: var(--v-accent);  --f-positiveText: var(--v-positive);
  --f-warningText: var(--v-warning); --f-negativeText: var(--v-negative);
  --f-mutedText: var(--v-text3);
}
:root, [data-theme='dark'] {
  --f-money: var(--v-text);                 /* dinheiro SEMPRE em tinta neutra */
  --f-conc-ok-text: var(--v-text2);   --f-conc-ok-icon: var(--f-positiveText);   /* ✓ recua */
  --f-conc-pend-text: var(--v-text);  --f-conc-pend-icon: var(--v-text2);        /* ○ peso 500 */
  --f-conc-div-text: var(--v-text);   --f-conc-div-bar: var(--v-negative);       /* ▲ faixa 3px */
  --f-conc-div-bg: var(--v-negativeBg); --f-conc-div-delta: var(--f-negativeText); /* "Δ −R$ 12,40" */
  --f-conc-ign-text: var(--f-mutedText);                                         /* — itálico + motivo */
  --f-due-today: var(--f-warningText);  --f-due-late: var(--f-negativeText);
  --f-var-fav: var(--f-positiveText);   --f-var-desfav: var(--f-negativeText);   /* só variação × meta */
  --f-row-selected: var(--v-realceBg2); --f-focus-ring: 0 0 0 2px var(--v-accent);
  --f-row-op: 24px; --f-row-op-dense: 20px; --f-row-portal: 44px;
  --f-th-size: 10px; --f-num-col: 14ch;
}
```

**Regras:**
- **A direção do dinheiro é dada pelo sinal, nunca pela cor.** Despesa não aparece em tijolo só por ser despesa. Verde e tijolo só falam de *variação contra orçamento ou meta* e de *estado*.
- `text4` não aparece em nenhuma tela do Vesso FIN.
- Cor de status nunca vem sozinha: sempre com ícone, texto ou número. Teste: a tela continua legível em escala de cinza.
- Toda coluna numérica usa Public Sans tabular (já é global no `body`), alinhada à direita, com largura `--f-num-col`. Newsreader só em título, nome da organização e o número de manchete do Resumo; nunca em coluna.
- Densidade de operação: linha de 24px e texto de 12px por padrão; 20px é opção por pessoa e nunca vale na tela de Fechamento. Cabeçalho de tabela com 10px (no admin era 8,5px).

**`fmtBRL`** (em `packages/shared`, com teste):
```ts
type Estilo = 'movimento' | 'demonstrativo' | 'portal'
export function fmtBRL(v: number | null | undefined, estilo: Estilo = 'movimento', opts?: { zero?: 'traco' | 'zero' }): string {
  if (v == null || !Number.isFinite(v)) return '—'
  if (v === 0) return opts?.zero === 'traco' ? '—' : '0,00'
  const abs = Math.abs(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  if (v > 0) return abs
  return estilo === 'demonstrativo' ? `(${abs})` : `−${abs}`   // U+2212, não hífen
}
// "R$" vai no cabeçalho da coluna. Na conciliação, diferença zero mostra "0,00": o zero é a informação.
// No DRE, linha vazia usa { zero: 'traco' }.
```

---

## 7. Telas — ordem de construção

**Não comece pelo cadastro.** Na Fase 1a, cadastre organização, entidade, conta e plano por SQL (a importação da Seis já faz isso). A tela de cadastro só entra quando cadastrar via SQL começar a doer.

### Fase 1a: a Seis como cliente zero

| # | Rota | Fonte | Ações (papel) |
|---|---|---|---|
| 1 | **`/org/[id]/conciliacao`** | `v_movimento_status`, `v_titulos_abertos`, `fn_sugerir_pares` | conciliar, lançar e conciliar, transferência, ignorar, desconciliar |
| 2 | `/org/[id]/lancamentos` | `titulos` + `v_fato` + `log_eventos` | categorizar, cancelar, corrigir competência |
| 3 | `/org/[id]/relatorios` | `v_dre`, `v_dfc`, `v_fato` (projetado) | exportar |
| 4 | `/org/[id]/fechamento` | `fn_checklist_fechamento`, `fechamento_mensal`, `fechamento_eventos` | enviar para revisão, revisar, liberar, reabrir |
| 5 | `/org/[id]` (Resumo) | `v_saldo_conferencia`, `v_titulos_abertos`, pendências da org | — |
| 6 | `/conexoes` + upload de OFX | `v_saude_conexoes`, `extratos` | importar |
| 7 | `/conferencia` (só o dono) | `v_conferencia_dre_seis` | — |

**A Conciliação** é a tela que decide a margem do produto. Especificação:
- **Layout:** extrato à esquerda (movimentos da conta e do período, filtráveis por estado), títulos em aberto à direita (filtrados pela direção do movimento em foco), sugestões no topo da direita, com score e motivo.
- **Teclado:** `j`/`k` navegam; `espaço` marca vários; `Enter` concilia o selecionado com a sugestão 1; `1`–`5` escolhem uma sugestão; `L` abre o lançar e conciliar (plano de contas com busca, competência sugerida pela regra); `T` registra transferência; `I` ignora (motivo obrigatório); `U` desfaz a última ação; `/` busca.
- **Seleção múltipla** (N movimentos para 1 título, ou 1 para N) mostra a soma e o **Δ ao vivo**. Com Δ ≠ 0, o botão vira "conciliar parcial", e a linha fica divergente até fechar.
- **Os 4 estados**, sempre com ícone, texto e cor:
  - ✓ conciliado: texto `text2`, a linha recua;
  - ○ pendente: texto normal, peso 500;
  - ▲ divergente: faixa lateral e "Δ −R$ x" impresso;
  - — ignorado: muted, itálico, com o motivo.
- **Cronômetro:** ao entrar na tela, chama `fn_tempo_iniciar(org, 'conciliacao')`; ao sair ou trocar de organização, `fn_tempo_parar`. Sem isso não há número para precificar.
- Meta de desempenho: abrir em menos de 1 s com 2.000 movimentos no período. Pagine o extrato no servidor e não carregue `payload_raw` na lista.

### Fase 1b: os primeiros clientes

- `/fila` (home do analista, a partir da `v_fila`), `/fechamentos` (todas as orgs na turma do mês), A Pagar, A Receber (com parcelamento via `fn_criar_titulo`), `/pendencias` e Documentos (bucket `bpo-fin` com policy por prefixo `id_org/`), `/equipe` (`v_tempo_org`), cadastro mínimo e `/acessos` (concessões, só dono e head).
- **Portal (no `vesso-clientes`):** Meu Caixa e Relatórios, lendo só `fechamento_mensal.status = 'liberado'`. Precisa de uma função própria para o cliente externo (`cliente_acessos` → `organizacoes.id_cliente`), com papéis `titular`/`socio` (já existem em `cliente_acessos.tipo`) e `secretaria` (novo; só vê documentos). Antes, **sincronize o `theme.ts` do vesso-clientes com o do admin**: hoje são cores fixas, só no tema claro, divergindo do comentário que diz "manter IGUAL".

### Fase 2 em diante
Open Finance, adquirentes, convênios, glosas, repasses, Aprovações no portal, Raio-X (`vesso_forms` + a mesma importação retroativa), e o loop do anúncio ao caixa (Fase 4).

---

## 8. API — contrato mínimo

`packages/shared` define os schemas zod; cada rota valida a entrada e chama **uma** RPC ou view. Nada de SQL montado com string.

```
GET  /orgs                                  → organizacoes (RLS)
GET  /orgs/:id/movimentos?conta&de&ate&status&cursor
GET  /orgs/:id/titulos-abertos?tipo&faixa
GET  /movimentos/:id/sugestoes              → fn_sugerir_pares
POST /movimentos/:id/conciliar              → fn_conciliar
POST /movimentos/:id/lancar-e-conciliar     → fn_lancar_e_conciliar
POST /movimentos/:id/ignorar | /desfazer-ignorar
POST /transferencias                        → fn_registrar_transferencia
POST /baixas/:id/desconciliar               → fn_desconciliar
POST /titulos | PATCH /titulos/:id/categoria | POST /titulos/:id/cancelar
GET  /orgs/:id/dre?de&ate | /dfc | /fluxo
GET  /orgs/:id/fechamentos/:competencia     → fechamento_mensal + fn_checklist_fechamento
POST /orgs/:id/fechamentos/:competencia/{enviar|revisar|liberar|reabrir}
POST /tempo/iniciar | /tempo/parar
POST /conexoes/:id/extratos  (multipart OFX) → grava bronze + job
GET  /fila | /conexoes | /conferencia-seis
```
Erros do Postgres com `errcode 42501` viram **403**, e `28000` vira **401**. Os demais erros de regra (as `raise exception` das RPCs) viram **422**, com a mensagem original do banco, que já está escrita para o usuário.

---

## 9. Critérios de aceite da Fase 1a

1. `test/10_testes_nucleo.sql` e o teste da importação passam no Postgres local **e** num branch do Supabase.
2. Importação da Seis aplicada, com `v_conferencia_dre_seis.nao_explicado = 0` em todos os meses.
3. Nenhuma requisição a `*.supabase.co` saindo do navegador, inclusive no login (conferir na aba Network).
4. Logado como um gestor de tráfego qualquer, o Vesso FIN mostra zero organizações. Logado como analista de uma org, as outras não aparecem nem pela URL direta (resposta 403 ou vazio).
5. Pelo menos um mês da Seis fechado no fluxo completo: analista envia, **outra pessoa** revisa, o dono libera, e tentar alterar o mês fechado é bloqueado.
6. Tempo registrado por etapa nesse mês, legível em `v_tempo_org`.
7. O hash do adapter em TS é igual ao `fn_hash_natural` (teste automatizado), e reimportar o mesmo OFX não cria nenhum movimento.

---

## 10. O que não fazer

- Não criar versão paralela do que já existe em outro schema (tasks, forms, calendário, playbooks). Use `operacao_seis.task_templates` para a rotina do POP, `core_seis.dim_calendario` para dia útil, e `vesso_forms` para o Raio-X. As exceções são documentos (bucket próprio, pelo motivo de isolamento) e permissão (`org_acessos`), ambas justificadas na 0001.
- Não fazer RPA em internet banking, não guardar senha de banco, não construir emissor fiscal.
- Não copiar a regra da `v_tabela_fato` de excluir categorias "na mão". No Vesso FIN, o que entra no DRE ou no DFC é flag do plano de contas.
- Não copiar `financeiro_seis.fn_calcular_competencia` como está: ela é `IMMUTABLE` e lê tabela. A `bpo_fin.fn_competencia_sugerida` é `STABLE`.
- Não mostrar ao cliente número de mês que não esteja `liberado`.

---

## 11. Em aberto — precisa do Luiz antes ou durante a Fase 1a

1. **Pró-labore: Folha ou Retirada?** O mesmo dinheiro tem duas classificações. No lançamento manual ele é "Pessoal / Folha" (entra no DRE); o PIX que o paga está no extrato Asaas como "Retirada de Lucro" (fora do DRE). A convenção atual não conta em dobro, e a importação liga os dois corretamente. Mas a pergunta é contábil e é do Lucas: pró-labore é despesa (DRE); distribuição de lucro não é. A resposta define o plano de contas modelo das organizações `casa`, e vale para os médicos também, que têm a mesma questão.
2. **As 9 coincidências** entre manual e extrato em categoria normal (−R$ 14.650): duplicidade ou coincidência?
3. **Saldo inicial real** de cada conta da Seis numa data de corte, para a conferência de saldo valer.
4. **`competencia_inicial` da Seis no Vesso FIN.** A proposta é nov/2026: o Lucas fecha out/26 no `financeiro_seis` (o piloto) e nov/26 já no Vesso FIN.
5. **O POP do Lucas** ainda não foi cruzado com o checklist da 0001 (movimentos, saldos, títulos sem categoria, "Outros", documentos). Se o POP pedir outro item, ele vira uma linha a mais em `fn_checklist_fechamento`.
6. **A Lara** recebe papel de dono ou não? Hoje só o Luiz tem.
7. **Construir ou contratar a ingestão** (agregador) entra na Fase 2. Decida explicitamente, para que a decisão não seja tomada por inércia.
