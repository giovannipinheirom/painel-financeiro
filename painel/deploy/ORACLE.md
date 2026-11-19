# Colocar o painel num servidor Ubuntu da Oracle Cloud

No servidor fica tudo junto: o site (Node.js), o banco (Postgres) e o HTTPS (Caddy, que pede o certificado sozinho).
Leva uns 20 minutos.

## 1. Criar a máquina na Oracle
1. Em **Compute → Instances → Create instance**, escolha a imagem **Ubuntu 22.04 ou 24.04**.
   A forma **Ampere A1 (ARM)** entra no plano gratuito e funciona normalmente.
2. Baixe a chave SSH que a Oracle gera (ou cole a sua) e crie a instância. Anote o **IP público**.
3. Libere as portas do site: **Networking → Virtual Cloud Networks → (sua VCN) → Security Lists → Default → Add Ingress Rules**
   - Source CIDR `0.0.0.0/0`, protocolo TCP, porta de destino `80`
   - repita para a porta `443`

## 2. Apontar o domínio (recomendado)
No lugar onde você administra o domínio, crie um registro **A**, por exemplo `painel` → IP público do servidor.
Espere alguns minutos até `painel.seudominio.com.br` responder com esse IP.
Sem domínio também funciona, só que sem HTTPS (veja o passo 4).

## 3. Entrar no servidor e baixar o código
```bash
ssh -i sua-chave.key ubuntu@IP-DO-SERVIDOR
```
Como o repositório é privado, crie um token no GitHub (**Settings → Developer settings → Fine-grained tokens**,
só leitura de *Contents* deste repositório) e use no clone:
```bash
git clone https://SEU-USUARIO:SEU-TOKEN@github.com/giovannipinheirom/painel-financeiro.git
```

## 4. Instalar
Com domínio (HTTPS automático):
```bash
cd painel-financeiro/painel && sudo bash deploy/instalar.sh painel.seudominio.com.br
```
Só com o IP, para testar (sem HTTPS):
```bash
cd painel-financeiro/painel && sudo bash deploy/instalar.sh
```
No fim o script mostra o endereço e a **senha do consultor** gerada. Ela fica guardada em `painel/.env`
(`ADMIN_PASSWORD`). Para trocar, edite esse arquivo e rode `sudo systemctl restart painel`.

> Se instalou primeiro sem domínio e depois quiser HTTPS: apague a linha `COOKIE_SEGURO=0` do `.env`
> e rode o instalador de novo passando o domínio.

## 5. Trazer os dados que já estão na Vercel/Neon (opcional)
No seu computador ou no próprio servidor, com a URL do Neon (Vercel → Storage → `DATABASE_URL`):
```bash
pg_dump --no-owner --no-acl "URL-DO-NEON" > painel.sql
```
No servidor:
```bash
sudo systemctl stop painel && sudo -u postgres psql -d painel -c "drop schema public cascade; create schema public authorization painel;" && psql "$(grep DATABASE_URL .env | cut -d= -f2-)" < painel.sql && sudo systemctl start painel
```
Os links dos clientes continuam os mesmos (só muda o domínio). As sessões abertas caem, e todos entram de novo com a senha.

## Dia a dia
- **Atualizar** depois de mudanças no GitHub:
  ```bash
  cd ~/painel-financeiro/painel && bash deploy/atualizar.sh
  ```
- **Ver erros**:
  ```bash
  journalctl -u painel -n 100 --no-pager
  ```
- **Backup diário do banco** (guarda 14 dias em `~/backups`):
  ```bash
  mkdir -p ~/backups && (crontab -l 2>/dev/null; echo '30 3 * * * pg_dump "$(grep DATABASE_URL ~/painel-financeiro/painel/.env | cut -d= -f2-)" | gzip > ~/backups/painel-$(date +\%F).sql.gz && find ~/backups -name "*.sql.gz" -mtime +14 -delete') | crontab -
  ```
  Copie esses arquivos para fora do servidor de vez em quando (Google Drive, seu computador etc.).

## Se não abrir
- Teste dentro do servidor: `curl -I localhost:3000`. Se responder, o problema está na rede.
- Confira a **Security List** (passo 1.3). Para o firewall do Ubuntu, o script já liberou as portas 80 e 443.
- HTTPS não sai: o domínio ainda não aponta para o IP, ou a porta 80 está fechada. Veja `journalctl -u caddy -n 50`.
