# SPDX-License-Identifier: GPL-3.0-or-later
UUID := brisa@lciarallo.github.io
SRC := $(UUID)
DEST := $(HOME)/.local/share/gnome-shell/extensions/$(UUID)
LINGUAS := $(basename $(notdir $(wildcard po/*.po)))

.PHONY: all schemas locale pot install uninstall pack clean

all: schemas locale

schemas:
	glib-compile-schemas $(SRC)/schemas

locale:
	@for l in $(LINGUAS); do \
		mkdir -p $(SRC)/locale/$$l/LC_MESSAGES; \
		msgfmt --check -o $(SRC)/locale/$$l/LC_MESSAGES/$(UUID).mo po/$$l.po; \
	done

pot:
	xgettext --from-code=UTF-8 -L JavaScript -k_ -kN_ -ktranslatable --package-name=Brisa \
		-o po/$(UUID).pot $(SRC)/*.js $(SRC)/*/*.js
	@for l in $(LINGUAS); do msgmerge -U --backup=none po/$$l.po po/$(UUID).pot; done

# Development install: links the source folder (log out and back in on Wayland).
install: all
	mkdir -p $(dir $(DEST))
	ln -sfn $(CURDIR)/$(SRC) $(DEST)
	gnome-extensions enable $(UUID) || true

uninstall:
	rm -f $(DEST)

# Zip for extensions.gnome.org (schemas and translations are compiled on install).
pack:
	mkdir -p dist
	gnome-extensions pack $(SRC) --force --out-dir=dist --podir=../po \
		--extra-source=lib --extra-source=providers --extra-source=ui --extra-source=icons \
		--extra-source=../LICENSE

clean:
	rm -rf dist $(SRC)/locale $(SRC)/schemas/gschemas.compiled
