\set ON_ERROR_STOP 1
-- Testes da 0006 (uma org casa por empresa). Rodar DEPOIS de select bpo_fin.fn_importar_historico_seis(...) no banco da importação.
create or replace function public.checar(p_ok boolean, p_msg text) returns void language plpgsql as $$
begin
  if not p_ok then raise exception 'FALHA: %', p_msg; end if;
  raise notice 'ok: %', p_msg;
end $$;
create temp view o as select id_org, nome from bpo_fin.organizacoes where tipo = 'casa';
\set SEIS '(select id_org from o where nome = ''Agência Seis'')'
\set TASK '(select id_org from o where nome = ''Task SV'')'

select checar((select count(*) = 2 from o), 'duas organizações casa: Agência Seis e Task SV');
select checar((select string_agg(cnpj, ',') = '58607550000153' from bpo_fin.entidades where id_org = :TASK), 'Task SV tem só a entidade dela (CNPJ próprio)');
select checar((select count(*) = 1 from bpo_fin.entidades where id_org = :SEIS), 'Seis tem só a entidade dela');
select checar((select bool_and(apelido like '%Task SV%' or instituicao = 'Legado') from bpo_fin.contas where id_org = :TASK), 'contas da Task SV são só dela (+ a de legado própria)');
select checar((select count(*) = 1 from bpo_fin.contas where id_org = :TASK and instituicao = 'Legado')
          and (select count(*) = 1 from bpo_fin.contas where id_org = :SEIS and instituicao = 'Legado'), 'uma conta de legado por org');
select checar((select count(*) from bpo_fin.plano_contas where id_org = :TASK) = (select count(*) from bpo_fin.plano_contas where id_org = :SEIS)
          and (select count(*) > 0 from bpo_fin.plano_contas where id_org = :TASK), 'plano de contas clonado nas duas');
select checar((select count(*) = 1 from bpo_fin.contrapartes where id_org = :TASK and origem_legado = 'ENT_CLI1_TASK')
          and not exists (select 1 from bpo_fin.contrapartes where id_org = :TASK and origem_legado = 'ENT_CLI1'),
              'contraparte da Task SV fica na Task SV; a da Seis, na Seis');
select checar((select count(*) = 2 from bpo_fin.contrapartes where documento = '12345678000190'), 'mesmo CNPJ de cliente vira uma contraparte em cada org');
select checar(not exists (select 1 from bpo_fin.titulos t join bpo_fin.plano_contas pc on pc.id_plano_conta = t.id_plano_conta where pc.id_org <> t.id_org),
              'nenhum título aponta para plano de contas de outra org');
select checar(not exists (select 1 from bpo_fin.titulos t join bpo_fin.centros_custo cc on cc.id_centro_custo = t.id_centro_custo where cc.id_org <> t.id_org),
              'nenhum título aponta para centro de custo de outra org');
select checar((select count(*) = 1 from bpo_fin.centros_custo where id_org = :TASK), 'centro de custo da Task SV = só o produto dela');
select checar((select count(*) = 2 from bpo_fin.movimentos_ignorados where motivo like 'Transferência entre as empresas do grupo%')
          and (select count(distinct id_org) = 2 from bpo_fin.movimentos_ignorados where motivo like 'Transferência entre as empresas do grupo%'),
              'transferência Seis → Task SV: ignorada nos dois lados, com motivo próprio');
select checar((select count(*) = 1 from bpo_fin.transferencias), 'transferência entre contas da MESMA org continua pareada (A6 × M4)');
select checar((select count(*) = 0 from bpo_fin.v_conferencia_dre_seis where nao_explicado <> 0), 'conferência por org: nao_explicado = 0');
select checar(true, 'TODOS OS TESTES DA 0006 PASSARAM');
