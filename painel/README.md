# Painel de Evolução Financeira (Vercel + Postgres)

Site para o consultor cadastrar empresas, enviar a planilha de conciliação de cada mês e mandar para cada cliente um link do painel dele.

- **Área do consultor** (`/`): fica protegida por senha. Nela você cadastra empresas, vê os cards, arrasta a planilha nova, consulta o histórico de envios e copia ou troca o link de cada cliente.
- **Painel do cliente** (`/c/<código>`): pede a **senha que você definiu** para aquela empresa e mostra só os dados dela. O cliente pode trocar entre visão mensal, trimestral e anual, escolher uma das últimas 12 versões, baixar o PDF e ligar o **Modo TV**.
- **Modo TV**: o painel abre em tela cheia e passa uma página a cada 15 segundos. A cada 5 minutos ele busca os dados de novo, então uma planilha nova aparece sozinha na TV. Use as setas do teclado para avançar ou voltar, a barra de espaço para pausar e Esc para sair.
- **Resultado sem investimentos** (automático): o consórcio e os financiamentos que aparecem nas despesas financeiras da DRE vão para uma página própria. Ela mostra, em linguagem simples, o resultado real + investimentos = resultado sem investimentos, com um gráfico mês a mês e quanto foi para cada tipo de investimento. A página só aparece quando a DRE tem essas linhas.
- **Contratos** (opcional por empresa): cada contrato funciona como uma planilha de parcelas (data e valor). Você cria as parcelas de uma vez em "Gerar parcelas" (valor, quantas faltam e data da próxima) e depois adiciona ou ajusta linha por linha. A página do cliente mostra quanto falta pagar, as parcelas do mês, a próxima parcela, quando tudo fica quitado e um gráfico de previsão. As parcelas com data passada contam como pagas automaticamente, e todas entram sozinhas no calendário de contas a pagar.
- **Calendário de contas a pagar** (opcional por empresa): você cadastra os boletos no próprio site (recebedor, valor e vencimento), digitando um por um ou colando do Excel. O cliente vê um calendário do mês, no estilo da agenda do Teams, com o dia de hoje destacado, os totais por dia e um resumo do mês. O calendário também passa no modo TV, sempre no mês atual. No celular ele aparece como uma lista por dia.
- **Posição de clientes** (opcional por empresa): página com o total a receber, quanto está a vencer, quanto está vencido e um gráfico do valor a receber em cada banco. Os números vêm do bloco "Carteira de clientes" da aba Base Dash. A opção vem ligada para as empresas novas e para as que já existiam.

A planilha é lida no navegador. O servidor guarda só o painel já processado (em JSON), e o arquivo original não fica salvo.

---

## Como colocar no ar (cerca de 15 minutos)

> Quer rodar num servidor próprio (Oracle Cloud, Ubuntu)? Siga [deploy/ORACLE.md](deploy/ORACLE.md).

### 1. Subir o código para o GitHub
1. Crie um repositório **privado** no GitHub, por exemplo `painel-financeiro`.
2. Envie esta pasta inteira para ele. Pelo site, use "Add file → Upload files" e arraste todos os arquivos, incluindo as pastas `api` e `public`.

### 2. Criar o projeto na Vercel
1. Em vercel.com, clique em **Add New → Project** e importe o repositório.
2. Em *Framework Preset*, deixe **Other**. O arquivo `vercel.json` já configura o resto.
3. Clique em **Deploy**. O primeiro deploy vai abrir o site, mas ele ainda não funciona sem o banco e a senha, que você configura nos próximos passos.

### 3. Criar o banco Postgres
1. Abra o projeto na Vercel e vá na aba **Storage**.
2. Clique em **Create Database** e escolha **Neon** (Postgres serverless, com plano gratuito).
3. Conecte o banco a este projeto. A Vercel cria a variável `DATABASE_URL` sozinha.

Também funciona com qualquer outro Postgres (Supabase, Railway, um servidor próprio etc.). Nesse caso, cole a URL de conexão na variável `DATABASE_URL`.

**Você não precisa criar tabelas:** o site cria as tabelas sozinho no primeiro acesso.

### 4. Definir a senha
Em **Settings → Environment Variables**, adicione:

| Nome | Valor |
|---|---|
| `ADMIN_PASSWORD` | A senha que você vai usar para entrar. Use uma senha forte, com pelo menos 12 caracteres. |
| `SESSION_SECRET` | Um texto aleatório e longo, de 32 caracteres ou mais. Gere um em https://generate-secret.vercel.app/32 ou com `openssl rand -base64 32`. |

### 5. Publicar de novo
Vá em **Deployments → ⋯ → Redeploy** para o site carregar as variáveis novas. Depois abra o endereço do projeto (`https://seu-projeto.vercel.app`) e entre com a senha.

Se quiser, adicione um domínio próprio em **Settings → Domains** (por exemplo `painel.inovacomvalor.com.br`).

---

## Uso no dia a dia
1. **+ Nova empresa** → preencha o nome, a **senha do cliente** (o botão "Gerar" cria uma senha para você) e, se quiser, o CNPJ, o contato e a cor do card. Marque ou desmarque a opção "Posição de clientes". Anote a senha antes de salvar: por segurança ela é guardada criptografada e não aparece mais depois. Se esquecer, defina uma nova em **Editar**.
2. Abra a empresa e **arraste a planilha** (`.xlsb` ou `.xlsx`, com as abas `DRE FINANCEIRO` e `Base Dash`). Ela vira a versão atual na hora.
3. **Copiar link do cliente** → mande por WhatsApp ou e-mail. Se você acabou de definir a senha, o texto copiado já inclui a senha junto com o link.
4. **Contas a pagar** (se a opção estiver ligada): na página da empresa, preencha a linha de cima e aperte Enter, ou clique em **Colar do Excel** e cole as três colunas. Para corrigir uma conta, edite direto na tabela: a alteração salva sozinha.
5. Todo mês, arraste a planilha nova. O cliente usa o mesmo link e já vê a atualização.
6. Se o link vazar ou o contrato acabar, clique em **gere um link novo** na caixa do link. O link antigo para de funcionar na hora.

## Segurança
- Para abrir o painel, o cliente precisa do link **e** da senha. Cada link tem um código aleatório de 24 caracteres e só dá acesso aos dados da própria empresa. A senha é guardada criptografada (scrypt).
- Trocar a senha em **Editar** desconecta na hora todo mundo que entrou com a senha antiga.
- Empresas sem senha ficam bloqueadas para o cliente e aparecem com o aviso "sem senha".
- A área do consultor usa um cookie de sessão assinado, que vale por 30 dias. O botão **Sair** encerra a sessão.
- As páginas não aparecem no Google (`noindex`) e não enviam o link para outros sites (`no-referrer`).

## Estrutura
```
api/_lib.js        conexão com o Postgres, criação das tabelas, login
api/login.js       entrar, sair e checar a sessão
api/empresas.js    cadastro de empresas (consultor)
api/relatorios.js  envios de planilha e histórico (consultor)
api/contas.js      contas a pagar (consultor)
api/contratos.js   contratos e parcelas (consultor)
api/publico.js     dados do painel e do calendário para o link do cliente (com senha)
public/index.html  área do consultor      (+ admin.js)
public/cliente.html painel do cliente     (+ cliente.js)
public/report.js   leitura da planilha e montagem do painel (gráficos, DRE)
public/styles.css  visual
```

## Limitações conhecidas
- O layout do painel segue o modelo de planilha atual. Os blocos de bancos (BB, Sicredi, Stone e Cora) são fixos, então um cliente com outros bancos vê esses blocos zerados.
- Por enquanto, a página "Posição de clientes" usa o bloco "Carteira de clientes" da Base Dash. Ela vai passar a usar uma planilha própria de importação quando a planilha base for definida.
- O histórico do cliente mostra as 12 versões mais recentes. O consultor vê até 50.
