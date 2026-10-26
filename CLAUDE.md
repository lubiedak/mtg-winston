# mtg — MTG Winston / grid cube draft (lubisoftware.com/mtg)

Node ESM bez zależności. `npm start` (port 8734), `npm test`.

- Repo jest **publiczne**: nigdy nie commituj `public/art/` (grafiki kart), `data/drafts/`, `data/imports/`. Brakuje `.gitignore` — dodaj go przed pierwszym `git add`.
- Wdrożenie: `python scripts/deploy-mikrus.py` — szczegóły i znane braki (decki) w skillu `lubi-wdrozenie`. Routing `/mtg/` jest w nginx repo lubisoftware.
- Po deployu: `/mtg/` → 200, `/mtg/api/draft/zz` → 400.
- Zmiana zakresu zapisywanych danych → zaktualizuj politykę prywatności w lubisoftware.
- Dług: `DLUG-TECHNICZNY.md`.
