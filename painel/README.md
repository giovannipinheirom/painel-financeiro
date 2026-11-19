# Painel de Evolução Financeira (Vercel + Postgres)

Site para o consultor cadastrar empresas, enviar a planilha de conciliação de cada mês e mandar para cada cliente um link do painel dele.

- **Área do consultor** (`/`): fica protegida por senha. Nela você cadastra empresas, vê os cards, arrasta a planilha nova, consulta o histórico de envios e copia ou troca o link de cada cliente.
- **Painel do cliente** (`/c/<código>`): abre sem login e mostra só a empresa daquele link. O cliente pode trocar entre visão mensal, trimestral e anual, escolher uma das últimas 12 versões e baixar o PDF.

A planilha é lida no navegador. O servidor guarda só o painel já processado (em JSON), e o arquivo original não fica salvo.

---

## Como colocar no ar (cerca de 15 minutos)

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
1. **+ Nova empresa** → preencha o nome e, se quiser, o CNPJ, o contato e a cor do card.
2. Abra a empresa e **arraste a planilha** (`.xlsb` ou `.xlsx`, com as abas `DRE FINANCEIRO` e `Base Dash`). Ela vira a versão atual na hora.
3. **Copiar link do cliente** → mande o link por WhatsApp ou e-mail.
4. Todo mês, arraste a planilha nova. O cliente usa o mesmo link e já vê a atualização.
5. Se o link vazar ou o contrato acabar, clique em **gere um link novo** na caixa do link. O link antigo para de funcionar na hora.

## Segurança
- Cada cliente tem um código de 24 caracteres aleatórios, praticamente impossível de adivinhar. Esse código só dá acesso aos dados da própria empresa.
- A área do consultor usa um cookie de sessão assinado, que vale por 30 dias. O botão **Sair** encerra a sessão.
- Quem tem o link do cliente vê aquele painel. Trate o link como uma senha.
- As páginas não aparecem no Google (`noindex`) e não enviam o link para outros sites (`no-referrer`).

## Estrutura
```
api/_lib.js        conexão com o Postgres, criação das tabelas, login
api/login.js       entrar, sair e checar a sessão
api/empresas.js    cadastro de empresas (consultor)
api/relatorios.js  envios de planilha e histórico (consultor)
api/publico.js     dados do painel para o link do cliente
public/index.html  área do consultor      (+ admin.js)
public/cliente.html painel do cliente     (+ cliente.js)
public/report.js   leitura da planilha e montagem do painel (gráficos, DRE)
public/styles.css  visual
```

## Limitações conhecidas
- O layout do painel segue o modelo de planilha atual. Os blocos de bancos (BB, Sicredi, Stone e Cora) são fixos, então um cliente com outros bancos vê esses blocos zerados.
- O histórico do cliente mostra as 12 versões mais recentes. O consultor vê até 50.
