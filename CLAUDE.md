# Vesso FIN — regras para o Claude Code

Leia `docs/PROMPT.md` inteiro antes de qualquer trabalho. É a especificação da Fase 1.

## Inegociável
- **Nunca aplicar migration nem rodar SQL de escrita em produção (`gzdvkqzliyupiuyaqkpj`) sem o Luiz confirmar na conversa.** Ordem sempre: Postgres local → branch do Supabase → produção.
- **Não reescrever `sql/0001` nem `sql/0002` do zero.** São as versões testadas (43 verificações do núcleo + importação com `nao_explicado = 0`). Mudança = edição pontual + teste passando de novo.
- `service_role` não existe neste projeto. Nada de `NEXT_PUBLIC_SUPABASE_*` nem `@supabase/supabase-js` no navegador.
- Credencial (Asaas, banco) só no Vault do Supabase, nunca no repositório.
- `bpo_fin.fn_importar_historico_seis` roda UMA vez, em produção, só com o Luiz confirmando a data.

## Testes do banco (rodar sempre num banco NOVO — o teste não é reexecutável no mesmo banco)
Ver README.md.
