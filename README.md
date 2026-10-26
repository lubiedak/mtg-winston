# Winston Cube

Lokalne drafty Magic: The Gathering. Winston (człowiek przeciwko komputerowi, 90 kart) albo grid dla dwóch osób przy jednym komputerze (do 18 siatek po 9, czyli 162 karty). Losowana kostka bierze jeden dodatek: Adventures in the Forgotten Realms (AFR), Strixhaven (STX) albo Duskmourn (DSK) i nigdy ich nie miesza. Można też wczytać kostkę z CubeCobra. Po drafcie składa się talię. Lądy podstawowe wybiera gracz, a na starcie każdy kolor ma zero. Potem zostaje tylko próbna ręka startowa (London mulligan). Partii na tym ekranie nie ma.

## Uruchomienie

```
npm start
```

Potem otwórz [http://127.0.0.1:8734/](http://127.0.0.1:8734/).

Karty są w `data/cards.json`. Ponowne pobranie: `npm run download`. Zrzut samych tekstów: `npm run text`. Testy: `npm test`.

Na górze okna jest przełącznik Polski / English. Silnik dalej czyta angielski tekst zasad. AFR, STX i DSK nie mają polskiego druku w Scryfallu, więc nazwa karty zostaje angielska. Po polsku widać przekład typu i tekstu do czytania (`src/pltext.js`). Lądy podstawowe: Równina, Wyspa, Bagno, Góra, Las.

Wygląd jest ciemny, zbliżony do klienta MTGO. Miniatura karty jest na wierzchu. Prawy przycisk myszy otwiera powiększenie i tekst.

## Skąd jest baza

`?as=text` na stronie zestawu Scryfalla to widok HTML, nie lista kart do silnika. Gra bierze dane z API Scryfalla. Miniatury to lokalna kopia `image_uris.small` w `public/art` (`npm run art`). Przy grze przeglądarka nie woła Scryfalla. Pliki `data/*-oracle.txt` i `data/*-as-text.txt` są z tego JSON-a (`npm run text`, poza gitem).

Tekst kart © Wizards of the Coast. Dane: Scryfall. Do prywatnej gry na tym komputerze.

## Draft

Winston: trzy kupki, bierzesz albo dokładasz zakrytą kartę. Po odrzuceniu trzeciej kupki dokładasz do niej kartę i bierzesz wierzch talii w ciemno. Kostka ma 90 kart z wybranego dodatku. Trudność komputera przy drafcie: łatwy, średni, trudny.

Grid: 9 kart w siatce 3×3. Pierwsza osoba bierze rząd albo kolumnę, druga bierze rząd albo kolumnę z tego, co zostało, reszta odpada. Pełny grid to 18 siatek. Mniejsza kostka daje mniej siatek. Obie pule są jawne. Komputer w gridzie nie draftuje.

Lądy podstawowe dochodzą po wybraniu kart, według tabeli źródeł Franka Karstena dla talii 40 kart (2022). Potem można wylosować rękę startową i wziąć London mulligan. To nie jest partia.

Import: w menu wklejasz link CubeCobra, na przykład `https://cubecobra.com/cube/list/…`. Serwer pobiera kostkę raz i trzyma ją w `data/imports`. Miniatury, których nie ma lokalnie, dociąga z CubeCobra.

Od ułożenia kostki draft ma własny adres `/?d=…`. Odświeżenie wraca w to samo miejsce: kupki, siatka, talia i ręka. Zapis leży w `data/drafts` na tym komputerze. „Od nowa” czyści adres, a stary link dalej otwiera tamten draft.

## Mecze komputer–komputer

`npm run sim` rozgrywa po 20 meczy na STX, AFR i DSK. Oba stanowiska grają na trudności trudnej. Wynik jest w `results/matches.json` (talie, przebieg życia) i `results/card-strength.md` (siła kart w obrębie dodatku). Mecz, który stanie albo przekroczy limit tury, nie liczy się: startuje jeszcze raz z innym losowaniem.

## Hosting i wdrożenie

Wersja publiczna działa pod [lubisoftware.com/mtg](https://lubisoftware.com/mtg/): proces Node na porcie 8734, nginx z repo lubisoftware przekazuje `/mtg/`. Klient buduje adresy względem `/mtg/`.

```
npm test
python scripts/deploy-mikrus.py
```

Skrypt deployu (Python + `paramiko`) bierze dane SSH z `.env` repo lubisoftware (domyślnie `~/lubisoftware/.env`, inna ścieżka: zmienna `LUBISOFTWARE_ENV`). Wgrywa `server.js`, `src/`, `public/` (z grafikami), `decki/`, `data/cards.json` i `data/deck-extras.json`. Nie rusza zapisów `data/drafts` ani `data/imports` na serwerze.

Poza gitem: `public/art/` (grafiki kart — `npm run art`, `npm run art:large`, `npm run deck-art`), `data/drafts/`, `data/imports/`, `results/`.
