# Winston Cube

Lokalna gra Magic: The Gathering. Jeden człowiek, jeden komputer. Przed partią wybierasz jeden dodatek: Adventures in the Forgotten Realms (AFR), Strixhaven (STX) albo Duskmourn (DSK). Kostka 90 kart nigdy nie miesza dodatków.

## Uruchomienie

```
npm start
```

Potem otwórz [http://127.0.0.1:8734/](http://127.0.0.1:8734/).

Karty są w `data/cards.json`. Ponowne pobranie: `npm run download`. Zrzut samych tekstów: `npm run text`. Testy: `npm test`.

Na górze okna jest przełącznik Polski / English. Silnik dalej czyta angielski tekst zasad. AFR, STX i DSK nie mają polskiego druku w Scryfallu, więc nazwa karty zostaje angielska. Po polsku widać przekład typu i tekstu do czytania (`src/pltext.js`). Lądy podstawowe: Równina, Wyspa, Bagno, Góra, Las.

Wygląd jest ciemny, zbliżony do klienta MTGO: mata, złote okna życia, pasek faz, stos i dziennik po prawej. Miniatura karty jest na wierzchu. Tekst pokazuje się po najechaniu albo po zaznaczeniu.

## Skąd jest baza

`?as=text` na stronie zestawu Scryfalla to widok HTML, nie lista kart do silnika. Gra bierze dane z API Scryfalla. Miniatury to oficjalne adresy `image_uris.small`. Pliki `data/*-oracle.txt` i `data/*-as-text.txt` są z tego JSON-a.

Tekst kart © Wizards of the Coast. Dane: Scryfall. Do prywatnej gry na tym komputerze.

## Partia

Kostka ma 90 kart z wybranego dodatku, dzielonych kwotami koloru i rzadkości. Winston: trzy kupki, bierzesz albo dokładasz zakrytą kartę. Po odrzuceniu trzeciej kupki dokładasz do niej kartę i bierzesz wierzch talii w ciemno. Talia ma co najmniej 40 kart. Lądy podstawowe są bez limitu. Trudność komputera: łatwy, średni, trudny. Karty pokazują miniatury ze Scryfalla.

Silnik rozgrywa turę, stos, manę, walkę i typowe efekty z tekstu. Zdanie, którego nie rozpoznał, u człowieka można rozstrzygnąć ręcznie. Komputer takich fragmentów nie zgaduje.

## Mecze komputer–komputer

`npm run sim` rozgrywa po 20 meczy na STX, AFR i DSK. Oba stanowiska grają na trudności trudnej. Wynik jest w `results/matches.json` (talie, przebieg życia) i `results/card-strength.md` (siła kart w obrębie dodatku). Mecz, który stanie albo przekroczy limit tury, nie liczy się: startuje jeszcze raz z innym losowaniem.
