# Como publicar e divulgar a Brisa

## 1. Loja oficial: extensions.gnome.org (EGO)

É a loja que o GNOME usa: o site, o app **Gerenciador de Extensões** (Extension Manager) e o app *Extensões* buscam todos dela. Não existe outra loja oficial; o Flathub não aceita extensões do Shell.

### Antes de enviar (checklist das regras de revisão)

Regras oficiais: <https://gjs.guide/extensions/review-guidelines/review-guidelines.html>

- [x] Nada é criado no construtor: tudo é criado em `enable()` e destruído em `disable()` (fontes do main loop, sinais, atores, timeline).
- [x] O processo do Shell não importa `Gtk/Gdk/Adw`, e as preferências não importam `St/Clutter/Meta/Shell`.
- [x] Não importa os módulos obsoletos `Lang`, `Mainloop` ou `ByteArray`.
- [x] Sem log excessivo, sem telemetria, sem binários e sem código minificado.
- [x] O esquema GSettings fica em `org.gnome.shell.extensions.brisa`, no caminho `/org/gnome/shell/extensions/brisa/`.
- [x] `metadata.json`: `uuid` com o formato `nome@namespace`, `url` do GitHub e `shell-version` só com versões estáveis (47 a 50). Também não tem `session-modes`, porque usa só o modo `user`.
- [x] Licença GPL-3.0-or-later.
- [x] **Marcas**: o nome é neutro ("Brisa"). "LG ThinQ" e "Home Assistant" aparecem só para dizer com o que é compatível (uso nominativo), sem logos de terceiros. Se o revisor pedir, tire as marcas da descrição e deixe "nuvem do fabricante / Home Assistant".
- [x] **Código gerado com IA**: a regra pede que você entenda e consiga explicar o código. Leia os arquivos antes de enviar e esteja pronto para responder perguntas do revisor.
- [ ] Teste a extensão no seu ar real antes de enviar. Um código "fundamentalmente quebrado" é rejeitado.

### Gerar o pacote

```bash
make pack
```

O resultado fica em `dist/brisa@lciarallo.github.io.shell-extension.zip`. O `gnome-extensions pack` já leva os esquemas e as traduções (compiladas na instalação), além de `lib/`, `providers/`, `ui/`, `icons/` e a `LICENSE`.

### Enviar

1. Crie uma conta em <https://extensions.gnome.org/accounts/register/>.
2. Abra <https://extensions.gnome.org/upload/>, envie o `.zip` e aceite os termos.
3. A extensão entra na fila de revisão manual, que costuma levar de alguns dias a algumas semanas. As respostas do revisor chegam por e-mail e na página da extensão.
4. Depois de aprovada, cada nova versão é um novo envio do zip. O EGO numera as versões sozinho.
5. Na página da extensão, adicione a captura `docs/assets/screenshots/hero.png` e o link do GitHub.

## 2. Divulgação

| Onde | Como |
|---|---|
| **This Week in GNOME** (thisweek.gnome.org) | Boletim semanal oficial que tem uma seção de extensões. Mande um parágrafo com captura na sala Matrix `#thisweek:gnome.org` até a sexta-feira. |
| **GNOME Discourse** (discourse.gnome.org) | Faça um post na categoria *Extensions* com o link da EGO e do GitHub. |
| **Reddit** | Em r/gnome e r/linux, um post com o GIF da animação e o link. Para as outras marcas, r/homeassistant. Para quem tem LG, r/LGThinQ, se existir. |
| **Comunidade do Home Assistant** | Faça um post em *Share your Projects* (community.home-assistant.io): a extensão funciona com qualquer `climate`. |
| **Fedora Discussion e Ubuntu Discourse** | Divulgue na seção de desktop/GNOME. |
| **Mastodon / Fediverse** | Use as hashtags #GNOME #Linux #HomeAssistant e marque @gnome@floss.social. |
| **Brasil** | Comunidades Fedora Brasil, Ubuntu-BR, Telegram/Discord de Linux e Diolinux. |
| **GitHub** | Adicione os tópicos `gnome-shell-extension`, `gnome`, `air-conditioner`, `home-assistant`, `lg-thinq`, `climate`. A página do GitHub Pages ajuda as buscas. |

**Dica:** um GIF curto (5 a 10 s) do menu abrindo, com a animação rodando e a troca de modo, vende muito mais que uma captura parada. Use o gravador de tela do GNOME (Ctrl+Shift+Alt+R) e converta para GIF.

## 3. Opcional: pacotes de distribuição

- **AUR** (Arch): pacote `gnome-shell-extension-brisa` instalando em `/usr/share/gnome-shell/extensions/`.
- **Fedora COPR**: um spec simples copiando a pasta e compilando os esquemas.
