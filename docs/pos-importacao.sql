-- ════════════════════════════════════════════════════════════════════════════════════
-- Passos manuais depois da importação (27/10/2026). Rodar no SQL Editor do Supabase, NA ORDEM.
-- Nada aqui tem segredo: chaves e senhas você digita na hora, no lugar dos <…>.
-- ════════════════════════════════════════════════════════════════════════════════════

-- 1. Você como dono (o único). Troque o e-mail pelo seu de login.
insert into bpo_fin.donos (user_auth_id) select id from auth.users where email = '<seu e-mail de login>';

-- 2. Senhas dos logins da API e do worker (gere duas fortes; vão para o env da Railway, nunca para o git).
alter role vesso_fin_api    with login password '<senha forte 1>';
alter role vesso_fin_worker with login password '<senha forte 2>';

-- 3. Asaas por API — uma chave por empresa, no Vault. A chave só existe dentro do Vault.
--    (o sync roda todo dia às 06:00 de Brasília; para rodar já: select bpo_fin.fn_agendar_sync_asaas();)
with s as (select vault.create_secret('<chave Asaas da Seis Marketing>', 'asaas_seis_marketing', 'Asaas · Seis Marketing — Vesso FIN') id)
insert into bpo_fin.conexoes (id_org, id_conta, metodo, id_segredo)
select 'f41614cb-7e4c-4285-8bf3-f7051f66a95d', 'b806996d-575f-439a-9728-2847757dbe6a', 'asaas_api', s.id from s;

with s as (select vault.create_secret('<chave Asaas da Task SV>', 'asaas_task_sv', 'Asaas · Task SV — Vesso FIN') id)
insert into bpo_fin.conexoes (id_org, id_conta, metodo, id_segredo)
select 'f0205731-27e1-4e37-bfa5-3bbf47c180ed', '00610933-b1f2-4d46-b4d5-a1349e1689ce', 'asaas_api', s.id from s;

-- 4. Nubank por OFX (upload na tela Conexões) + o final de cada conta, que trava arquivo de conta errada.
update bpo_fin.contas set numero_final = '<4 últimos dígitos>' where id_conta = '8e07eaf2-6d43-4cb5-81c1-19eb2ac959b4';  -- Nubank · Seis Marketing
update bpo_fin.contas set numero_final = '<4 últimos dígitos>' where id_conta = '5376ff40-bf8d-4722-9853-981a84d5188b';  -- Nubank · Task SV
insert into bpo_fin.conexoes (id_org, id_conta, metodo) values
  ('f41614cb-7e4c-4285-8bf3-f7051f66a95d', '8e07eaf2-6d43-4cb5-81c1-19eb2ac959b4', 'ofx'),
  ('f0205731-27e1-4e37-bfa5-3bbf47c180ed', '5376ff40-bf8d-4722-9853-981a84d5188b', 'ofx');
-- PayPal · Seis e Aplicação RDB · Seis: sem conexão por enquanto (sem OFX/API na Fase 1a).

-- 5. Saldo inicial real de cada conta numa data de corte (sem isso a conferência de saldo do histórico não bate;
--    o sistema só EXIGE saldo a partir de nov/26). Exemplo:
-- update bpo_fin.contas set saldo_inicial = <valor>, data_saldo_inicial = '<AAAA-MM-DD>' where id_conta = '<id>';

-- 6. Painel: Settings → API → Exposed schemas → confirmar que bpo_fin NÃO está na lista.
