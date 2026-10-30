-- 0007 · Informar saldo de conta à mão.
-- Por quê: o checklist do fechamento (fn_checklist_fechamento) exige saldo da fonte nos últimos dias do mês para
-- TODA conta ativa, mas só o worker escreve em saldos_extrato. Conta sem extrato nem API (PayPal, aplicação RDB)
-- nunca passava e o mês da org ficava preso para sempre. Entrada é RPC com checagem de ação, como o resto.
-- Regras: ação 'conciliar'; mês travado recusa; saldo vindo de extrato/API não é sobrescrito à mão (a fonte vence);
-- quem informou fica gravado, e some quando a fonte passa a mandar o saldo daquela data.
-- Aplicada em produção em 30/10/2026 como 20261030112211_bpo_fin_0007_informar_saldo.
begin;

alter table bpo_fin.saldos_extrato
  add column informado_por uuid,
  add column informado_em timestamptz;

create function bpo_fin.fn_informar_saldo(p_id_conta uuid, p_data date, p_saldo numeric) returns void
language plpgsql security definer set search_path = '' as $$
declare v_c bpo_fin.contas%rowtype; v_ext uuid;
begin
  select * into v_c from bpo_fin.contas where id_conta = p_id_conta;
  if not found then raise exception 'conta não encontrada'; end if;
  perform bpo_fin.fn_exigir(v_c.id_org, 'conciliar');
  if not v_c.ativa then raise exception 'conta inativa'; end if;
  if p_data is null or p_saldo is null then raise exception 'data e saldo são obrigatórios'; end if;
  if p_data > (now() at time zone 'America/Sao_Paulo')::date then raise exception 'data no futuro'; end if;
  if v_c.data_saldo_inicial is not null and p_data < v_c.data_saldo_inicial then
    raise exception 'data anterior ao saldo inicial da conta (%)', to_char(v_c.data_saldo_inicial, 'DD/MM/YYYY');
  end if;
  if bpo_fin.fn_mes_travado(v_c.id_org, p_data) then raise exception 'mês fechado: reabra antes'; end if;
  select s.id_extrato into v_ext from bpo_fin.saldos_extrato s where s.id_conta = p_id_conta and s.data = p_data;
  if v_ext is not null then raise exception 'o saldo desta data veio do extrato: não dá para sobrescrever à mão'; end if;
  insert into bpo_fin.saldos_extrato (id_conta, data, saldo, informado_por, informado_em)
  values (p_id_conta, p_data, round(p_saldo, 2), auth.uid(), now())
  on conflict (id_conta, data) do update set saldo = excluded.saldo, informado_por = excluded.informado_por, informado_em = excluded.informado_em;
end $$;

-- Quando a fonte (worker) grava o saldo da mesma data, ele passa a ser da fonte: limpa a marca de "informado à mão".
create function bpo_fin.tg_saldo_da_fonte() returns trigger language plpgsql set search_path = '' as $$
begin
  if new.id_extrato is not null then new.informado_por := null; new.informado_em := null; end if;
  return new;
end $$;
create trigger saldo_da_fonte before update on bpo_fin.saldos_extrato for each row execute function bpo_fin.tg_saldo_da_fonte();

revoke execute on function bpo_fin.fn_informar_saldo(uuid, date, numeric) from public;
grant execute on function bpo_fin.fn_informar_saldo(uuid, date, numeric) to authenticated;

commit;
