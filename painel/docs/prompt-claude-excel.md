Preciso que você adapte esta pasta de trabalho para o padrão de importação do meu Painel Financeiro. O painel lê o arquivo automaticamente e só funciona se as abas e linhas abaixo estiverem exatamente neste formato. NÃO apague nem altere as abas que já existem: crie/ajuste apenas o que está descrito aqui, buscando os valores nas abas atuais da empresa (DRE, conciliação, extratos, fluxo de caixa etc.). Use fórmulas que apontem para os dados existentes sempre que possível, para que a planilha continue se atualizando sozinha nos próximos meses.

## ABA 1: "DRE FINANCEIRO" (nome exato, obrigatória)

- Uma linha de cabeçalho com os 12 meses escritos assim, cada um numa coluna: Jan, Fev, Mar, Abr, Mai, Jun, Jul, Ago, Set, Out, Nov, Dez (pode estar em qualquer uma das 40 primeiras linhas).
- Na coluna imediatamente à esquerda dos meses (ou na primeira coluna de texto), o nome de cada linha. Abaixo do cabeçalho, uma linha por conta, com os valores numéricos (números de verdade, não texto) em cada mês. Meses sem lançamento = 0.
- Sinais: receitas positivas, deduções/custos/despesas NEGATIVOS.
- As linhas devem vir nesta ordem e com estes nomes (acentos e maiúsculas tanto faz; o que importa é o texto):

```
Faturamento Bruto
(-) Deduções / Impostos          ← negativo
(=) Receita Bruta                ← OBRIGATÓRIA, começa com "(=)"
(-) Custos                       ← negativo
(=) Margem de Contribuição       ← começa com "(=)"
Despesas Administrativas         ← uma linha por grupo de despesa, negativas
Despesas com Pessoal               (use os grupos que a empresa tiver;
Despesas Comerciais                 cada linha aqui vira uma categoria
... outros grupos de despesa        no gráfico de "Saídas")
(=) Resultado Operacional        ← começa com "(=)"
Despesas Financeiras             ← total das despesas financeiras, negativo
TARIFA                           ← detalhamento das despesas financeiras,
IOF                                logo abaixo de "Despesas Financeiras",
EMPRÉSTIMO                         em MAIÚSCULAS (assim o painel entende
CONSÓRCIO                          que são subitens)
FINANCIAMENTO DE VEÍCULOS
FINANCIAMENTO IMOBILIÁRIO
(=) Resultado Antes dos Dividendos   ← qualquer total começando com "(=)" encerra o bloco financeiro
Distribuição de Dividendos       ← negativo (se houver)
Resultado Líquido                ← OBRIGATÓRIA, ÚLTIMA linha lida
```

Regras importantes:
- Linhas de total SEMPRE começam com "(=)". Linhas de dedução podem começar com "(-)".
- Os subitens de "Despesas Financeiras" devem ficar em MAIÚSCULAS. Os nomes que contêm "CONSÓRCIO" ou "FINANCIAMENTO" são tratados como investimento (o painel mostra o "resultado sem investimentos"), então classifique-os corretamente.
- Os grupos de despesa (entre "Margem de Contribuição" e "Resultado Operacional") devem estar em letras normais (não tudo maiúsculo), senão viram subitens.
- Nada abaixo de "Resultado Líquido" é lido.
- Confira: Receita Bruta = Faturamento + Deduções; Resultado Líquido bate com o da DRE original da empresa.

## ABA 2: "Base Dash" (nome exato, obrigatória)

- Coluna A: o nome do indicador. Colunas B a M: Jan a Dez (B=Jan … M=Dez).
- Linha 1: A1 = "Mês" e B1:M1 = Jan, Fev, Mar, Abr, Mai, Jun, Jul, Ago, Set, Out, Nov, Dez.
- Depois, uma linha por indicador, com estes nomes EXATOS na coluna A (valores numéricos; deixe em branco o que não existir):

```
Último mês com lançamentos   ← só em B: número de 1 a 12 (ex.: 10 = outubro)
Mês selecionado dash         ← só em C: número de 1 a 12 (normalmente igual ao anterior)
BB Conta                     ← SALDO no fim de cada mês
Stone                        ← SALDO no fim de cada mês
Sicredi Conta                ← SALDO no fim de cada mês
Cora                         ← SALDO no fim de cada mês
Rende Fácil BB               ← SALDO aplicado no fim de cada mês
Aplicação Sicredi            ← SALDO aplicado no fim de cada mês
Aplicações Totais            ← total aplicado NO MÊS (movimento)
Resgates Totais              ← total resgatado NO MÊS (movimento)
BB Rendimento                ← rendimento bruto do mês
Sicredi Rendimento           ← rendimento bruto do mês
Impostos Totais              ← IR + IOF sobre aplicações no mês
```

Se a empresa usa OUTROS bancos (Itaú, Bradesco, Inter, Santander etc.): o painel por enquanto só tem esses quatro nomes de conta. Coloque o banco principal da empresa na linha "BB Conta"/"Rende Fácil BB"/"BB Rendimento" e o segundo banco nas linhas "Sicredi…", e os demais em "Stone" e "Cora". Depois me diga, em uma lista, qual banco real ficou em cada linha.

### Bloco "Carteira de clientes" (opcional, para a página "Posição de clientes")
Mais abaixo na mesma aba "Base Dash", depois de uma linha em branco:

```
A                       | B         | C          | D
Carteira de clientes    | Recebido  | Em aberto  | Vencido      ← cabeçalho (estes textos exatos)
BB                      | 12000     | 8000       | 1500         ← um banco/carteira por linha
Sicredi                 | ...       | ...        | ...
Total                   | ...       | ...        | ...          ← a linha "Total" encerra o bloco
```
- "Em aberto" = a vencer; "Vencido" = em atraso; "Recebido" = já recebido no período.
- Use os nomes BB, Cora, Stone, Sicredi quando forem esses bancos; outros nomes também funcionam.

## ABA 3: "DASH" (opcional)
Se quiser que o painel mostre "lançamentos até dd/mm/aaaa", coloque nas 10 primeiras linhas de uma aba chamada "DASH" uma célula de texto com a data no formato dd/mm/aaaa (ex.: "Lançamentos até 31/10/2026"). Uma célula de texto como "RESULTADO 2026" em alguma dessas abas define o ano do relatório.

## Ao terminar
1. Liste o que você criou/alterou e de onde puxou cada linha.
2. Faça uma conferência: Resultado Líquido por mês (DRE FINANCEIRO) × resultado da DRE original; saldos de fim de mês × extratos.
3. Aponte qualquer dado que não encontrou (ficou em branco/zero) para eu completar.
4. Salve como .xlsx (ou .xlsb) mantendo as abas originais.
