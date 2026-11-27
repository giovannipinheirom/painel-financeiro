// Calendário geral do consultor: pagamentos de todas as empresas num mês (só o consultor).
// GET ?mes=AAAA-MM   contas a pagar, parcelas de contratos e repasses em aberto de todas as empresas
import { rota, db, exigirAdmin, HttpError } from './_lib.js';

const MES_OK = /^\d{4}-(0[1-9]|1[0-2])$/;

export default rota(async (req, res) => {
  exigirAdmin(req);
  if (req.method !== 'GET') throw new HttpError(405, 'Método não permitido.');
  let mes = req.query.mes;
  if (!MES_OK.test(mes || '')) mes = new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 7);
  const ini = mes + '-01';
  const sql = await db();
  const [empresas, contas, parcelas, repasses] = await Promise.all([
    sql`select id, nome, cor, repasse_prazo as prazo from empresas order by lower(nome)`,
    sql`select c.id, c.empresa_id as e, c.recebedor, c.valor::float8 as valor, to_char(c.vencimento, 'YYYY-MM-DD') as vencimento, a.nome as anexo
          from contas_pagar c left join conta_anexos a on a.conta_id = c.id
         where c.vencimento >= ${ini}::date and c.vencimento < (${ini}::date + interval '1 month')
         order by c.vencimento limit 5000`,
    sql`select * from (
          select p.id, c.empresa_id as e, c.nome, p.valor::float8 as valor, to_char(p.vencimento, 'YYYY-MM-DD') as vencimento, p.vencimento as v,
                 row_number() over (partition by p.contrato_id order by p.vencimento, p.id) as n, count(*) over (partition by p.contrato_id) as tot
            from contrato_parcelas p join contratos c on c.id = p.contrato_id join empresas e on e.id = c.empresa_id
           where e.contratos) x
         where v >= ${ini}::date and v < (${ini}::date + interval '1 month') limit 5000`,
    // repasses em aberto que podem vencer neste mês (o vencimento em dias úteis é calculado na tela)
    sql`select r.empresa_id as e, r.fornecedor as f, r.valor::float8 as v, to_char(r.solicitado, 'YYYY-MM-DD') as s
          from repasses r join empresas e on e.id = r.empresa_id
         where e.repasses and not r.pago and not r.cancelado
           and r.solicitado >= (${ini}::date - 60) and r.solicitado < (${ini}::date + interval '1 month') limit 20000`,
  ]);
  return res.json({
    mes,
    empresas: empresas.map(e => ({ id: e.id, nome: e.nome, cor: e.cor, prazo: e.prazo || 10 })),
    contas,
    parcelas: parcelas.map(p => ({ id: p.id, e: p.e, recebedor: `${p.nome} · parcela ${p.n}/${p.tot}`, valor: p.valor, vencimento: p.vencimento, tipo: 'contrato' })),
    repasses,
  });
});
