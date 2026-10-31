\set ON_ERROR_STOP 1
-- Testes da 0012 (plano pela tela, modelo Clínica médica, feriados). Banco NOVO: stubs + 0001 + 0003..0005 + 0007..0012 + seed.
create or replace function public.como(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user)::text, false);
  perform set_config('role', 'authenticated', false);
end $$;
create or replace function public.esperar_erro(p_sql text, p_trecho text) returns void language plpgsql as $$
begin
  begin execute p_sql;
  exception when others then
    if position(p_trecho in sqlerrm) = 0 then raise exception 'FALHA: erro inesperado para [%]: %', p_sql, sqlerrm; end if;
    raise notice 'ok (bloqueou): %', p_trecho; return;
  end;
  raise exception 'FALHA: deveria ter bloqueado: %', p_sql;
end $$;
create or replace function public.checar(p_ok boolean, p_msg text) returns void language plpgsql as $$
begin
  if not p_ok then raise exception 'FALHA: %', p_msg; end if;
  raise notice 'ok: %', p_msg;
end $$;
grant execute on function public.como(uuid), public.esperar_erro(text, text), public.checar(boolean, text) to public;
create table public.r (k text primary key, v jsonb);
grant all on public.r to public;
-- 1. FERIADOS / PRAZO ──────────────────────────────────────────────────────────────────────
select checar(bpo_fin.fn_prazo_fechamento('2026-10-01', 6) = '2026-11-10', 'out/26 turma A: 10/11 (Finados na segunda empurra um dia)');
select checar(bpo_fin.fn_prazo_fechamento('2026-12-01', 6) = '2027-01-11', 'dez/26 turma A: 11/01 (1º de janeiro)');
select checar(bpo_fin.fn_prazo_fechamento('2027-01-01', 14) = '2027-02-22', 'jan/27 turma C: 22/02 (Carnaval)');
select checar(bpo_fin.fn_prazo_fechamento('2026-08-01', 10) = '2026-09-15', 'ago/26 turma B: 15/09 (7 de setembro)');
select checar((select count(*) = 65 from bpo_fin.feriados), '65 feriados 2026–2030');

-- 2. MODELO CLÍNICA MÉDICA ───────────────────────────────────────────────────────────────
select checar((select count(*) = 51 and count(*) filter (where natureza = 'grupo') = 11 and count(*) filter (where natureza <> 'grupo' and id_pai is null) = 0
                      and count(*) filter (where generica) = 4
               from bpo_fin.plano_contas p join bpo_fin.plano_contas_modelos m using (id_modelo) where m.nome = 'Clínica médica'),
              'modelo: 11 grupos + 40 contas, toda conta dentro de um grupo, 4 genéricas');
select checar((select bool_and(bpo_fin.fn_linha_dre_valida(linha_dre)) and bool_and(entra_dre = (linha_dre is not null))
               from bpo_fin.plano_contas p join bpo_fin.plano_contas_modelos m using (id_modelo) where m.nome = 'Clínica médica'), 'modelo: linhas do DRE conhecidas e coerentes');
insert into app_seis.clientes values ('10000000-0000-0000-0000-000000000009', 'Dra. Modelo');
select como('00000000-0000-0000-0000-0000000000d0');
insert into public.r select 'm', to_jsonb(bpo_fin.fn_criar_organizacao('Clínica Modelo', 'cliente', '10000000-0000-0000-0000-000000000009', null, null, '33444555000166', 'simples',
  '2026-11-01', 'A', null, (select id_modelo from bpo_fin.plano_contas_modelos where nome = 'Clínica médica')));
select checar((select count(*) = 51 and count(id_pai) = 40 from bpo_fin.plano_contas where id_org = (select (v #>> '{}')::uuid from public.r where k = 'm')),
              'org criada pelo modelo recebe o plano inteiro com a hierarquia');

-- 3. PLANO PELA TELA ──────────────────────────────────────────────────────────────────────
select como('00000000-0000-0000-0000-0000000000b1');  -- head (configurar_org na org B)
insert into public.r select 'g', to_jsonb(bpo_fin.fn_criar_plano_conta('20000000-0000-0000-0000-00000000000b', 'G_EXTRA', 'Grupo extra', null, 'grupo', null, null, null, false, false));
insert into public.r select 'c', to_jsonb(bpo_fin.fn_criar_plano_conta('20000000-0000-0000-0000-00000000000b', 'CAT_TELEMEDICINA', 'Telemedicina',
  (select (v #>> '{}')::uuid from public.r where k = 'g'), 'receita', 'RECEITA_BRUTA', null, null, false, false));
select checar((select aceita_lancamento and entra_dre and entra_dfc and grupo_dfc = 'operacional' and regra_competencia = 'mes_corrente'
               from bpo_fin.plano_contas where id_plano_conta = (select (v #>> '{}')::uuid from public.r where k = 'c')), 'conta nova: flags derivados (DRE, DFC operacional)');
select checar((select not aceita_lancamento and not entra_dre and not entra_dfc from bpo_fin.plano_contas where id_plano_conta = (select (v #>> '{}')::uuid from public.r where k = 'g')), 'grupo não recebe lançamento');
select esperar_erro($$select bpo_fin.fn_criar_plano_conta('20000000-0000-0000-0000-00000000000b', 'cat minúsculo', 'X', null, 'receita', 'RECEITA_BRUTA', null, null, false, false)$$, 'código');
select esperar_erro($$select bpo_fin.fn_criar_plano_conta('20000000-0000-0000-0000-00000000000b', 'CAT_TELEMEDICINA', 'Dup', null, 'receita', 'RECEITA_BRUTA', null, null, false, false)$$, 'já existe conta com o código');
select esperar_erro($$select bpo_fin.fn_criar_plano_conta('20000000-0000-0000-0000-00000000000b', 'CAT_TRANSF2', 'Transf', null, 'transferencia', 'DEDUCOES', null, null, false, false)$$, 'não entram no DRE');
select esperar_erro($$select bpo_fin.fn_criar_plano_conta('20000000-0000-0000-0000-00000000000b', 'CAT_X1', 'X1', null, 'receita', 'LINHA_INVENTADA', null, null, false, false)$$, 'linha do DRE inválida');
select esperar_erro(format($$select bpo_fin.fn_criar_plano_conta('20000000-0000-0000-0000-00000000000b', 'CAT_X2', 'X2', %L, 'receita', 'RECEITA_BRUTA', null, null, false, false)$$,
  (select v #>> '{}' from public.r where k = 'c')), 'precisa ser um grupo');
select bpo_fin.fn_editar_plano_conta((select (v #>> '{}')::uuid from public.r where k = 'c'), 'Telemedicina (online)', (select (v #>> '{}')::uuid from public.r where k = 'g'),
  'RECEITA_BRUTA', null, 'mes_anterior', false, false, true);
select checar((select nome = 'Telemedicina (online)' and regra_competencia = 'mes_anterior' from bpo_fin.plano_contas where id_plano_conta = (select (v #>> '{}')::uuid from public.r where k = 'c')), 'editar nome e regra');
select esperar_erro(format($$select bpo_fin.fn_editar_plano_conta(%L, 'Grupo extra', null, null, null, null, false, false, false)$$, (select v #>> '{}' from public.r where k = 'g')), 'conta ativa dentro');
-- ciclo: G_FILHO dentro de G_EXTRA; pôr G_EXTRA dentro de G_FILHO é recusado
insert into public.r select 'g2', to_jsonb(bpo_fin.fn_criar_plano_conta('20000000-0000-0000-0000-00000000000b', 'G_FILHO', 'Grupo filho', (select (v #>> '{}')::uuid from public.r where k = 'g'), 'grupo', null, null, null, false, false));
select esperar_erro(format($$select bpo_fin.fn_editar_plano_conta(%L, 'Grupo extra', %L, null, null, null, false, false, true)$$,
  (select v #>> '{}' from public.r where k = 'g'), (select v #>> '{}' from public.r where k = 'g2')), 'está dentro desta conta');

-- linha do DRE de conta com título em mês fechado: recusa
reset role;
insert into public.r select 't', to_jsonb((select id_plano_conta from bpo_fin.titulos where id_org = '20000000-0000-0000-0000-00000000000b' and id_plano_conta is not null and cancelado_em is null limit 1));
insert into bpo_fin.fechamento_mensal (id_org, competencia, status)
select '20000000-0000-0000-0000-00000000000b', competencia, 'fechado' from bpo_fin.titulos
 where id_plano_conta = (select (v #>> '{}')::uuid from public.r where k = 't') and cancelado_em is null limit 1;
select como('00000000-0000-0000-0000-0000000000b1');
select esperar_erro(format($$select bpo_fin.fn_editar_plano_conta(%1$L, (select nome from bpo_fin.plano_contas where id_plano_conta = %1$L), null, 'DESPESAS_FIXAS_OUTRAS', null, null, null, null, true)$$,
  (select v #>> '{}' from public.r where k = 't')), 'mês fechado');
select bpo_fin.fn_editar_plano_conta((select (v #>> '{}')::uuid from public.r where k = 't'), 'Nome novo ok',
  (select id_pai from bpo_fin.plano_contas where id_plano_conta = (select (v #>> '{}')::uuid from public.r where k = 't')),
  (select linha_dre from bpo_fin.plano_contas where id_plano_conta = (select (v #>> '{}')::uuid from public.r where k = 't')), null, null, null, null, true);
select checar(true, 'renomear conta com mês fechado pode (linha do DRE igual)');
select como('00000000-0000-0000-0000-0000000000a1');
select esperar_erro($$select bpo_fin.fn_criar_plano_conta('20000000-0000-0000-0000-00000000000b', 'CAT_A1', 'A1', null, 'receita', 'RECEITA_BRUTA', null, null, false, false)$$, 'sem permissão');
reset role;
select checar((select count(*) >= 2 from bpo_fin.log_eventos where tabela = 'plano_contas' and acao = 'insert'), 'plano auditado');

select checar(true, 'TODOS OS TESTES DA 0012 PASSARAM');
