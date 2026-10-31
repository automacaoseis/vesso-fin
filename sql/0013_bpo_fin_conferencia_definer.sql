-- 0013 · Conferência (tela do dono) lida com a visão completa do financeiro_seis.
-- Por quê: v_conferencia_dre_seis (0006) é security_invoker, e as tabelas do financeiro_seis têm RLS própria
-- (extrato_admin, extrato_ceo_produto, categorias_macro_admin…). Pela API — que roda COMO o usuário — o lado
-- "financeiro_seis" vinha cortado pela RLS de lá: em 31/10 a tela mostrava 24 meses com diferença na Seis e série
-- até 2028; lida como administrador eram 2 meses (out e nov/26). O conferido tem que ser o dado inteiro.
-- Desenho: função SECURITY DEFINER que exige fn_eh_dono() e devolve a view. Só o dono executa (a checagem é dentro);
-- a view continua existindo para leitura administrativa.
begin;

-- colunas explícitas (e plpgsql): a função existe mesmo onde a view da importação não existe (testes da API)
create function bpo_fin.fn_conferencia_dre_seis() returns table (
  id_org uuid, organizacao text, competencia date, dre_financeiro_seis numeric, dre_vesso_fin numeric, diferenca numeric,
  explicado_caso_e numeric, explicado_caso_i numeric, nao_explicado numeric)
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'sem sessão' using errcode = '28000'; end if;
  if not bpo_fin.fn_eh_dono() then raise exception 'só o dono vê a conferência da Seis' using errcode = '42501'; end if;
  return query select v.id_org, v.organizacao, v.competencia, v.dre_financeiro_seis, v.dre_vesso_fin, v.diferenca,
                      v.explicado_caso_e, v.explicado_caso_i, v.nao_explicado
                 from bpo_fin.v_conferencia_dre_seis v order by v.organizacao, v.competencia;
end $$;

revoke execute on function bpo_fin.fn_conferencia_dre_seis() from public;
grant execute on function bpo_fin.fn_conferencia_dre_seis() to authenticated;

commit;
