'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { fmtBRL, REGIMES, STATUS_ORG, TIPOS_CONTA } from '@vesso-fin/shared'
import { theme } from '@/lib/theme'
import { botaoPrimario, botaoSecundario, estiloCampo } from '@/components/vesso'
import { Aviso, botaoSecundarioCompacto, CampoRotulado, campoCompacto, Painel } from '@/components/fin-ui'
import BuscaCliente from '../../../organizacoes/BuscaCliente'
import * as A from '../../../organizacoes/acoes'

interface Conta {
  id_conta: string; id_entidade: string; tipo: (typeof TIPOS_CONTA)[number]; instituicao: string; apelido: string; numero_final: string | null
  saldo_inicial: number | string; data_saldo_inicial: string; ativa: boolean; conexoes: { metodo: string; status: string }[]
}
export interface DadosCadastro {
  org: { id_org: string; nome: string; tipo: 'cliente' | 'casa'; status: (typeof STATUS_ORG)[number]; turma_fechamento: string | null; competencia_inicial: string | null; id_cliente: string | null; id_cliente_portal: string | null }
  cliente: { id_cliente: string; nome: string; via: 'cliente' | 'portal' } | null
  entidades: { id_entidade: string; razao_social: string; nome_fantasia: string | null; cnpj: string; regime_tributario: string | null; ativa: boolean }[]
  contas: Conta[]
  plano: { itens: number; analiticas: number }
  pode: { configurar: boolean; dono: boolean }
}
type Res = { ok: boolean; mensagem?: string }
const ROT_STATUS: Record<string, string> = { raio_x: 'Raio-X', onboarding: 'Implantação', ativa: 'Ativa', encerrada: 'Encerrada' }
const ROT_TIPO: Record<string, string> = { banco: 'Banco', gateway: 'Gateway (Asaas…)', adquirente: 'Adquirente (maquininha)', aplicacao: 'Aplicação', caixa: 'Caixa físico' }
const ROT_METODO: Record<string, string> = { ofx: 'OFX', manual: 'Manual', asaas_api: 'API Asaas', csv: 'CSV', open_finance: 'Open Finance', arquivo_adquirente: 'Arquivo da adquirente' }
const ROT_REGIME: Record<string, string> = { mei: 'MEI', simples: 'Simples', presumido: 'Presumido', real: 'Real' }
const cnpjFmt = (c: string) => c.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5')

export default function CadastroClient({ d, turmas }: { d: DadosCadastro; turmas: { codigo: string; nome: string }[] }) {
  const router = useRouter()
  const [aviso, setAviso] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null)
  useEffect(() => { if (!aviso) return; const t = setTimeout(() => setAviso(null), aviso.tipo === 'erro' ? 9000 : 3000); return () => clearTimeout(t) }, [aviso])
  const feito = (r: Res, ok: string) => { if (!r.ok) { setAviso({ tipo: 'erro', texto: r.mensagem ?? 'Não deu' }); return false } setAviso({ tipo: 'ok', texto: ok }); router.refresh(); return true }
  const pode = d.pode.configurar
  const ativas = d.contas.filter((c) => c.ativa)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18, maxWidth: 1040 }}>
      <div style={{ paddingBottom: 14, borderBottom: `1px solid ${theme.borderStrong}` }}>
        <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.14em', textTransform: 'uppercase', color: theme.accent }}>Cadastro · {d.org.tipo === 'casa' ? 'empresa da casa' : 'cliente do BPO'}</div>
        <h1 className="v-manchete" style={{ fontFamily: theme.display, fontSize: 32, fontWeight: 500, letterSpacing: '-0.015em', lineHeight: 1.1, margin: '6px 0 0' }}>{d.org.nome}</h1>
      </div>

      <Dados d={d} turmas={turmas} pode={pode} onFeito={feito} />
      <Portal d={d} onFeito={feito} />

      <Painel aria-label="Entidades" rotulo={`Entidades (CNPJ) · ${d.entidades.length}`}>
        {d.entidades.map((e) => (
          <div key={e.id_entidade} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '10px 16px', borderBottom: `1px solid ${theme.borderFaint}`, fontSize: 13 }}>
            <span><strong>{e.razao_social}</strong>{e.nome_fantasia && <span style={{ color: theme.text3 }}> · {e.nome_fantasia}</span>}</span>
            <span style={{ color: theme.text2, fontVariantNumeric: 'tabular-nums' }}>{cnpjFmt(e.cnpj)}{e.regime_tributario && ` · ${ROT_REGIME[e.regime_tributario]}`}</span>
          </div>
        ))}
        {pode && <NovaEntidade idOrg={d.org.id_org} primeira={d.entidades.length === 0} onFeito={feito} />}
      </Painel>

      <Painel aria-label="Contas" rotulo={`Contas · ${ativas.length} ativa${ativas.length === 1 ? '' : 's'}`}>
        {d.contas.length === 0 && <div style={{ padding: 16, fontSize: 12.5, color: theme.text3 }}>Nenhuma conta ainda. Sem conta não há extrato, conciliação nem fechamento.</div>}
        {d.contas.map((c) => <LinhaConta key={c.id_conta} c={c} pode={pode} entidade={d.entidades.find((e) => e.id_entidade === c.id_entidade)} onFeito={feito} />)}
        {pode && d.entidades.length > 0 && <NovaConta idOrg={d.org.id_org} entidades={d.entidades} onFeito={feito} />}
      </Painel>

      <Painel aria-label="Plano de contas" rotulo="Plano de contas">
        <div style={{ padding: '12px 16px', fontSize: 13, color: theme.text2 }}>
          {d.plano.itens === 0
            ? <span style={{ color: theme.negative }}>▲ Sem plano de contas: não dá para categorizar nem montar DRE. </span>
            : <>{d.plano.itens} contas, {d.plano.analiticas} que recebem lançamento. </>}
          <Link href={`/org/${d.org.id_org}/plano`} style={{ color: theme.accent }}>{d.plano.itens === 0 ? 'Montar o plano →' : 'Editar plano →'}</Link>
        </div>
      </Painel>
      {aviso && <Aviso tipo={aviso.tipo}>{aviso.texto}</Aviso>}
    </div>
  )
}

function Dados({ d, turmas, pode, onFeito }: { d: DadosCadastro; turmas: { codigo: string; nome: string }[]; pode: boolean; onFeito: (r: Res, ok: string) => boolean }) {
  const [nome, setNome] = useState(d.org.nome)
  const [status, setStatus] = useState<string>(d.org.status)
  const [turma, setTurma] = useState(d.org.turma_fechamento ?? '')
  const [comp, setComp] = useState(d.org.competencia_inicial?.slice(0, 7) ?? '')
  const [ocupado, setOcupado] = useState(false)
  const mudou = nome !== d.org.nome || status !== d.org.status || turma !== (d.org.turma_fechamento ?? '') || comp !== (d.org.competencia_inicial?.slice(0, 7) ?? '')
  return (
    <Painel aria-label="Dados" rotulo="Dados">
      <form style={{ padding: '14px 16px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12, alignItems: 'end' }}
        onSubmit={async (e) => { e.preventDefault(); setOcupado(true); const r = await A.atualizarOrg(d.org.id_org, { nome, status, turma: turma || null, competencia_inicial: `${comp}-01` }); setOcupado(false); onFeito(r as Res, 'Dados salvos') }}>
        <CampoRotulado rotulo="Nome"><input value={nome} onChange={(e) => setNome(e.target.value)} disabled={!pode} style={estiloCampo} /></CampoRotulado>
        <CampoRotulado rotulo="Situação"><select value={status} onChange={(e) => setStatus(e.target.value)} disabled={!pode} style={estiloCampo}>{STATUS_ORG.map((s) => <option key={s} value={s}>{ROT_STATUS[s]}</option>)}</select></CampoRotulado>
        <CampoRotulado rotulo="Turma"><select value={turma} onChange={(e) => setTurma(e.target.value)} disabled={!pode} style={estiloCampo}><option value="">Sem turma</option>{turmas.map((t) => <option key={t.codigo} value={t.codigo}>{t.nome}</option>)}</select></CampoRotulado>
        <CampoRotulado rotulo="Competência inicial"><input type="month" value={comp} onChange={(e) => setComp(e.target.value)} disabled={!pode} style={estiloCampo} /></CampoRotulado>
        {pode && <button type="submit" disabled={!mudou || ocupado || !comp} style={botaoPrimario(!mudou || ocupado || !comp)}>Salvar</button>}
      </form>
    </Painel>
  )
}

function Portal({ d, onFeito }: { d: DadosCadastro; onFeito: (r: Res, ok: string) => boolean }) {
  const [escolhido, setEscolhido] = useState<A.ClienteBusca | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const ligar = async (id: string | null, ok: string) => { setOcupado(true); const r = await A.ligarPortal(d.org.id_org, id); setOcupado(false); if (onFeito(r as Res, ok)) setEscolhido(null) }
  return (
    <Painel aria-label="Portal do cliente" rotulo="Portal do cliente (vesso-clientes)">
      <div style={{ padding: '12px 16px', display: 'grid', gap: 10, fontSize: 13 }}>
        {d.cliente
          ? <div>O portal de <strong>{d.cliente.nome}</strong> mostra esta organização: Meu caixa e Relatórios só com mês <strong>liberado</strong>, e Documentos.</div>
          : <div style={{ color: theme.text2 }}>{d.org.tipo === 'casa' ? 'Não aparece em nenhum portal.' : 'Cliente sem ligação com o portal.'}</div>}
        {d.org.tipo === 'casa' && d.pode.dono && (
          d.cliente
            ? <button disabled={ocupado} onClick={() => ligar(null, 'Desligada do portal')} style={{ ...botaoSecundario(), justifySelf: 'start' }}>Tirar do portal</button>
            : <div style={{ display: 'flex', gap: 8, alignItems: 'start', flexWrap: 'wrap' }}>
                <div style={{ flex: '1 1 320px' }}><BuscaCliente valor={escolhido} onEscolher={setEscolhido} /></div>
                <button disabled={!escolhido || ocupado} onClick={() => ligar(escolhido!.id_cliente, `Agora aparece no portal de ${escolhido!.nome}`)} style={botaoPrimario(!escolhido || ocupado)}>Mostrar no portal</button>
              </div>
        )}
        {d.org.tipo === 'casa' && <div style={{ fontSize: 11.5, color: theme.text3 }}>Empresa da casa continua da casa: não conta como cliente e a equipe com acesso global não passa a vê-la.</div>}
      </div>
    </Painel>
  )
}

function LinhaConta({ c, pode, entidade, onFeito }: { c: Conta; pode: boolean; entidade?: DadosCadastro['entidades'][number]; onFeito: (r: Res, ok: string) => boolean }) {
  const [desativando, setDesativando] = useState(false)
  const [motivo, setMotivo] = useState('')
  return (
    <div style={{ padding: '10px 16px', borderBottom: `1px solid ${theme.borderFaint}`, fontSize: 13, opacity: c.ativa ? 1 : 0.55 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'baseline' }}>
        <span><strong>{c.apelido}</strong> <span style={{ color: theme.text3 }}>· {ROT_TIPO[c.tipo]} · {c.instituicao}{c.numero_final ? ` final ${c.numero_final}` : ''}{entidade ? ` · ${entidade.nome_fantasia ?? entidade.razao_social}` : ''}</span></span>
        <span style={{ display: 'flex', gap: 10, alignItems: 'center', color: theme.text2 }}>
          <span style={{ fontVariantNumeric: 'tabular-nums' }}>saldo inicial R$ {fmtBRL(Number(c.saldo_inicial))} em {c.data_saldo_inicial.split('-').reverse().join('/')}</span>
          <span>{c.conexoes.length ? c.conexoes.map((x) => `${ROT_METODO[x.metodo] ?? x.metodo}${x.status !== 'ativa' ? ` (${x.status})` : ''}`).join(', ') : 'sem conexão'}</span>
          {!c.ativa && <span style={{ color: theme.text3 }}>inativa</span>}
          {pode && c.ativa && <button onClick={() => setDesativando(!desativando)} style={botaoSecundarioCompacto()}>Desativar</button>}
        </span>
      </div>
      {desativando && (
        <form style={{ display: 'flex', gap: 8, marginTop: 8 }} onSubmit={async (e) => { e.preventDefault(); const r = await A.desativarConta(c.id_conta, motivo); if (onFeito(r as Res, 'Conta desativada')) setDesativando(false) }}>
          <input value={motivo} onChange={(e) => setMotivo(e.target.value)} autoFocus placeholder="Motivo (ex.: conta encerrada no banco)" aria-label="Motivo" style={{ ...campoCompacto, flex: 1, padding: '7px 10px' }} />
          <button type="submit" disabled={motivo.trim().length < 5} style={botaoPrimario(motivo.trim().length < 5)}>Desativar</button>
        </form>
      )}
    </div>
  )
}

function NovaEntidade({ idOrg, primeira, onFeito }: { idOrg: string; primeira: boolean; onFeito: (r: Res, ok: string) => boolean }) {
  const [aberto, setAberto] = useState(false)
  const [razao, setRazao] = useState(''); const [fantasia, setFantasia] = useState(''); const [cnpj, setCnpj] = useState(''); const [regime, setRegime] = useState('')
  if (!aberto) return <div style={{ padding: '10px 16px' }}><button onClick={() => setAberto(true)} style={botaoSecundarioCompacto()}>{primeira ? '+ CNPJ' : '+ Outro CNPJ'}</button></div>
  return (
    <form style={{ padding: '12px 16px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10, alignItems: 'end' }}
      onSubmit={async (e) => { e.preventDefault(); const r = await A.criarEntidade(idOrg, { razao_social: razao, nome_fantasia: fantasia || undefined, cnpj, regime: regime || null }); if (onFeito(r as Res, 'Entidade criada')) setAberto(false) }}>
      <CampoRotulado rotulo="Razão social"><input value={razao} onChange={(e) => setRazao(e.target.value)} style={estiloCampo} /></CampoRotulado>
      <CampoRotulado rotulo="Nome fantasia"><input value={fantasia} onChange={(e) => setFantasia(e.target.value)} style={estiloCampo} /></CampoRotulado>
      <CampoRotulado rotulo="CNPJ"><input value={cnpj} onChange={(e) => setCnpj(e.target.value)} inputMode="numeric" style={estiloCampo} /></CampoRotulado>
      <CampoRotulado rotulo="Regime"><select value={regime} onChange={(e) => setRegime(e.target.value)} style={estiloCampo}><option value="">—</option>{REGIMES.map((r) => <option key={r} value={r}>{ROT_REGIME[r]}</option>)}</select></CampoRotulado>
      <div style={{ display: 'flex', gap: 8 }}><button type="submit" style={botaoPrimario(razao.trim().length < 2)} disabled={razao.trim().length < 2}>Criar</button><button type="button" onClick={() => setAberto(false)} style={botaoSecundario()}>Cancelar</button></div>
    </form>
  )
}

function NovaConta({ idOrg, entidades, onFeito }: { idOrg: string; entidades: DadosCadastro['entidades']; onFeito: (r: Res, ok: string) => boolean }) {
  const [aberto, setAberto] = useState(false)
  const [entidade, setEntidade] = useState(entidades[0]!.id_entidade)
  const [tipo, setTipo] = useState<string>('banco'); const [instituicao, setInstituicao] = useState(''); const [apelido, setApelido] = useState('')
  const [final, setFinal] = useState(''); const [saldo, setSaldo] = useState('0,00'); const [data, setData] = useState(''); const [metodo, setMetodo] = useState('ofx')
  const valor = Number(saldo.replace(/\./g, '').replace(',', '.'))
  const ok = instituicao.trim().length >= 2 && apelido.trim().length >= 2 && data && Number.isFinite(valor)
  if (!aberto) return <div style={{ padding: '10px 16px' }}><button onClick={() => setAberto(true)} style={botaoSecundarioCompacto()}>+ Nova conta</button></div>
  return (
    <form style={{ padding: '12px 16px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10, alignItems: 'end' }}
      onSubmit={async (e) => {
        e.preventDefault(); if (!ok) return
        const r = await A.criarConta(idOrg, { id_entidade: entidade, tipo, instituicao, apelido, numero_final: final || undefined, saldo_inicial: Math.round(valor * 100) / 100, data_saldo_inicial: data, metodo: metodo || null })
        if (onFeito(r as Res, 'Conta criada')) setAberto(false)
      }}>
      {entidades.length > 1 && <CampoRotulado rotulo="CNPJ"><select value={entidade} onChange={(e) => setEntidade(e.target.value)} style={estiloCampo}>{entidades.map((e) => <option key={e.id_entidade} value={e.id_entidade}>{e.nome_fantasia ?? e.razao_social}</option>)}</select></CampoRotulado>}
      <CampoRotulado rotulo="Tipo"><select value={tipo} onChange={(e) => setTipo(e.target.value)} style={estiloCampo}>{TIPOS_CONTA.map((t) => <option key={t} value={t}>{ROT_TIPO[t]}</option>)}</select></CampoRotulado>
      <CampoRotulado rotulo="Instituição"><input value={instituicao} onChange={(e) => setInstituicao(e.target.value)} placeholder="Nubank, Itaú, Asaas…" style={estiloCampo} /></CampoRotulado>
      <CampoRotulado rotulo="Apelido"><input value={apelido} onChange={(e) => setApelido(e.target.value)} placeholder="Nubank PJ" style={estiloCampo} /></CampoRotulado>
      <CampoRotulado rotulo="Final do número" extra={<span style={{ color: theme.text3 }}>opcional</span>}><input value={final} onChange={(e) => setFinal(e.target.value)} maxLength={6} inputMode="numeric" style={estiloCampo} /></CampoRotulado>
      <CampoRotulado rotulo="Saldo inicial (R$)"><input value={saldo} onChange={(e) => setSaldo(e.target.value)} inputMode="decimal" style={estiloCampo} /></CampoRotulado>
      <CampoRotulado rotulo="Saldo em"><input type="date" value={data} onChange={(e) => setData(e.target.value)} style={estiloCampo} /></CampoRotulado>
      <CampoRotulado rotulo="Extrato chega por"><select value={metodo} onChange={(e) => setMetodo(e.target.value)} style={estiloCampo}><option value="ofx">Arquivo OFX</option><option value="manual">Manual (saldo informado)</option><option value="">Sem conexão por enquanto</option></select></CampoRotulado>
      <div style={{ display: 'flex', gap: 8 }}><button type="submit" disabled={!ok} style={botaoPrimario(!ok)}>Criar</button><button type="button" onClick={() => setAberto(false)} style={botaoSecundario()}>Cancelar</button></div>
      <div style={{ gridColumn: '1 / -1', fontSize: 11.5, color: theme.text3 }}>Saldo inicial = o saldo da conta no fim do dia escolhido, de onde a conciliação parte. API do Asaas é configurada à parte (precisa da chave no cofre do Supabase).</div>
    </form>
  )
}
