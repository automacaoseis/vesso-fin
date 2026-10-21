-- ════════════════════════════════════════════════════════════════════════════════════
-- 0001 · bpo_fin — núcleo da Fase 1 do Vesso FIN
--
-- O que este arquivo cria:
--   0. Papéis de banco (api / worker) e o schema
--   1. Acesso: donos, organizações, papéis por AÇÃO, concessões por org
--   2. Cadastro: entidades (só PJ), contas, conexões, contrapartes, plano de contas,
--      centros de custo, regras de categorização, turmas de fechamento
--   3. Ingestão: extratos (bronze, imutável), saldos informados, movimentos (prata),
--      fila de jobs do worker
--   4. Núcleo: títulos, baixas, transferências, ignorados, documentos, fechamento,
--      tempo, log de auditoria
--   5. Regras de integridade (triggers): mesma org, sinal, saldo, mês travado
--   6. RLS — leitura por org visível; NENHUMA escrita direta: toda escrita é RPC
--   7. RPCs de escrita, cada uma checa a AÇÃO
--   8. Views (ouro) com security_invoker — a RLS vale dentro delas
--
-- Convenções:
--   · valor de movimento é COM SINAL: > 0 crédito (entrou), < 0 débito (saiu)
--   · valor de título e de baixa é SEMPRE POSITIVO; o tipo do título dá a direção
--   · competencia é sempre o 1º dia do mês (check em toda tabela que a tem)
--   · id_org é denormalizado em toda tabela, com FK composta garantindo coerência —
--     é o que deixa a RLS ser uma linha só e barata
--   · nada se apaga: reverter é marcar (revertida_em / cancelado_em), e o log guarda
-- ════════════════════════════════════════════════════════════════════════════════════

begin;

-- ─── 0. Papéis e schema ──────────────────────────────────────────────────────────────
-- vesso_fin_api: o login da API na Railway. NOINHERIT + membro de `authenticated`:
--   ele não tem privilégio nenhum sozinho; a cada requisição faz
--   `set local role authenticated` + `set local request.jwt.claims = <jwt do usuário>`
--   e passa a ser o usuário — a RLS se aplica. Nunca usa service_role.
-- vesso_fin_worker: o login dos workers de ingestão. Escreve SÓ em bronze/prata/jobs.
--   Não toca em título, baixa, fechamento. A senha dos dois é definida à mão, fora do git:
--     alter role vesso_fin_api    with login password '...';
--     alter role vesso_fin_worker with login password '...';
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'vesso_fin_api') then
    create role vesso_fin_api nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'vesso_fin_worker') then
    create role vesso_fin_worker nologin;
  end if;
end $$;
grant authenticated to vesso_fin_api;

create schema if not exists bpo_fin;
comment on schema bpo_fin is
  'Vesso FIN — BPO financeiro. Dinheiro de terceiro: isolado por organização, ninguém vê tudo '
  '(exceto bpo_fin.donos). Fora da Data API pública do Supabase: acesso só pela API do Vesso FIN.';
revoke all on schema bpo_fin from public;
revoke all on schema bpo_fin from anon;
grant usage on schema bpo_fin to authenticated, vesso_fin_worker;

-- ─── 1. Acesso ────────────────────────────────────────────────────────────────────────

-- Quem vê e faz TUDO (hoje: só o Luiz). Concessão nominal — não vem de cargo, porque o
-- nível 'ceo' no app_seis também abre para coord_operacoes e admin_tecnico.
create table bpo_fin.donos (
  user_auth_id  uuid primary key references auth.users(id),
  nota          text,
  concedido_em  timestamptz not null default now()
);

create table bpo_fin.turmas_fechamento (
  codigo           text primary key,                       -- 'A', 'B', 'C'
  nome             text not null,
  dia_util_limite  int  not null check (dia_util_limite between 1 and 22),
  ativa            boolean not null default true
);
insert into bpo_fin.turmas_fechamento (codigo, nome, dia_util_limite) values
  ('A', 'Turma A — fecha até o 6º dia útil',  6),
  ('B', 'Turma B — fecha até o 10º dia útil', 10),
  ('C', 'Turma C — fecha até o 14º dia útil', 14);

create table bpo_fin.organizacoes (
  id_org              uuid primary key default gen_random_uuid(),
  nome                text not null,
  tipo                text not null check (tipo in ('cliente', 'casa')),
  -- 'casa' = empresas do próprio grupo (Seis, empresa da Lara). NUNCA entra em
  -- app_seis.clientes, então não polui contagem de cliente, metas nem faixas.
  id_cliente          uuid unique references app_seis.clientes(id_cliente),
  status              text not null default 'onboarding'
                        check (status in ('raio_x', 'onboarding', 'ativa', 'encerrada')),
  turma_fechamento    text references bpo_fin.turmas_fechamento(codigo),
  -- a partir de quando o sistema cobra rotina (fila, checklist). Antes disso é histórico.
  competencia_inicial date check (competencia_inicial = date_trunc('month', competencia_inicial)::date),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint org_cliente_tem_id_cliente check ((tipo = 'cliente') = (id_cliente is not null))
);

-- Papéis e o que cada um pode FAZER. A permissão é por ação, não só por linha.
create table bpo_fin.papeis (
  papel      text primary key,
  descricao  text not null
);
insert into bpo_fin.papeis values
  ('leitura',  'Vê a organização, não altera nada'),
  ('analista', 'Executa a rotina: importa, concilia, lança, categoriza, envia para revisão'),
  ('revisor',  'Tudo do analista + revisa fechamento de OUTRO executor'),
  ('head',     'Tudo do revisor + libera fechamento ao cliente, reabre mês, configura a org');

create table bpo_fin.acoes_papel (
  papel  text not null references bpo_fin.papeis(papel),
  acao   text not null check (acao in (
           'ver', 'importar', 'conciliar', 'ignorar', 'lancar', 'categorizar',
           'enviar_revisao', 'revisar', 'liberar', 'reabrir', 'configurar_org', 'registrar_tempo')),
  primary key (papel, acao)
);
insert into bpo_fin.acoes_papel (papel, acao)
select p, a from (values
  ('leitura',  array['ver']),
  ('analista', array['ver','importar','conciliar','ignorar','lancar','categorizar','enviar_revisao','registrar_tempo']),
  ('revisor',  array['ver','importar','conciliar','ignorar','lancar','categorizar','enviar_revisao','registrar_tempo','revisar']),
  ('head',     array['ver','importar','conciliar','ignorar','lancar','categorizar','enviar_revisao','registrar_tempo','revisar','liberar','reabrir','configurar_org'])
) v(p, acoes), unnest(acoes) a;

-- Concessão de papel. id_org NULL = "todas as orgs tipo CLIENTE" (o head do produto).
-- Org 'casa' NUNCA é coberta por id_org NULL — só por concessão nominal àquela org.
create table bpo_fin.org_acessos (
  id_acesso      uuid primary key default gen_random_uuid(),
  user_auth_id   uuid not null references auth.users(id),
  id_org         uuid references bpo_fin.organizacoes(id_org),
  papel          text not null references bpo_fin.papeis(papel),
  motivo         text,
  concedido_por  uuid references auth.users(id),
  expira_em      timestamptz,
  ativo          boolean not null default true,
  created_at     timestamptz not null default now()
);
create unique index org_acessos_um_ativo on bpo_fin.org_acessos
  (user_auth_id, coalesce(id_org, '00000000-0000-0000-0000-000000000000'::uuid)) where ativo;

-- ─── 2. Cadastro ──────────────────────────────────────────────────────────────────────

-- Só PJ. A PF do médico está FORA do escopo (decisão de 21/10/2026).
create table bpo_fin.entidades (
  id_entidade        uuid primary key default gen_random_uuid(),
  id_org             uuid not null references bpo_fin.organizacoes(id_org),
  razao_social       text not null,
  nome_fantasia      text,
  cnpj               text not null check (cnpj ~ '^[0-9]{14}$'),     -- só dígitos
  regime_tributario  text check (regime_tributario in ('mei', 'simples', 'presumido', 'real')),
  ativa              boolean not null default true,
  created_at         timestamptz not null default now(),
  unique (id_org, cnpj),
  unique (id_entidade, id_org)
);

create table bpo_fin.contas (
  id_conta            uuid primary key default gen_random_uuid(),
  id_org              uuid not null,
  id_entidade         uuid not null,
  tipo                text not null check (tipo in ('banco', 'gateway', 'adquirente', 'aplicacao', 'caixa')),
  instituicao         text not null,                 -- 'Nubank', 'Asaas', 'Itaú'…
  codigo_banco        text,                          -- COMPE, quando houver
  agencia             text,
  numero_final        text check (numero_final ~ '^[0-9Xx-]{1,6}$'), -- só o final, nunca o número inteiro
  apelido             text not null,
  saldo_inicial       numeric(14,2) not null default 0,
  data_saldo_inicial  date not null,
  ativa               boolean not null default true,
  created_at          timestamptz not null default now(),
  foreign key (id_entidade, id_org) references bpo_fin.entidades(id_entidade, id_org),
  unique (id_conta, id_org)
);

-- Conexão é por CONTA. Credencial NUNCA aqui: id_segredo aponta para vault.secrets.
create table bpo_fin.conexoes (
  id_conexao               uuid primary key default gen_random_uuid(),
  id_org                   uuid not null,
  id_conta                 uuid not null,
  metodo                   text not null check (metodo in
                             ('ofx', 'csv', 'asaas_api', 'open_finance', 'arquivo_adquirente', 'manual')),
  id_segredo               uuid,                     -- vault.secrets.id (sem FK: schema do Vault)
  frequencia_esperada      interval not null default interval '1 day',
  janela_reprocesso_dias   int not null default 15 check (janela_reprocesso_dias between 1 and 60),
  ultima_importacao_em     timestamptz,
  ultimo_movimento_em      date,
  status                   text not null default 'ativa' check (status in ('ativa', 'pausada', 'erro')),
  erro_msg                 text,
  created_at               timestamptz not null default now(),
  foreign key (id_conta, id_org) references bpo_fin.contas(id_conta, id_org),
  unique (id_conexao, id_org)
);

create table bpo_fin.centros_custo (
  id_centro_custo  uuid primary key default gen_random_uuid(),
  id_org           uuid not null references bpo_fin.organizacoes(id_org),
  codigo           text not null,
  nome             text not null,
  ativo            boolean not null default true,
  unique (id_org, codigo),
  unique (id_centro_custo, id_org)
);

-- Plano de contas: modelo (template) → clonado por org. Nunca global.
create table bpo_fin.plano_contas_modelos (
  id_modelo  uuid primary key default gen_random_uuid(),
  nome       text not null unique,            -- 'Clínica médica', 'Agência (Seis)'
  descricao  text
);

create table bpo_fin.plano_contas (
  id_plano_conta     uuid primary key default gen_random_uuid(),
  id_org             uuid references bpo_fin.organizacoes(id_org),       -- NULL = item de modelo
  id_modelo          uuid references bpo_fin.plano_contas_modelos(id_modelo),
  codigo             text not null,
  nome               text not null,
  id_pai             uuid references bpo_fin.plano_contas(id_plano_conta),
  natureza           text not null check (natureza in (
                       'grupo', 'receita', 'deducao', 'custo', 'despesa', 'investimento',
                       'financeira_receita', 'financeira_despesa', 'imposto',
                       'retirada', 'transferencia', 'aplicacao')),
  aceita_lancamento  boolean not null default true,          -- false = grupo/totalizador
  entra_dre          boolean not null,
  entra_dfc          boolean not null,
  grupo_dfc          text check (grupo_dfc in ('operacional', 'investimento', 'financiamento')),
  linha_dre          text,                                   -- 'RECEITA_BRUTA', 'FOLHA'…
  ordem_dre          int,
  regra_competencia  text not null default 'mes_corrente'
                       check (regra_competencia in ('mes_corrente', 'mes_anterior', 'manual')),
  generica           boolean not null default false,         -- "Outros": bloqueia fechamento (POP)
  sensivel           boolean not null default false,         -- folha, pró-labore, retirada
  ativa              boolean not null default true,
  constraint plano_org_xor_modelo check ((id_org is null) <> (id_modelo is null)),
  constraint plano_dfc_tem_grupo check (not entra_dfc or grupo_dfc is not null or natureza = 'grupo'),
  unique (id_plano_conta, id_org)
);
create unique index plano_contas_codigo_org    on bpo_fin.plano_contas (id_org, codigo)    where id_org is not null;
create unique index plano_contas_codigo_modelo on bpo_fin.plano_contas (id_modelo, codigo) where id_modelo is not null;

create table bpo_fin.contrapartes (
  id_contraparte          uuid primary key default gen_random_uuid(),
  id_org                  uuid not null references bpo_fin.organizacoes(id_org),
  nome                    text not null,
  documento               text check (documento ~ '^[0-9]{11}$|^[0-9]{14}$'),
  tipo                    text not null default 'ambos'
                            check (tipo in ('cliente', 'fornecedor', 'ambos', 'socio', 'governo', 'interno')),
  id_plano_conta_padrao   uuid,
  id_centro_custo_padrao  uuid,
  origem_legado           text,          -- ex.: id_entidade do financeiro_seis
  ativa                   boolean not null default true,
  created_at              timestamptz not null default now(),
  foreign key (id_plano_conta_padrao, id_org) references bpo_fin.plano_contas(id_plano_conta, id_org),
  foreign key (id_centro_custo_padrao, id_org) references bpo_fin.centros_custo(id_centro_custo, id_org),
  unique (id_contraparte, id_org)
);
create unique index contrapartes_documento on bpo_fin.contrapartes (id_org, documento) where documento is not null;

create table bpo_fin.regras_categorizacao (
  id_regra               uuid primary key default gen_random_uuid(),
  id_org                 uuid not null references bpo_fin.organizacoes(id_org),
  prioridade             int not null default 100,
  descricao_contem       text,
  contraparte_documento  text,
  sentido                text check (sentido in ('C', 'D')),
  valor_min              numeric(14,2),
  valor_max              numeric(14,2),
  id_plano_conta         uuid not null,
  id_centro_custo        uuid,
  id_contraparte         uuid,
  ativa                  boolean not null default true,
  acertos                int not null default 0,     -- sugestão aceita
  recusas                int not null default 0,     -- sugestão trocada pelo analista
  criado_por             uuid,
  created_at             timestamptz not null default now(),
  constraint regra_tem_condicao check (coalesce(descricao_contem, contraparte_documento) is not null),
  foreign key (id_plano_conta, id_org)  references bpo_fin.plano_contas(id_plano_conta, id_org),
  foreign key (id_centro_custo, id_org) references bpo_fin.centros_custo(id_centro_custo, id_org),
  foreign key (id_contraparte, id_org)  references bpo_fin.contrapartes(id_contraparte, id_org)
);

-- ─── 3. Ingestão ──────────────────────────────────────────────────────────────────────

-- BRONZE: o arquivo/payload como chegou. Imutável (trigger abaixo). Reprocessável.
create table bpo_fin.extratos (
  id_extrato              uuid primary key default gen_random_uuid(),
  id_org                  uuid not null,
  id_conexao              uuid not null,
  origem                  text not null,
  arquivo_nome            text,
  arquivo_sha256          text not null,
  storage_path            text,
  periodo_inicio          date,
  periodo_fim             date,
  saldo_final_informado   numeric(14,2),
  data_saldo_final        date,
  payload                 jsonb,
  recebido_em             timestamptz not null default now(),
  recebido_por            uuid,
  status                  text not null default 'recebido'
                            check (status in ('recebido', 'processado', 'erro', 'duplicado')),
  processado_em           timestamptz,
  linhas_lidas            int,
  linhas_novas            int,
  linhas_removidas        int,
  erro_msg                text,
  foreign key (id_conexao, id_org) references bpo_fin.conexoes(id_conexao, id_org),
  unique (id_conexao, arquivo_sha256)
);

-- Saldo que a FONTE informa (OFX LEDGERBAL, API do Asaas). É a régua do fechamento.
create table bpo_fin.saldos_extrato (
  id_conta    uuid not null references bpo_fin.contas(id_conta),
  data        date not null,
  saldo       numeric(14,2) not null,
  id_extrato  uuid references bpo_fin.extratos(id_extrato),
  primary key (id_conta, data)
);

-- PRATA: UMA tabela canônica. Fonte nova = adapter, não tabela nova.
create table bpo_fin.movimentos (
  id_movimento           uuid primary key default gen_random_uuid(),
  id_org                 uuid not null,
  id_conta               uuid not null,
  id_extrato             uuid references bpo_fin.extratos(id_extrato),
  origem                 text not null check (origem in
                           ('ofx', 'csv', 'asaas', 'open_finance', 'adquirente', 'manual', 'legado')),
  id_externo             text,                          -- FITID do OFX, id do Asaas…
  hash_natural           text not null,                 -- ver fn_hash_natural
  data_movimento         date not null,
  data_lancamento        date,
  valor                  numeric(14,2) not null check (valor <> 0),
  sentido                char(1) generated always as (case when valor > 0 then 'C' else 'D' end) stored,
  descricao_bruta        text,
  contraparte_nome       text,
  contraparte_documento  text,
  id_contraparte         uuid,
  payload_raw            jsonb,
  -- some do extrato numa reimportação dentro da janela (estorno na fonte, ajuste D+30)
  removido_na_fonte_em   timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  foreign key (id_conta, id_org) references bpo_fin.contas(id_conta, id_org),
  foreign key (id_contraparte, id_org) references bpo_fin.contrapartes(id_contraparte, id_org),
  unique (id_conta, hash_natural),
  unique (id_movimento, id_org)
);
create unique index movimentos_id_externo on bpo_fin.movimentos (id_conta, origem, id_externo) where id_externo is not null;
create index movimentos_org_data on bpo_fin.movimentos (id_org, data_movimento);

-- Fila dos workers (Railway). Sem Redis: SELECT … FOR UPDATE SKIP LOCKED.
create table bpo_fin.fila_jobs (
  id_job         bigint generated always as identity primary key,
  tipo           text not null check (tipo in
                   ('processar_extrato', 'sync_asaas', 'reprocessar_janela', 'gerar_relatorio', 'aplicar_regras')),
  id_org         uuid references bpo_fin.organizacoes(id_org),
  payload        jsonb not null default '{}',
  status         text not null default 'pendente' check (status in ('pendente', 'rodando', 'ok', 'erro')),
  tentativas     int not null default 0,
  agendado_para  timestamptz not null default now(),
  iniciado_em    timestamptz,
  terminado_em   timestamptz,
  erro_msg       text,
  created_at     timestamptz not null default now()
);
create index fila_jobs_pendentes on bpo_fin.fila_jobs (agendado_para) where status = 'pendente';

-- ─── 4. Núcleo ────────────────────────────────────────────────────────────────────────

create table bpo_fin.titulos (
  id_titulo            uuid primary key default gen_random_uuid(),
  id_org               uuid not null,
  id_entidade          uuid not null,
  tipo                 text not null check (tipo in ('pagar', 'receber')),
  id_contraparte       uuid,
  descricao            text not null,
  valor                numeric(14,2) not null check (valor > 0),
  data_emissao         date,
  data_vencimento      date not null,
  competencia          date not null check (competencia = date_trunc('month', competencia)::date),
  id_plano_conta       uuid,                -- NULL = "a categorizar" (bloqueia fechamento)
  id_centro_custo      uuid,
  parcela              int check (parcela >= 1),
  total_parcelas       int check (total_parcelas >= 1),
  id_titulo_origem     uuid references bpo_fin.titulos(id_titulo),  -- parcelamento / ajuste
  origem               text not null check (origem in
                         ('manual', 'asaas', 'recorrencia', 'documento', 'ajuste_conciliacao', 'legado')),
  id_externo           text,
  observacao           text,
  cancelado_em         timestamptz,
  cancelado_por        uuid,
  motivo_cancelamento  text,
  criado_por           uuid,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  foreign key (id_entidade, id_org)     references bpo_fin.entidades(id_entidade, id_org),
  foreign key (id_contraparte, id_org)  references bpo_fin.contrapartes(id_contraparte, id_org),
  foreign key (id_plano_conta, id_org)  references bpo_fin.plano_contas(id_plano_conta, id_org),
  foreign key (id_centro_custo, id_org) references bpo_fin.centros_custo(id_centro_custo, id_org),
  constraint titulo_cancelamento_tem_motivo check (cancelado_em is null or motivo_cancelamento is not null),
  unique (id_titulo, id_org)
);
create index titulos_org_comp on bpo_fin.titulos (id_org, competencia);
create index titulos_org_venc on bpo_fin.titulos (id_org, data_vencimento) where cancelado_em is null;

-- A CONCILIAÇÃO é isto: um movimento quita (parte de) um título. N:N, auditável.
create table bpo_fin.baixas (
  id_baixa         uuid primary key default gen_random_uuid(),
  id_org           uuid not null,
  id_titulo        uuid not null,
  id_movimento     uuid not null,
  valor            numeric(14,2) not null check (valor > 0),
  origem           text not null default 'manual' check (origem in ('manual', 'sugestao', 'regra', 'legado')),
  criado_por       uuid,
  criado_em        timestamptz not null default now(),
  revertida_em     timestamptz,
  revertida_por    uuid,
  motivo_reversao  text,
  foreign key (id_titulo, id_org)    references bpo_fin.titulos(id_titulo, id_org),
  foreign key (id_movimento, id_org) references bpo_fin.movimentos(id_movimento, id_org),
  constraint baixa_reversao_tem_motivo check (revertida_em is null or motivo_reversao is not null)
);
create index baixas_mov on bpo_fin.baixas (id_movimento) where revertida_em is null;
create index baixas_tit on bpo_fin.baixas (id_titulo)    where revertida_em is null;

-- Transferência entre contas da MESMA org: concilia os dois lados sem título.
create table bpo_fin.transferencias (
  id_transferencia  uuid primary key default gen_random_uuid(),
  id_org            uuid not null,
  id_mov_saida      uuid not null,
  id_mov_entrada    uuid not null,
  criado_por        uuid,
  criado_em         timestamptz not null default now(),
  revertida_em      timestamptz,
  revertida_por     uuid,
  motivo_reversao   text,
  foreign key (id_mov_saida, id_org)   references bpo_fin.movimentos(id_movimento, id_org),
  foreign key (id_mov_entrada, id_org) references bpo_fin.movimentos(id_movimento, id_org),
  check (id_mov_saida <> id_mov_entrada)
);
create unique index transf_saida_ativa   on bpo_fin.transferencias (id_mov_saida)   where revertida_em is null;
create unique index transf_entrada_ativa on bpo_fin.transferencias (id_mov_entrada) where revertida_em is null;

-- IGNORADO exige motivo — é o estado mais perigoso: tira dinheiro da conciliação.
create table bpo_fin.movimentos_ignorados (
  id_ignorado    uuid primary key default gen_random_uuid(),
  id_org         uuid not null,
  id_movimento   uuid not null,
  categoria      text not null check (categoria in
                   ('duplicado_na_fonte', 'fora_do_escopo', 'estorno_compensado', 'legado', 'outro')),
  motivo         text not null check (length(btrim(motivo)) >= 10),
  criado_por     uuid,
  criado_em      timestamptz not null default now(),
  revertido_em   timestamptz,
  revertido_por  uuid,
  foreign key (id_movimento, id_org) references bpo_fin.movimentos(id_movimento, id_org)
);
create unique index ignorado_ativo on bpo_fin.movimentos_ignorados (id_movimento) where revertido_em is null;

-- Documento do cliente (NF, boleto, comprovante). Bucket próprio 'bpo-fin', caminho
-- começando por id_org/ — NÃO usa docs_seis, cuja permissão é por colaborador/pasta,
-- não por organização (mesma razão de bpo_fin existir separado do financeiro_seis).
create table bpo_fin.documentos (
  id_documento    uuid primary key default gen_random_uuid(),
  id_org          uuid not null references bpo_fin.organizacoes(id_org),
  id_titulo       uuid,
  tipo            text not null check (tipo in ('nf', 'boleto', 'comprovante', 'contrato', 'extrato', 'guia_imposto', 'outro')),
  competencia     date check (competencia = date_trunc('month', competencia)::date),
  descricao       text not null,
  status          text not null default 'pedido' check (status in ('pedido', 'recebido', 'validado', 'recusado')),
  storage_path    text check (storage_path is null or storage_path like '%/%'),
  pedido_em       timestamptz,
  pedido_por      uuid,
  recebido_em     timestamptz,
  validado_por    uuid,
  created_at      timestamptz not null default now(),
  foreign key (id_titulo, id_org) references bpo_fin.titulos(id_titulo, id_org)
);

create table bpo_fin.fechamento_mensal (
  id_fechamento       uuid primary key default gen_random_uuid(),
  id_org              uuid not null references bpo_fin.organizacoes(id_org),
  competencia         date not null check (competencia = date_trunc('month', competencia)::date),
  status              text not null default 'aberto'
                        check (status in ('aberto', 'em_revisao', 'fechado', 'liberado')),
  executor            uuid,
  enviado_revisao_em  timestamptz,
  revisor             uuid,
  revisado_em         timestamptz,
  nota_revisao        text,
  liberado_por        uuid,
  liberado_em         timestamptz,
  snapshot            jsonb,                 -- DRE e saldos congelados no fechamento
  reaberturas         int not null default 0,
  unique (id_org, competencia),
  constraint revisor_nao_e_executor check (revisor is null or executor is null or revisor <> executor)
);

create table bpo_fin.fechamento_eventos (
  id_evento      bigint generated always as identity primary key,
  id_fechamento  uuid not null references bpo_fin.fechamento_mensal(id_fechamento),
  de_status      text,
  para_status    text not null,
  por            uuid,
  motivo         text,
  em             timestamptz not null default now()
);

-- O cronômetro. É o número que falta para precificar (o próprio POP pede).
create table bpo_fin.tempo_tarefa (
  id_tempo      uuid primary key default gen_random_uuid(),
  id_org        uuid not null references bpo_fin.organizacoes(id_org),
  user_auth_id  uuid not null,
  etapa         text not null check (etapa in (
                  'importacao', 'conciliacao', 'categorizacao', 'contas_pagar', 'contas_receber',
                  'documentos', 'fechamento', 'revisao', 'reuniao_cliente', 'implantacao', 'outro')),
  id_task       uuid,                          -- operacao_seis.tasks, quando vier de rotina
  competencia   date check (competencia = date_trunc('month', competencia)::date),
  inicio        timestamptz not null,
  fim           timestamptz,
  minutos       int generated always as
                  (case when fim is null then null else (extract(epoch from (fim - inicio)) / 60)::int end) stored,
  nota          text,
  check (fim is null or fim > inicio)
);
create unique index tempo_um_aberto_por_pessoa on bpo_fin.tempo_tarefa (user_auth_id) where fim is null;

-- Auditoria append-only de tudo que mexe em dinheiro ou acesso.
create table bpo_fin.log_eventos (
  id_log      bigint generated always as identity primary key,
  id_org      uuid,
  tabela      text not null,
  id_registro text not null,
  acao        text not null,
  antes       jsonb,
  depois      jsonb,
  por         uuid,
  em          timestamptz not null default now()
);
create index log_eventos_org on bpo_fin.log_eventos (id_org, em desc);

-- ─── 5. Funções de apoio e integridade ───────────────────────────────────────────────

create function bpo_fin.fn_eh_dono() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from bpo_fin.donos d where d.user_auth_id = auth.uid())
$$;

create function bpo_fin.fn_orgs_visiveis() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select o.id_org
  from bpo_fin.organizacoes o
  where bpo_fin.fn_eh_dono()
     or exists (
          select 1 from bpo_fin.org_acessos a
          where a.user_auth_id = auth.uid() and a.ativo
            and (a.expira_em is null or a.expira_em > now())
            and (a.id_org = o.id_org or (a.id_org is null and o.tipo = 'cliente')))
$$;

create function bpo_fin.fn_pode(p_id_org uuid, p_acao text) returns boolean
language sql stable security definer set search_path = '' as $$
  select bpo_fin.fn_eh_dono()
      or exists (
           select 1
           from bpo_fin.org_acessos a
           join bpo_fin.organizacoes o on o.id_org = p_id_org
           join bpo_fin.acoes_papel ap on ap.papel = a.papel and ap.acao = p_acao
           where a.user_auth_id = auth.uid() and a.ativo
             and (a.expira_em is null or a.expira_em > now())
             and (a.id_org = p_id_org or (a.id_org is null and o.tipo = 'cliente')))
$$;

create function bpo_fin.fn_exigir(p_id_org uuid, p_acao text) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then
    raise exception 'sem sessão' using errcode = '28000';
  end if;
  if not bpo_fin.fn_pode(p_id_org, p_acao) then
    raise exception 'sem permissão para "%" nesta organização', p_acao using errcode = '42501';
  end if;
end $$;

-- Hash natural: o mesmo para o adapter (TypeScript) e para a importação (SQL).
-- O adapter DEVE gerar exatamente: sha256(id_conta|aaaa-mm-dd|valor 2 casas|descricao normalizada|seq)
-- seq = ordem da linha entre linhas idênticas (mesma conta, data, valor e descrição), a partir de 0.
create function bpo_fin.fn_normalizar_descricao(p text) returns text
language sql immutable as $$
  select regexp_replace(upper(btrim(coalesce(p, ''))), '\s+', ' ', 'g')
$$;
create function bpo_fin.fn_hash_natural(p_id_conta uuid, p_data date, p_valor numeric, p_descricao text, p_seq int)
returns text language sql immutable as $$
  select encode(sha256(convert_to(
    p_id_conta::text || '|' || to_char(p_data, 'YYYY-MM-DD') || '|' || to_char(p_valor, 'FM999999999990.00')
    || '|' || bpo_fin.fn_normalizar_descricao(p_descricao) || '|' || p_seq::text, 'UTF8')), 'hex')
$$;

create function bpo_fin.fn_mes_travado(p_id_org uuid, p_data date) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from bpo_fin.fechamento_mensal f
    where f.id_org = p_id_org
      and f.competencia = date_trunc('month', p_data)::date
      and f.status in ('fechado', 'liberado'))
$$;

-- Competência sugerida pela regra do plano (porta o fn_calcular_competencia do financeiro_seis,
-- mas STABLE: a original é IMMUTABLE e lê tabela — o Postgres pode cachear errado).
create function bpo_fin.fn_competencia_sugerida(p_id_plano_conta uuid, p_data date) returns date
language sql stable security definer set search_path = '' as $$
  select case pc.regra_competencia
           when 'mes_corrente' then date_trunc('month', p_data)::date
           when 'mes_anterior' then (date_trunc('month', p_data) - interval '1 month')::date
           else null end
  from bpo_fin.plano_contas pc where pc.id_plano_conta = p_id_plano_conta
$$;

-- Imutabilidade do bronze
create function bpo_fin.tg_extrato_imutavel() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'extrato é imutável (bronze): não se apaga';
  end if;
  if new.payload is distinct from old.payload
     or new.arquivo_sha256 is distinct from old.arquivo_sha256
     or new.storage_path is distinct from old.storage_path
     or new.id_conexao is distinct from old.id_conexao then
    raise exception 'extrato é imutável (bronze): só status e contadores mudam';
  end if;
  return new;
end $$;
create trigger extrato_imutavel before update or delete on bpo_fin.extratos
  for each row execute function bpo_fin.tg_extrato_imutavel();

-- Movimento: valor, data e conta são a identidade — não mudam depois de gravados.
create function bpo_fin.tg_movimento_identidade() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'movimento não se apaga: use removido_na_fonte_em ou ignore com motivo';
  end if;
  if new.valor <> old.valor or new.data_movimento <> old.data_movimento
     or new.id_conta <> old.id_conta or new.hash_natural <> old.hash_natural then
    raise exception 'valor, data, conta e hash do movimento são imutáveis';
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger movimento_identidade before update or delete on bpo_fin.movimentos
  for each row execute function bpo_fin.tg_movimento_identidade();

-- Baixa: direção, saldo do movimento, saldo do título, mês travado.
create function bpo_fin.tg_baixa_valida() returns trigger
language plpgsql set search_path = '' as $$
declare
  v_mov   bpo_fin.movimentos%rowtype;
  v_tit   bpo_fin.titulos%rowtype;
  v_usado numeric;
begin
  if tg_op = 'DELETE' then
    raise exception 'baixa não se apaga: reverta com motivo';
  end if;

  select * into v_mov from bpo_fin.movimentos where id_movimento = new.id_movimento;
  select * into v_tit from bpo_fin.titulos    where id_titulo    = new.id_titulo;

  if tg_op = 'UPDATE' then
    if new.id_titulo <> old.id_titulo or new.id_movimento <> old.id_movimento or new.valor <> old.valor then
      raise exception 'baixa só pode ser revertida, não alterada';
    end if;
    if old.revertida_em is not null then
      raise exception 'baixa já revertida';
    end if;
    if bpo_fin.fn_mes_travado(new.id_org, v_mov.data_movimento) then
      raise exception 'mês % fechado: reabra antes de desconciliar', to_char(v_mov.data_movimento, 'MM/YYYY');
    end if;
    return new;
  end if;

  -- INSERT
  if v_tit.cancelado_em is not null then
    raise exception 'título cancelado não recebe baixa';
  end if;
  if (v_tit.tipo = 'receber' and v_mov.valor < 0) or (v_tit.tipo = 'pagar' and v_mov.valor > 0) then
    raise exception 'direção incompatível: título a % com movimento de %',
      v_tit.tipo, case when v_mov.valor > 0 then 'entrada' else 'saída' end;
  end if;
  if exists (select 1 from bpo_fin.movimentos_ignorados i where i.id_movimento = new.id_movimento and i.revertido_em is null)
     or exists (select 1 from bpo_fin.transferencias t where t.revertida_em is null
                and new.id_movimento in (t.id_mov_saida, t.id_mov_entrada)) then
    raise exception 'movimento já está ignorado ou conciliado como transferência';
  end if;

  select coalesce(sum(valor), 0) into v_usado from bpo_fin.baixas
   where id_movimento = new.id_movimento and revertida_em is null;
  if v_usado + new.valor > abs(v_mov.valor) then
    raise exception 'baixa excede o movimento: disponível %, pedido %', abs(v_mov.valor) - v_usado, new.valor;
  end if;

  select coalesce(sum(valor), 0) into v_usado from bpo_fin.baixas
   where id_titulo = new.id_titulo and revertida_em is null;
  if v_usado + new.valor > v_tit.valor then
    raise exception 'baixa excede o título: em aberto %, pedido % (diferença vira título de ajuste)',
      v_tit.valor - v_usado, new.valor;
  end if;

  if bpo_fin.fn_mes_travado(new.id_org, v_mov.data_movimento) then
    raise exception 'mês % fechado: reabra antes de conciliar', to_char(v_mov.data_movimento, 'MM/YYYY');
  end if;
  return new;
end $$;
create trigger baixa_valida before insert or update or delete on bpo_fin.baixas
  for each row execute function bpo_fin.tg_baixa_valida();

-- Título: mês travado vale para a competência antiga E a nova.
create function bpo_fin.tg_titulo_valido() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'título não se apaga: cancele com motivo';
  end if;
  if tg_op = 'UPDATE' then
    if bpo_fin.fn_mes_travado(old.id_org, old.competencia)
       and (new.valor, new.competencia, new.id_plano_conta, new.id_centro_custo, new.cancelado_em, new.tipo)
           is distinct from (old.valor, old.competencia, old.id_plano_conta, old.id_centro_custo, old.cancelado_em, old.tipo) then
      raise exception 'competência % fechada: reabra antes de alterar o título', to_char(old.competencia, 'MM/YYYY');
    end if;
    if new.cancelado_em is not null and old.cancelado_em is null
       and exists (select 1 from bpo_fin.baixas b where b.id_titulo = new.id_titulo and b.revertida_em is null) then
      raise exception 'título com baixa ativa não pode ser cancelado: desconcilie antes';
    end if;
    if new.valor < old.valor and new.valor < (select coalesce(sum(b.valor), 0) from bpo_fin.baixas b
                                             where b.id_titulo = new.id_titulo and b.revertida_em is null) then
      raise exception 'valor do título ficaria menor que o já baixado';
    end if;
    new.updated_at := now();
  end if;
  if bpo_fin.fn_mes_travado(new.id_org, new.competencia) and tg_op = 'INSERT' then
    raise exception 'competência % fechada: reabra antes de lançar', to_char(new.competencia, 'MM/YYYY');
  end if;
  if new.id_plano_conta is not null and exists (
       select 1 from bpo_fin.plano_contas pc where pc.id_plano_conta = new.id_plano_conta and not pc.aceita_lancamento) then
    raise exception 'conta do plano é grupo/totalizador: escolha uma conta analítica';
  end if;
  return new;
end $$;
create trigger titulo_valido before insert or update or delete on bpo_fin.titulos
  for each row execute function bpo_fin.tg_titulo_valido();

create function bpo_fin.tg_transferencia_valida() returns trigger
language plpgsql set search_path = '' as $$
declare s bpo_fin.movimentos%rowtype; e bpo_fin.movimentos%rowtype;
begin
  if tg_op = 'DELETE' then raise exception 'transferência não se apaga: reverta com motivo'; end if;
  select * into s from bpo_fin.movimentos where id_movimento = new.id_mov_saida;
  select * into e from bpo_fin.movimentos where id_movimento = new.id_mov_entrada;
  if tg_op = 'INSERT' then
    if s.valor >= 0 or e.valor <= 0 then raise exception 'transferência: saída precisa ser débito e entrada, crédito'; end if;
    if abs(s.valor) <> e.valor then raise exception 'transferência: valores diferentes (% × %)', abs(s.valor), e.valor; end if;
    if s.id_conta = e.id_conta then raise exception 'transferência: as duas pontas estão na mesma conta'; end if;
    if exists (select 1 from bpo_fin.baixas b where b.revertida_em is null and b.id_movimento in (s.id_movimento, e.id_movimento))
       or exists (select 1 from bpo_fin.movimentos_ignorados i where i.revertido_em is null and i.id_movimento in (s.id_movimento, e.id_movimento)) then
      raise exception 'transferência: uma das pontas já está conciliada ou ignorada';
    end if;
  end if;
  if bpo_fin.fn_mes_travado(new.id_org, s.data_movimento) or bpo_fin.fn_mes_travado(new.id_org, e.data_movimento) then
    raise exception 'mês fechado: reabra antes';
  end if;
  return new;
end $$;
create trigger transferencia_valida before insert or update or delete on bpo_fin.transferencias
  for each row execute function bpo_fin.tg_transferencia_valida();

create function bpo_fin.tg_ignorado_valido() returns trigger
language plpgsql set search_path = '' as $$
declare v_data date;
begin
  if tg_op = 'DELETE' then raise exception 'ignorado não se apaga: desfaça com revertido_em'; end if;
  select data_movimento into v_data from bpo_fin.movimentos where id_movimento = new.id_movimento;
  if tg_op = 'INSERT' and (
       exists (select 1 from bpo_fin.baixas b where b.id_movimento = new.id_movimento and b.revertida_em is null)
    or exists (select 1 from bpo_fin.transferencias t where t.revertida_em is null and new.id_movimento in (t.id_mov_saida, t.id_mov_entrada))) then
    raise exception 'movimento já conciliado: desconcilie antes de ignorar';
  end if;
  if bpo_fin.fn_mes_travado(new.id_org, v_data) then raise exception 'mês fechado: reabra antes'; end if;
  return new;
end $$;
create trigger ignorado_valido before insert or update or delete on bpo_fin.movimentos_ignorados
  for each row execute function bpo_fin.tg_ignorado_valido();

-- Auditoria genérica
create function bpo_fin.tg_auditar() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_id text; v_org uuid; v_row jsonb;
begin
  v_row := to_jsonb(coalesce(new, old));
  v_org := nullif(v_row ->> 'id_org', '')::uuid;
  v_id  := coalesce(v_row ->> tg_argv[0], '?');
  insert into bpo_fin.log_eventos (id_org, tabela, id_registro, acao, antes, depois, por)
  values (v_org, tg_table_name, v_id, lower(tg_op),
          case when tg_op <> 'INSERT' then to_jsonb(old) end,
          case when tg_op <> 'DELETE' then to_jsonb(new) end,
          auth.uid());
  return coalesce(new, old);
end $$;
create trigger auditar after insert or update on bpo_fin.titulos              for each row execute function bpo_fin.tg_auditar('id_titulo');
create trigger auditar after insert or update on bpo_fin.baixas               for each row execute function bpo_fin.tg_auditar('id_baixa');
create trigger auditar after insert or update on bpo_fin.transferencias       for each row execute function bpo_fin.tg_auditar('id_transferencia');
create trigger auditar after insert or update on bpo_fin.movimentos_ignorados for each row execute function bpo_fin.tg_auditar('id_ignorado');
create trigger auditar after insert or update on bpo_fin.plano_contas         for each row execute function bpo_fin.tg_auditar('id_plano_conta');
create trigger auditar after insert or update on bpo_fin.regras_categorizacao for each row execute function bpo_fin.tg_auditar('id_regra');
create trigger auditar after insert or update on bpo_fin.org_acessos          for each row execute function bpo_fin.tg_auditar('id_acesso');
create trigger auditar after insert or update on bpo_fin.fechamento_mensal    for each row execute function bpo_fin.tg_auditar('id_fechamento');
create trigger auditar after insert or update on bpo_fin.contas               for each row execute function bpo_fin.tg_auditar('id_conta');
create trigger auditar after insert or update on bpo_fin.conexoes             for each row execute function bpo_fin.tg_auditar('id_conexao');

-- ─── 6. RLS ───────────────────────────────────────────────────────────────────────────
-- Regra única de leitura: a linha é de uma org visível. Nenhuma policy de escrita para
-- `authenticated`: escrever é sempre RPC (SECURITY DEFINER) que checa a ação.
do $$
declare t text;
begin
  foreach t in array array[
    'entidades','contas','conexoes','centros_custo','contrapartes','regras_categorizacao',
    'extratos','movimentos','titulos','baixas','transferencias','movimentos_ignorados',
    'documentos','fechamento_mensal','tempo_tarefa','log_eventos','fila_jobs']
  loop
    execute format('alter table bpo_fin.%I enable row level security', t);
    execute format(
      'create policy ler_org_visivel on bpo_fin.%I for select to authenticated
         using (id_org in (select bpo_fin.fn_orgs_visiveis()))', t);
  end loop;
end $$;

alter table bpo_fin.organizacoes enable row level security;
create policy ler_org_visivel on bpo_fin.organizacoes for select to authenticated
  using (id_org in (select bpo_fin.fn_orgs_visiveis()));

alter table bpo_fin.plano_contas enable row level security;
create policy ler_plano on bpo_fin.plano_contas for select to authenticated
  using (id_org in (select bpo_fin.fn_orgs_visiveis())
         or (id_org is null and (bpo_fin.fn_eh_dono() or exists (
               select 1 from bpo_fin.org_acessos a where a.user_auth_id = auth.uid() and a.ativo and a.papel = 'head'))));

alter table bpo_fin.saldos_extrato enable row level security;
create policy ler_saldo on bpo_fin.saldos_extrato for select to authenticated
  using (exists (select 1 from bpo_fin.contas c where c.id_conta = saldos_extrato.id_conta
                 and c.id_org in (select bpo_fin.fn_orgs_visiveis())));

alter table bpo_fin.fechamento_eventos enable row level security;
create policy ler_evento on bpo_fin.fechamento_eventos for select to authenticated
  using (exists (select 1 from bpo_fin.fechamento_mensal f where f.id_fechamento = fechamento_eventos.id_fechamento
                 and f.id_org in (select bpo_fin.fn_orgs_visiveis())));

alter table bpo_fin.donos enable row level security;
create policy ver_a_si on bpo_fin.donos for select to authenticated using (user_auth_id = auth.uid());

alter table bpo_fin.org_acessos enable row level security;
create policy ver_acessos on bpo_fin.org_acessos for select to authenticated
  using (user_auth_id = auth.uid() or bpo_fin.fn_eh_dono()
         or (id_org is not null and bpo_fin.fn_pode(id_org, 'configurar_org')));

-- tabelas de domínio (sem dado de cliente): leitura para quem tem qualquer acesso
alter table bpo_fin.papeis               enable row level security;
alter table bpo_fin.acoes_papel          enable row level security;
alter table bpo_fin.turmas_fechamento    enable row level security;
alter table bpo_fin.plano_contas_modelos enable row level security;
create policy ler_dominio on bpo_fin.papeis               for select to authenticated using (true);
create policy ler_dominio on bpo_fin.acoes_papel          for select to authenticated using (true);
create policy ler_dominio on bpo_fin.turmas_fechamento    for select to authenticated using (true);
create policy ler_dominio on bpo_fin.plano_contas_modelos for select to authenticated using (true);

-- Worker: só ingestão. Policies explícitas (ele não tem bypass de RLS).
create policy worker_ingestao on bpo_fin.extratos       for all to vesso_fin_worker using (true) with check (true);
create policy worker_ingestao on bpo_fin.movimentos     for all to vesso_fin_worker using (true) with check (true);
create policy worker_ingestao on bpo_fin.fila_jobs      for all to vesso_fin_worker using (true) with check (true);
create policy worker_ingestao on bpo_fin.saldos_extrato for all to vesso_fin_worker using (true) with check (true);
create policy worker_le       on bpo_fin.conexoes       for select to vesso_fin_worker using (true);
create policy worker_status   on bpo_fin.conexoes       for update to vesso_fin_worker using (true) with check (true);
create policy worker_le       on bpo_fin.contas         for select to vesso_fin_worker using (true);
create policy worker_le       on bpo_fin.organizacoes   for select to vesso_fin_worker using (true);

grant select on all tables in schema bpo_fin to authenticated;
grant select, insert on bpo_fin.extratos, bpo_fin.movimentos, bpo_fin.saldos_extrato, bpo_fin.fila_jobs to vesso_fin_worker;
grant update (status, processado_em, linhas_lidas, linhas_novas, linhas_removidas, erro_msg) on bpo_fin.extratos to vesso_fin_worker;
grant update (descricao_bruta, data_lancamento, contraparte_nome, contraparte_documento, payload_raw,
              removido_na_fonte_em, id_extrato, updated_at) on bpo_fin.movimentos to vesso_fin_worker;
grant update (saldo, id_extrato) on bpo_fin.saldos_extrato to vesso_fin_worker;
grant update (status, tentativas, iniciado_em, terminado_em, erro_msg, agendado_para) on bpo_fin.fila_jobs to vesso_fin_worker;
grant select on bpo_fin.conexoes, bpo_fin.contas, bpo_fin.organizacoes to vesso_fin_worker;
grant update (ultima_importacao_em, ultimo_movimento_em, status, erro_msg) on bpo_fin.conexoes to vesso_fin_worker;

-- ─── 7. RPCs de escrita ──────────────────────────────────────────────────────────────

create function bpo_fin.fn_org_do_movimento(p_id_movimento uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select id_org from bpo_fin.movimentos where id_movimento = p_id_movimento
$$;

-- Concilia um movimento com 1..N títulos. p_itens = [{"id_titulo": "...", "valor": 123.45}, …]
create function bpo_fin.fn_conciliar(p_id_movimento uuid, p_itens jsonb, p_origem text default 'manual')
returns setof uuid language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_item jsonb; v_id uuid;
begin
  v_org := bpo_fin.fn_org_do_movimento(p_id_movimento);
  if v_org is null then raise exception 'movimento não encontrado'; end if;
  perform bpo_fin.fn_exigir(v_org, 'conciliar');
  if jsonb_typeof(p_itens) <> 'array' or jsonb_array_length(p_itens) = 0 then
    raise exception 'informe ao menos um título';
  end if;
  for v_item in select * from jsonb_array_elements(p_itens) loop
    insert into bpo_fin.baixas (id_org, id_titulo, id_movimento, valor, origem, criado_por)
    values (v_org, (v_item ->> 'id_titulo')::uuid, p_id_movimento, (v_item ->> 'valor')::numeric,
            coalesce(p_origem, 'manual'), auth.uid())
    returning id_baixa into v_id;
    return next v_id;
  end loop;
end $$;

-- O caso mais comum do banco (tarifa, PIX avulso): cria o título e já concilia, num ato só.
create function bpo_fin.fn_lancar_e_conciliar(
  p_id_movimento uuid, p_id_plano_conta uuid, p_descricao text,
  p_id_centro_custo uuid default null, p_id_contraparte uuid default null,
  p_competencia date default null, p_valor numeric default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_mov bpo_fin.movimentos%rowtype; v_usado numeric; v_valor numeric; v_comp date; v_ent uuid; v_tit uuid;
begin
  select * into v_mov from bpo_fin.movimentos where id_movimento = p_id_movimento;
  if not found then raise exception 'movimento não encontrado'; end if;
  perform bpo_fin.fn_exigir(v_mov.id_org, 'conciliar');
  perform bpo_fin.fn_exigir(v_mov.id_org, 'lancar');

  select coalesce(sum(valor), 0) into v_usado from bpo_fin.baixas where id_movimento = p_id_movimento and revertida_em is null;
  v_valor := coalesce(p_valor, abs(v_mov.valor) - v_usado);
  if v_valor <= 0 then raise exception 'movimento já totalmente conciliado'; end if;

  v_comp := coalesce(date_trunc('month', p_competencia)::date,
                     bpo_fin.fn_competencia_sugerida(p_id_plano_conta, v_mov.data_movimento));
  if v_comp is null then raise exception 'esta conta exige competência informada (regra manual)'; end if;

  select c.id_entidade into v_ent from bpo_fin.contas c where c.id_conta = v_mov.id_conta;

  insert into bpo_fin.titulos (id_org, id_entidade, tipo, id_contraparte, descricao, valor, data_emissao,
                               data_vencimento, competencia, id_plano_conta, id_centro_custo, origem, criado_por)
  values (v_mov.id_org, v_ent, case when v_mov.valor > 0 then 'receber' else 'pagar' end,
          coalesce(p_id_contraparte, v_mov.id_contraparte), coalesce(nullif(btrim(p_descricao), ''), v_mov.descricao_bruta, 'Lançamento'),
          v_valor, v_mov.data_movimento, v_mov.data_movimento, v_comp, p_id_plano_conta, p_id_centro_custo,
          case when p_valor is not null then 'ajuste_conciliacao' else 'manual' end, auth.uid())
  returning id_titulo into v_tit;

  insert into bpo_fin.baixas (id_org, id_titulo, id_movimento, valor, origem, criado_por)
  values (v_mov.id_org, v_tit, p_id_movimento, v_valor, 'manual', auth.uid());
  return v_tit;
end $$;

create function bpo_fin.fn_desconciliar(p_id_baixa uuid, p_motivo text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_org uuid;
begin
  select id_org into v_org from bpo_fin.baixas where id_baixa = p_id_baixa;
  if v_org is null then raise exception 'baixa não encontrada'; end if;
  perform bpo_fin.fn_exigir(v_org, 'conciliar');
  if p_motivo is null or length(btrim(p_motivo)) < 5 then raise exception 'motivo obrigatório'; end if;
  update bpo_fin.baixas set revertida_em = now(), revertida_por = auth.uid(), motivo_reversao = p_motivo
   where id_baixa = p_id_baixa;
end $$;

create function bpo_fin.fn_ignorar(p_id_movimento uuid, p_categoria text, p_motivo text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_id uuid;
begin
  v_org := bpo_fin.fn_org_do_movimento(p_id_movimento);
  if v_org is null then raise exception 'movimento não encontrado'; end if;
  perform bpo_fin.fn_exigir(v_org, 'ignorar');
  insert into bpo_fin.movimentos_ignorados (id_org, id_movimento, categoria, motivo, criado_por)
  values (v_org, p_id_movimento, p_categoria, p_motivo, auth.uid()) returning id_ignorado into v_id;
  return v_id;
end $$;

create function bpo_fin.fn_desfazer_ignorar(p_id_movimento uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_org uuid;
begin
  v_org := bpo_fin.fn_org_do_movimento(p_id_movimento);
  perform bpo_fin.fn_exigir(v_org, 'ignorar');
  update bpo_fin.movimentos_ignorados set revertido_em = now(), revertido_por = auth.uid()
   where id_movimento = p_id_movimento and revertido_em is null;
end $$;

create function bpo_fin.fn_registrar_transferencia(p_id_mov_saida uuid, p_id_mov_entrada uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_id uuid;
begin
  v_org := bpo_fin.fn_org_do_movimento(p_id_mov_saida);
  if v_org is distinct from bpo_fin.fn_org_do_movimento(p_id_mov_entrada) then
    raise exception 'as duas pontas precisam ser da mesma organização';
  end if;
  perform bpo_fin.fn_exigir(v_org, 'conciliar');
  insert into bpo_fin.transferencias (id_org, id_mov_saida, id_mov_entrada, criado_por)
  values (v_org, p_id_mov_saida, p_id_mov_entrada, auth.uid()) returning id_transferencia into v_id;
  return v_id;
end $$;

-- A Pagar / A Receber: lança título (com parcelamento opcional).
create function bpo_fin.fn_criar_titulo(
  p_id_org uuid, p_id_entidade uuid, p_tipo text, p_descricao text, p_valor numeric,
  p_data_vencimento date, p_competencia date, p_id_plano_conta uuid default null,
  p_id_centro_custo uuid default null, p_id_contraparte uuid default null,
  p_parcelas int default 1, p_origem text default 'manual')
returns setof uuid language plpgsql security definer set search_path = '' as $$
declare i int; v_pai uuid; v_id uuid; v_parcela numeric; v_resto numeric;
begin
  perform bpo_fin.fn_exigir(p_id_org, 'lancar');
  if p_parcelas < 1 or p_parcelas > 120 then raise exception 'parcelas entre 1 e 120'; end if;
  v_parcela := round(p_valor / p_parcelas, 2);
  v_resto   := p_valor - v_parcela * (p_parcelas - 1);       -- centavos vão na última
  for i in 1..p_parcelas loop
    insert into bpo_fin.titulos (id_org, id_entidade, tipo, id_contraparte, descricao, valor, data_emissao,
                                 data_vencimento, competencia, id_plano_conta, id_centro_custo,
                                 parcela, total_parcelas, id_titulo_origem, origem, criado_por)
    values (p_id_org, p_id_entidade, p_tipo, p_id_contraparte, p_descricao,
            case when i = p_parcelas then v_resto else v_parcela end,
            current_date, (p_data_vencimento + make_interval(months => i - 1))::date,
            (date_trunc('month', p_competencia) + make_interval(months => i - 1))::date,
            p_id_plano_conta, p_id_centro_custo,
            case when p_parcelas > 1 then i end, case when p_parcelas > 1 then p_parcelas end,
            v_pai, p_origem, auth.uid())
    returning id_titulo into v_id;
    if i = 1 then v_pai := v_id; end if;
    return next v_id;
  end loop;
end $$;

create function bpo_fin.fn_categorizar_titulo(p_id_titulo uuid, p_id_plano_conta uuid,
  p_id_centro_custo uuid default null, p_competencia date default null) returns void
language plpgsql security definer set search_path = '' as $$
declare v_org uuid;
begin
  select id_org into v_org from bpo_fin.titulos where id_titulo = p_id_titulo;
  if v_org is null then raise exception 'título não encontrado'; end if;
  perform bpo_fin.fn_exigir(v_org, 'categorizar');
  update bpo_fin.titulos
     set id_plano_conta = p_id_plano_conta,
         id_centro_custo = coalesce(p_id_centro_custo, id_centro_custo),
         competencia = coalesce(date_trunc('month', p_competencia)::date, competencia)
   where id_titulo = p_id_titulo;
end $$;

create function bpo_fin.fn_cancelar_titulo(p_id_titulo uuid, p_motivo text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_org uuid;
begin
  select id_org into v_org from bpo_fin.titulos where id_titulo = p_id_titulo;
  perform bpo_fin.fn_exigir(v_org, 'lancar');
  if p_motivo is null or length(btrim(p_motivo)) < 5 then raise exception 'motivo obrigatório'; end if;
  update bpo_fin.titulos set cancelado_em = now(), cancelado_por = auth.uid(), motivo_cancelamento = p_motivo
   where id_titulo = p_id_titulo and cancelado_em is null;
end $$;

-- Cronômetro
create function bpo_fin.fn_tempo_iniciar(p_id_org uuid, p_etapa text, p_competencia date default null, p_id_task uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  perform bpo_fin.fn_exigir(p_id_org, 'registrar_tempo');
  update bpo_fin.tempo_tarefa set fim = now() where user_auth_id = auth.uid() and fim is null;  -- um aberto por pessoa
  insert into bpo_fin.tempo_tarefa (id_org, user_auth_id, etapa, competencia, id_task, inicio)
  values (p_id_org, auth.uid(), p_etapa, date_trunc('month', coalesce(p_competencia, current_date))::date, p_id_task, now())
  returning id_tempo into v_id;
  return v_id;
end $$;

create function bpo_fin.fn_tempo_parar(p_nota text default null) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update bpo_fin.tempo_tarefa set fim = now(), nota = coalesce(p_nota, nota)
   where user_auth_id = auth.uid() and fim is null;
end $$;

-- ─── 8. Views (ouro) — security_invoker: a RLS das tabelas vale dentro delas ─────────

create view bpo_fin.v_movimento_status with (security_invoker = true) as
select m.id_movimento, m.id_org, m.id_conta, m.data_movimento, m.valor, m.sentido,
       m.descricao_bruta, m.contraparte_nome, m.origem, m.removido_na_fonte_em,
       coalesce(b.soma, 0)                                   as valor_conciliado,
       abs(m.valor) - coalesce(b.soma, 0)                    as diferenca,
       b.n_titulos,
       t.id_transferencia,
       i.categoria                                           as ignorado_categoria,
       i.motivo                                              as ignorado_motivo,
       case
         when m.removido_na_fonte_em is not null and (coalesce(b.soma, 0) > 0 or t.id_transferencia is not null)
                                                         then 'divergente'
         when i.id_ignorado is not null                  then 'ignorado'
         when t.id_transferencia is not null             then 'conciliado'
         when coalesce(b.soma, 0) = 0                    then 'pendente'
         when coalesce(b.soma, 0) = abs(m.valor)         then 'conciliado'
         else 'divergente'
       end as status,
       case
         when m.removido_na_fonte_em is not null and (coalesce(b.soma, 0) > 0 or t.id_transferencia is not null)
                                                         then 'removido_na_fonte'
         when i.id_ignorado is null and t.id_transferencia is null
              and coalesce(b.soma, 0) > 0 and coalesce(b.soma, 0) <> abs(m.valor)
                                                         then 'conciliacao_parcial'
       end as motivo_divergencia
from bpo_fin.movimentos m
left join lateral (select sum(x.valor) soma, count(*) n_titulos from bpo_fin.baixas x
                    where x.id_movimento = m.id_movimento and x.revertida_em is null) b on true
left join bpo_fin.transferencias t on t.revertida_em is null and m.id_movimento in (t.id_mov_saida, t.id_mov_entrada)
left join bpo_fin.movimentos_ignorados i on i.id_movimento = m.id_movimento and i.revertido_em is null
where m.removido_na_fonte_em is null
   or coalesce(b.soma, 0) > 0 or t.id_transferencia is not null;   -- removido sem vínculo some de vez

create view bpo_fin.v_titulos_abertos with (security_invoker = true) as
select t.id_titulo, t.id_org, t.id_entidade, t.tipo, t.descricao, t.id_contraparte, t.id_plano_conta,
       t.competencia, t.data_vencimento, t.valor,
       coalesce(b.pago, 0)               as valor_baixado,
       t.valor - coalesce(b.pago, 0)     as saldo,
       current_date - t.data_vencimento  as dias_atraso,
       case
         when t.data_vencimento <  current_date      then 'vencido'
         when t.data_vencimento =  current_date      then 'hoje'
         when t.data_vencimento <= current_date + 7  then '7_dias'
         when t.data_vencimento <= current_date + 30 then '30_dias'
         else 'depois' end                as faixa
from bpo_fin.titulos t
left join lateral (select sum(x.valor) pago from bpo_fin.baixas x
                    where x.id_titulo = t.id_titulo and x.revertida_em is null) b on true
where t.cancelado_em is null
  and t.valor - coalesce(b.pago, 0) > 0;

-- FATO: dois grãos na mesma view, separados por `regime`.
--   competencia → um registro por TÍTULO (valor cheio, mês de competência)  → DRE
--   caixa       → um registro por BAIXA  (valor baixado, data do movimento)  → DFC
--   projetado   → saldo em aberto do título, pela data de vencimento         → fluxo
-- Diferença deliberada do financeiro_seis.v_tabela_fato: lá uma TRANSAÇÃO carrega as duas
-- datas; aqui competência mora no título e caixa no movimento — que é o que a conciliação
-- explícita permite e o que o DRE de um BPO exige (imposto do mês conta mesmo não pago).
create view bpo_fin.v_fato with (security_invoker = true) as
select 'competencia'::text as regime, t.id_org, t.id_entidade, t.id_titulo, null::uuid as id_baixa, null::uuid as id_movimento,
       t.competencia as mes, t.data_vencimento as data_ref, t.tipo,
       case when t.tipo = 'receber' then t.valor else -t.valor end as valor,
       t.id_plano_conta, t.id_centro_custo, t.id_contraparte, t.origem
from bpo_fin.titulos t
where t.cancelado_em is null
union all
select 'caixa', b.id_org, t.id_entidade, t.id_titulo, b.id_baixa, b.id_movimento,
       date_trunc('month', m.data_movimento)::date, m.data_movimento, t.tipo,
       case when t.tipo = 'receber' then b.valor else -b.valor end,
       t.id_plano_conta, t.id_centro_custo, t.id_contraparte, t.origem
from bpo_fin.baixas b
join bpo_fin.titulos t    on t.id_titulo = b.id_titulo
join bpo_fin.movimentos m on m.id_movimento = b.id_movimento
where b.revertida_em is null
union all
select 'projetado', a.id_org, a.id_entidade, a.id_titulo, null, null,
       date_trunc('month', greatest(a.data_vencimento, current_date))::date, greatest(a.data_vencimento, current_date), a.tipo,
       case when a.tipo = 'receber' then a.saldo else -a.saldo end,
       a.id_plano_conta, null, a.id_contraparte, 'projetado'
from bpo_fin.v_titulos_abertos a;

create view bpo_fin.v_dre with (security_invoker = true) as
select f.id_org, f.mes as competencia, pc.linha_dre, pc.ordem_dre,
       pc.id_plano_conta, pc.codigo, pc.nome as conta, pc.natureza,
       sum(f.valor) as valor, count(*) as qtd_titulos
from bpo_fin.v_fato f
join bpo_fin.plano_contas pc on pc.id_plano_conta = f.id_plano_conta
where f.regime = 'competencia' and pc.entra_dre
group by 1, 2, 3, 4, 5, 6, 7, 8;

create view bpo_fin.v_dfc with (security_invoker = true) as
select f.id_org, f.mes, pc.grupo_dfc, pc.id_plano_conta, pc.codigo, pc.nome as conta,
       sum(f.valor) as valor, count(*) as qtd_baixas
from bpo_fin.v_fato f
join bpo_fin.plano_contas pc on pc.id_plano_conta = f.id_plano_conta
where f.regime = 'caixa' and pc.entra_dfc
group by 1, 2, 3, 4, 5, 6;

-- Saldo do sistema × saldo informado pela fonte, em cada data em que a fonte informou.
create view bpo_fin.v_saldo_conferencia with (security_invoker = true) as
select c.id_org, c.id_conta, c.apelido, s.data, s.saldo as saldo_extrato,
       c.saldo_inicial + coalesce((
         select sum(m.valor) from bpo_fin.movimentos m
         where m.id_conta = c.id_conta and m.data_movimento > c.data_saldo_inicial and m.data_movimento <= s.data
           and m.removido_na_fonte_em is null
           and not exists (select 1 from bpo_fin.movimentos_ignorados i
                           where i.id_movimento = m.id_movimento and i.revertido_em is null
                             and i.categoria = 'duplicado_na_fonte')), 0) as saldo_sistema
from bpo_fin.contas c
join bpo_fin.saldos_extrato s on s.id_conta = c.id_conta;

-- Checklist do fechamento — função (parametrizada por org × competência).
create function bpo_fin.fn_checklist_fechamento(p_id_org uuid, p_competencia date)
returns table (item text, ok boolean, bloqueia boolean, detalhe text)
language sql stable security invoker set search_path = '' as $$
  with par as (select date_trunc('month', p_competencia)::date ini,
                      (date_trunc('month', p_competencia) + interval '1 month - 1 day')::date fim),
  movs as (select v.status, count(*) n from bpo_fin.v_movimento_status v, par
            where v.id_org = p_id_org and v.data_movimento between par.ini and par.fim group by 1),
  contas as (
    select c.id_conta, c.apelido,
           (select sc.saldo_extrato - sc.saldo_sistema from bpo_fin.v_saldo_conferencia sc, par
             where sc.id_conta = c.id_conta and sc.data between par.fim - 3 and par.fim
             order by sc.data desc limit 1) as dif
    from bpo_fin.contas c where c.id_org = p_id_org and c.ativa)
  select 'movimentos pendentes', coalesce((select n from movs where status = 'pendente'), 0) = 0, true,
         coalesce((select n from movs where status = 'pendente'), 0) || ' sem conciliação'
  union all
  select 'movimentos divergentes', coalesce((select n from movs where status = 'divergente'), 0) = 0, true,
         coalesce((select n from movs where status = 'divergente'), 0) || ' divergentes'
  union all
  -- ⚠️ coalesce: sem saldo informado, dif é NULL e `NULL = 0` é NULL — sem isto o item
  -- "passava" calado e o mês fechava sem conferir saldo (pego no teste).
  select 'saldo conferido: ' || apelido, coalesce(dif = 0, false), true,
         case when dif is null then 'sem saldo informado na última semana do mês'
              else 'diferença ' || to_char(dif, 'FM999G999G990D00') end
  from contas
  union all
  select 'títulos sem categoria', count(*) = 0, true, count(*) || ' sem conta do plano'
  from bpo_fin.titulos t where t.id_org = p_id_org and t.cancelado_em is null
   and t.competencia = date_trunc('month', p_competencia)::date and t.id_plano_conta is null
  union all
  select 'títulos em conta genérica ("Outros")', count(*) = 0, true, count(*) || ' em conta genérica'
  from bpo_fin.titulos t join bpo_fin.plano_contas pc on pc.id_plano_conta = t.id_plano_conta
  where t.id_org = p_id_org and t.cancelado_em is null and pc.generica
    and t.competencia = date_trunc('month', p_competencia)::date
  union all
  select 'documentos pedidos e não recebidos', count(*) = 0, false, count(*) || ' pendentes'
  from bpo_fin.documentos d where d.id_org = p_id_org and d.status = 'pedido'
   and d.competencia = date_trunc('month', p_competencia)::date
$$;

create function bpo_fin.fn_transicao_fechamento(p_id_fechamento uuid, p_de text, p_para text, p_motivo text)
returns void language sql security definer set search_path = '' as $$
  insert into bpo_fin.fechamento_eventos (id_fechamento, de_status, para_status, por, motivo)
  values (p_id_fechamento, p_de, p_para, auth.uid(), p_motivo)
$$;

create function bpo_fin.fn_enviar_revisao(p_id_org uuid, p_competencia date) returns void
language plpgsql security definer set search_path = '' as $$
declare v_comp date := date_trunc('month', p_competencia)::date; v_f bpo_fin.fechamento_mensal%rowtype; v_bloq text;
begin
  perform bpo_fin.fn_exigir(p_id_org, 'enviar_revisao');
  select string_agg(item || ' (' || detalhe || ')', '; ') into v_bloq
    from bpo_fin.fn_checklist_fechamento(p_id_org, v_comp) where bloqueia and not ok;
  if v_bloq is not null then raise exception 'checklist bloqueado: %', v_bloq; end if;

  insert into bpo_fin.fechamento_mensal (id_org, competencia) values (p_id_org, v_comp)
  on conflict (id_org, competencia) do nothing;
  select * into v_f from bpo_fin.fechamento_mensal where id_org = p_id_org and competencia = v_comp for update;
  if v_f.status <> 'aberto' then raise exception 'fechamento está "%", não "aberto"', v_f.status; end if;

  update bpo_fin.fechamento_mensal
     set status = 'em_revisao', executor = auth.uid(), enviado_revisao_em = now(),
         revisor = null, revisado_em = null
   where id_fechamento = v_f.id_fechamento;
  perform bpo_fin.fn_transicao_fechamento(v_f.id_fechamento, 'aberto', 'em_revisao', null);
end $$;

create function bpo_fin.fn_revisar_fechamento(p_id_org uuid, p_competencia date, p_aprovar boolean, p_nota text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_comp date := date_trunc('month', p_competencia)::date; v_f bpo_fin.fechamento_mensal%rowtype; v_snap jsonb;
begin
  perform bpo_fin.fn_exigir(p_id_org, 'revisar');
  select * into v_f from bpo_fin.fechamento_mensal where id_org = p_id_org and competencia = v_comp for update;
  if not found or v_f.status <> 'em_revisao' then raise exception 'não há fechamento em revisão'; end if;
  if v_f.executor = auth.uid() then raise exception 'revisor precisa ser diferente de quem executou'; end if;

  if p_aprovar then
    select jsonb_build_object(
             'dre',    (select coalesce(jsonb_agg(to_jsonb(d) order by d.ordem_dre, d.codigo), '[]') from bpo_fin.v_dre d
                         where d.id_org = p_id_org and d.competencia = v_comp),
             'saldos', (select coalesce(jsonb_agg(to_jsonb(s)), '[]') from bpo_fin.v_saldo_conferencia s
                         where s.id_org = p_id_org and s.data = (v_comp + interval '1 month - 1 day')::date),
             'gerado_em', now())
      into v_snap;
    update bpo_fin.fechamento_mensal
       set status = 'fechado', revisor = auth.uid(), revisado_em = now(), nota_revisao = p_nota, snapshot = v_snap
     where id_fechamento = v_f.id_fechamento;
    perform bpo_fin.fn_transicao_fechamento(v_f.id_fechamento, 'em_revisao', 'fechado', p_nota);
  else
    if p_nota is null or length(btrim(p_nota)) < 5 then raise exception 'devolver exige nota'; end if;
    update bpo_fin.fechamento_mensal set status = 'aberto', nota_revisao = p_nota where id_fechamento = v_f.id_fechamento;
    perform bpo_fin.fn_transicao_fechamento(v_f.id_fechamento, 'em_revisao', 'aberto', p_nota);
  end if;
end $$;

create function bpo_fin.fn_liberar_fechamento(p_id_org uuid, p_competencia date) returns void
language plpgsql security definer set search_path = '' as $$
declare v_f bpo_fin.fechamento_mensal%rowtype;
begin
  perform bpo_fin.fn_exigir(p_id_org, 'liberar');
  select * into v_f from bpo_fin.fechamento_mensal
   where id_org = p_id_org and competencia = date_trunc('month', p_competencia)::date for update;
  if not found or v_f.status <> 'fechado' then raise exception 'só fechamento "fechado" pode ser liberado ao cliente'; end if;
  update bpo_fin.fechamento_mensal set status = 'liberado', liberado_por = auth.uid(), liberado_em = now()
   where id_fechamento = v_f.id_fechamento;
  perform bpo_fin.fn_transicao_fechamento(v_f.id_fechamento, 'fechado', 'liberado', null);
end $$;

create function bpo_fin.fn_reabrir_mes(p_id_org uuid, p_competencia date, p_motivo text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_f bpo_fin.fechamento_mensal%rowtype;
begin
  perform bpo_fin.fn_exigir(p_id_org, 'reabrir');
  if p_motivo is null or length(btrim(p_motivo)) < 10 then raise exception 'reabrir exige motivo (mín. 10 caracteres)'; end if;
  select * into v_f from bpo_fin.fechamento_mensal
   where id_org = p_id_org and competencia = date_trunc('month', p_competencia)::date for update;
  if not found or v_f.status not in ('fechado', 'liberado') then raise exception 'mês não está fechado'; end if;
  update bpo_fin.fechamento_mensal
     set status = 'aberto', reaberturas = reaberturas + 1, revisor = null, revisado_em = null,
         liberado_por = null, liberado_em = null
   where id_fechamento = v_f.id_fechamento;
  perform bpo_fin.fn_transicao_fechamento(v_f.id_fechamento, v_f.status, 'aberto', p_motivo);
end $$;

-- Sugestão de par para a conciliação: mesmo valor em aberto, direção certa, data perto.
create function bpo_fin.fn_sugerir_pares(p_id_movimento uuid, p_limite int default 5)
returns table (id_titulo uuid, descricao text, saldo numeric, data_vencimento date, score int, motivo text)
language sql stable security invoker set search_path = '' as $$
  with m as (select * from bpo_fin.movimentos where id_movimento = p_id_movimento),
  restante as (select abs(m.valor) - coalesce((select sum(b.valor) from bpo_fin.baixas b
                 where b.id_movimento = m.id_movimento and b.revertida_em is null), 0) r from m)
  select a.id_titulo, a.descricao, a.saldo, a.data_vencimento,
         (case when a.saldo = (select r from restante) then 60 else 0 end
          + greatest(0, 25 - abs(a.data_vencimento - m.data_movimento) * 3)
          + case when a.id_contraparte is not null and a.id_contraparte = m.id_contraparte then 15 else 0 end)::int as score,
         concat_ws(' · ',
           case when a.saldo = (select r from restante) then 'valor exato' end,
           abs(a.data_vencimento - m.data_movimento) || ' dia(s) do vencimento',
           case when a.id_contraparte = m.id_contraparte then 'mesma contraparte' end) as motivo
  from m join bpo_fin.v_titulos_abertos a
    on a.id_org = m.id_org
   and a.tipo = case when m.valor > 0 then 'receber' else 'pagar' end
   and a.saldo <= (select r from restante)
   and abs(a.data_vencimento - m.data_movimento) <= 45
  order by score desc, abs(a.data_vencimento - m.data_movimento)
  limit p_limite
$$;

-- A FILA: tudo que precisa de humano, de todas as orgs visíveis, com peso de risco.
-- Só a partir da competencia_inicial da org (antes disso é histórico).
create view bpo_fin.v_fila with (security_invoker = true) as
with org as (select id_org, nome, coalesce(competencia_inicial, date '1900-01-01') ini, turma_fechamento
               from bpo_fin.organizacoes where status in ('onboarding', 'ativa'))
select o.id_org, o.nome as organizacao, 'movimento_' || v.status as tipo_item, v.id_movimento::text as id_ref,
       coalesce(v.descricao_bruta, '(sem descrição)') as descricao, v.valor, v.data_movimento as desde,
       (case v.status when 'divergente' then 80 else 50 end
        + least(30, (current_date - v.data_movimento)))::int as peso
from bpo_fin.v_movimento_status v join org o on o.id_org = v.id_org
where v.status in ('pendente', 'divergente') and v.data_movimento >= o.ini
union all
select o.id_org, o.nome, 'pagar_' || a.faixa, a.id_titulo::text, a.descricao, -a.saldo, a.data_vencimento,
       case a.faixa when 'vencido' then 85 when 'hoje' then 75 else 60 end
from bpo_fin.v_titulos_abertos a join org o on o.id_org = a.id_org
where a.tipo = 'pagar' and a.faixa in ('vencido', 'hoje', '7_dias') and a.competencia >= o.ini
union all
select o.id_org, o.nome, 'receber_vencido', a.id_titulo::text, a.descricao, a.saldo, a.data_vencimento,
       (55 + least(25, a.dias_atraso))::int
from bpo_fin.v_titulos_abertos a join org o on o.id_org = a.id_org
where a.tipo = 'receber' and a.faixa = 'vencido' and a.competencia >= o.ini
union all
select o.id_org, o.nome, 'titulo_sem_categoria', t.id_titulo::text, t.descricao,
       case when t.tipo = 'receber' then t.valor else -t.valor end, t.data_vencimento, 45
from bpo_fin.titulos t join org o on o.id_org = t.id_org
where t.cancelado_em is null and t.id_plano_conta is null and t.competencia >= o.ini
union all
select o.id_org, o.nome, 'conexao_atrasada', cx.id_conexao::text, c.apelido || ' · ' || cx.metodo, null,
       coalesce(cx.ultima_importacao_em, cx.created_at)::date, 75
from bpo_fin.conexoes cx join bpo_fin.contas c on c.id_conta = cx.id_conta join org o on o.id_org = cx.id_org
where cx.status <> 'pausada'
  and (cx.status = 'erro' or coalesce(cx.ultima_importacao_em, cx.created_at) < now() - cx.frequencia_esperada * 2);

create view bpo_fin.v_saude_conexoes with (security_invoker = true) as
select cx.id_org, cx.id_conexao, c.apelido as conta, c.instituicao, cx.metodo, cx.status,
       cx.ultima_importacao_em, cx.ultimo_movimento_em, cx.frequencia_esperada, cx.erro_msg,
       (cx.status = 'erro' or coalesce(cx.ultima_importacao_em, cx.created_at) < now() - cx.frequencia_esperada * 2) as atrasada
from bpo_fin.conexoes cx join bpo_fin.contas c on c.id_conta = cx.id_conta;

create view bpo_fin.v_tempo_org with (security_invoker = true) as
select id_org, competencia, etapa, user_auth_id, sum(minutos) as minutos, count(*) as sessoes
from bpo_fin.tempo_tarefa where fim is not null
group by 1, 2, 3, 4;

grant select on all tables in schema bpo_fin to authenticated;   -- inclui as views

-- EXECUTE: só o que a API chama. Funções internas (fn_exigir, fn_transicao…) ficam fechadas.
revoke execute on all functions in schema bpo_fin from public;
grant execute on function
  bpo_fin.fn_eh_dono(), bpo_fin.fn_orgs_visiveis(), bpo_fin.fn_pode(uuid, text),
  bpo_fin.fn_conciliar(uuid, jsonb, text), bpo_fin.fn_lancar_e_conciliar(uuid, uuid, text, uuid, uuid, date, numeric),
  bpo_fin.fn_desconciliar(uuid, text), bpo_fin.fn_ignorar(uuid, text, text), bpo_fin.fn_desfazer_ignorar(uuid),
  bpo_fin.fn_registrar_transferencia(uuid, uuid),
  bpo_fin.fn_criar_titulo(uuid, uuid, text, text, numeric, date, date, uuid, uuid, uuid, int, text),
  bpo_fin.fn_categorizar_titulo(uuid, uuid, uuid, date), bpo_fin.fn_cancelar_titulo(uuid, text),
  bpo_fin.fn_tempo_iniciar(uuid, text, date, uuid), bpo_fin.fn_tempo_parar(text),
  bpo_fin.fn_checklist_fechamento(uuid, date), bpo_fin.fn_enviar_revisao(uuid, date),
  bpo_fin.fn_revisar_fechamento(uuid, date, boolean, text), bpo_fin.fn_liberar_fechamento(uuid, date),
  bpo_fin.fn_reabrir_mes(uuid, date, text), bpo_fin.fn_sugerir_pares(uuid, int),
  bpo_fin.fn_mes_travado(uuid, date), bpo_fin.fn_competencia_sugerida(uuid, date)
to authenticated;
grant execute on function bpo_fin.fn_hash_natural(uuid, date, numeric, text, int), bpo_fin.fn_normalizar_descricao(text)
  to authenticated, vesso_fin_worker;
-- triggers e helpers internos precisam rodar para quem dispara a escrita
grant execute on function bpo_fin.fn_mes_travado(uuid, date), bpo_fin.fn_orgs_visiveis(), bpo_fin.fn_eh_dono()
  to vesso_fin_worker;

commit;
