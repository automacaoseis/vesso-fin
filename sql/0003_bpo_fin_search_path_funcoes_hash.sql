-- 0003 · fixa search_path das duas funções auxiliares de hash (aviso do Security Advisor do Supabase).
-- Aplicada em produção em 23/10/2026 como 20261023114802_bpo_fin_0003_search_path_funcoes_hash.
alter function bpo_fin.fn_normalizar_descricao(text) set search_path = '';
alter function bpo_fin.fn_hash_natural(uuid, date, numeric, text, int) set search_path = '';
